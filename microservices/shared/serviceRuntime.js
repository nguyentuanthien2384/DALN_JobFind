import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from '@prometheus-io/client';

const bounded = async (operation, timeoutMs) => {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(operation),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Operation timed out')), timeoutMs); })
        ]);
    } finally { clearTimeout(timer); }
};

export const correlationId = (value) => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value)
    ? value : crypto.randomUUID();

export const periodicTask = (work, intervalMs, onError = () => {}) => {
    let pending;
    const timer = setInterval(() => {
        if (!pending) pending = Promise.resolve().then(work).catch(onError).finally(() => { pending = null; });
        return pending;
    }, intervalMs);
    timer.unref();
    return async () => { clearInterval(timer); await pending; };
};

const sameSecret = (actual, expected) => {
    const a = Buffer.from(actual || '');
    const b = Buffer.from(expected || '');
    return b.length >= 32 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Each service owns its registry. Route templates, never IDs or query strings, are labels.
export const createServiceRuntime = (app, {
    service, checks = {}, logger = console, probeTimeoutMs = 1500,
    shutdownMs = 30000, metricsToken = process.env.METRICS_TOKEN || (
        process.env.METRICS_TOKEN_FILE ? readFileSync(process.env.METRICS_TOKEN_FILE, 'utf8').trim() : ''
    ), defaultMetrics = true
}) => {
    let started = false;
    let draining = false;
    let server;
    let shutdown;
    const stopHooks = [];
    const closeHooks = [];
    const sockets = new Set();
    const registry = new Registry();
    registry.setDefaultLabels({ service });
    if (defaultMetrics) collectDefaultMetrics({ register: registry });
    const requests = new Counter({ name: 'jobfind_http_requests_total', help: 'Completed HTTP requests', labelNames: ['method', 'route', 'status'], registers: [registry] });
    const duration = new Histogram({ name: 'jobfind_http_duration_seconds', help: 'HTTP duration', labelNames: ['method', 'route'], buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15], registers: [registry] });
    const active = new Gauge({ name: 'jobfind_http_active', help: 'In-flight HTTP requests', registers: [registry] });
    const ready = new Gauge({ name: 'jobfind_ready', help: 'Last readiness result (not liveness)', registers: [registry] });
    ready.set(0);

    // Do not accumulate new dependency queries while an earlier timed-out probe is pending.
    const pending = new Map();
    const checkOne = async (name, check) => {
        let probe = pending.get(name);
        if (!probe) {
            probe = Promise.resolve().then(check);
            pending.set(name, probe);
            probe.then(() => pending.delete(name), () => pending.delete(name));
        }
        try { return await bounded(() => probe, probeTimeoutMs) !== false; }
        catch { return false; }
    };
    const readiness = async () => {
        if (!started || draining) { ready.set(0); return false; }
        const results = await Promise.all(Object.entries(checks).map(([name, check]) => checkOne(name, check)));
        const ok = !draining && results.every(Boolean);
        ready.set(Number(ok));
        return ok;
    };

    app.use((req, res, next) => {
        req.correlationId = correlationId(req.headers['x-correlation-id']);
        res.setHeader('x-correlation-id', req.correlationId);
        if (draining && !['/health', '/healthz', '/readyz', '/metrics'].includes(req.path)) {
            res.setHeader('Connection', 'close');
            return res.status(503).json({ errCode: 503, errMessage: 'Service is draining' });
        }
        if (['/health', '/healthz', '/readyz', '/metrics'].includes(req.path)) return next();
        active.inc();
        const begin = performance.now();
        let recorded = false;
        const finish = () => {
            if (recorded) return;
            recorded = true;
            active.dec();
            const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(req.method) ? req.method : 'OTHER';
            const route = typeof req.route?.path === 'string' ? req.route.path : (req.metricRoute || 'unmatched');
            requests.inc({ method, route, status: res.writableFinished ? String(res.statusCode) : 'aborted' });
            duration.observe({ method, route }, (performance.now() - begin) / 1000);
        };
        res.once('finish', finish);
        res.once('close', finish);
        next();
    });
    const live = (req, res) => res.json({ status: 'ok', service });
    app.get('/healthz', live);
    // Compatibility alias no longer exposes dependency counts, credentials or raw errors.
    app.get('/health', live);
    app.get('/readyz', async (req, res) => {
        const ok = await readiness();
        res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'not_ready', service });
    });
    app.get('/metrics', async (req, res) => {
        if (!sameSecret(req.headers.authorization, `Bearer ${metricsToken}`) || metricsToken.length < 32) {
            return res.status(403).json({ errCode: 403, errMessage: 'Forbidden' });
        }
        try { res.type(registry.contentType).send(await registry.metrics()); }
        catch { res.status(503).end(); }
    });

    const stop = () => {
        if (shutdown) return shutdown;
        draining = true;
        ready.set(0);
        shutdown = bounded(async () => {
            const httpClosed = new Promise((resolve, reject) => {
                if (!server?.listening) return resolve();
                server.close((error) => error ? reject(error) : resolve());
                server.closeIdleConnections?.();
            });
            // Cancel producers/consumers first; retain DB connections until all work settles.
            await Promise.all([httpClosed, ...stopHooks.map((hook) => Promise.resolve().then(hook))]);
            const closed = await Promise.allSettled(closeHooks.map((hook) => Promise.resolve().then(hook)));
            if (closed.some((result) => result.status === 'rejected')) throw new Error('Resource close failed');
        }, shutdownMs).catch((error) => {
            for (const socket of sockets) socket.destroy();
            logger.error('graceful shutdown incomplete', { service, error: error.message });
            throw error;
        });
        return shutdown;
    };
    const attach = (httpServer, { signals = true } = {}) => {
        server = httpServer;
        started = true;
        if (server) {
            server.requestTimeout = 30000;
            server.headersTimeout = 15000;
            server.on('connection', (socket) => {
                sockets.add(socket);
                socket.once('close', () => sockets.delete(socket));
            });
        }
        if (signals) {
            const signal = () => { void stop().then(() => process.exit(0), () => process.exit(1)); };
            process.once('SIGTERM', signal);
            process.once('SIGINT', signal);
        }
    };
    return { attach, stop, readiness, registry, onStop: (hook) => stopHooks.push(hook), onClose: (hook) => closeHooks.push(hook) };
};
