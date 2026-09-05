import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServiceRuntime, correlationId } from '../shared/serviceRuntime.js';
import { requestBodies, safeHttpError } from '../shared/httpBoundary.js';

const instances = [];
const token = 'runtime-metrics-test-token-0123456789';
const start = async (options = {}, routes = () => {}) => {
    const app = express();
    const runtime = createServiceRuntime(app, { service: 'test-service', metricsToken: token,
        defaultMetrics: false, logger: { error: vi.fn() }, ...options });
    routes(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    runtime.attach(server, { signals: false });
    instances.push({ runtime, server });
    const base = `http://127.0.0.1:${server.address().port}`;
    return { runtime, server, get: (path, options) => fetch(`${base}${path}`, options) };
};
afterEach(async () => {
    for (const { runtime, server } of instances.splice(0)) {
        await runtime.stop().catch(() => {});
        server.closeAllConnections();
        server.close();
    }
});

describe('operations endpoints over real HTTP', () => {
    it('keeps liveness up while a dependency is unavailable and returns no private errors', async () => {
        let online = false;
        const { get } = await start({ checks: { db: () => { if (!online) throw new Error('password=mysql-secret'); } } });
        expect((await get('/healthz')).status).toBe(200);
        const unavailable = await get('/readyz');
        expect(unavailable.status).toBe(503);
        expect(await unavailable.text()).not.toContain('mysql-secret');
        online = true;
        expect((await get('/readyz')).status).toBe(200);
    });
    it('bounds readiness time and does not queue more checks behind a hung dependency', async () => {
        let finish;
        const check = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        const { get } = await start({ checks: { db: check }, probeTimeoutMs: 15 });
        expect((await get('/readyz')).status).toBe(503);
        expect((await get('/readyz')).status).toBe(503);
        expect(check).toHaveBeenCalledOnce();
        finish(true);
    });
    it('protects metrics, exposes bounded route labels and excludes query strings/identifiers', async () => {
        const { get } = await start({}, (app) => app.get('/jobs/:id', (req, res) => res.sendStatus(204)));
        expect((await get('/metrics')).status).toBe(403);
        expect((await get('/metrics', { headers: { authorization: 'Bearer wrong' } })).status).toBe(403);
        await get('/jobs/54321?email=private@example.com');
        await get('/jobs/99999');
        const response = await get('/metrics', { headers: { authorization: `Bearer ${token}` } });
        const metrics = await response.text();
        expect(response.status).toBe(200);
        expect(metrics).toContain('route="/jobs/:id"');
        expect(metrics).toMatch(/jobfind_http_requests_total\{[^\n]+\} 2/);
        expect(metrics).not.toMatch(/54321|99999|private@example.com/);
        expect(metrics).toMatch(/jobfind_http_active\{[^\n]+\} 0/);
    });
    it('fails closed with an unconfigured metrics credential', async () => {
        const { get } = await start({ metricsToken: '' });
        expect((await get('/metrics', { headers: { authorization: 'Bearer ' } })).status).toBe(403);
    });
    it('normalizes correlation IDs before echoing them', async () => {
        expect(correlationId('safe-id:123')).toBe('safe-id:123');
        expect(correlationId('x'.repeat(129))).toMatch(/^[a-f0-9-]{36}$/);
        const { get } = await start();
        const response = await get('/health', { headers: { 'x-correlation-id': 'bad id' } });
        expect(response.headers.get('x-correlation-id')).toMatch(/^[a-f0-9-]{36}$/);
    });
    it('waits for active HTTP and background work before closing data connections', async () => {
        let completeRequest, completeWork;
        const close = vi.fn();
        const work = new Promise((resolve) => { completeWork = resolve; });
        const { get, runtime } = await start({}, (app) => app.post('/write', (req, res) => {
            completeRequest = () => res.json({ saved: true });
        }));
        runtime.onStop(() => work);
        runtime.onClose(close);
        const request = get('/write', { method: 'POST' });
        await vi.waitFor(() => expect(completeRequest).toBeTypeOf('function'));
        const stopped = runtime.stop();
        expect(runtime.stop()).toBe(stopped);
        expect(await runtime.readiness()).toBe(false);
        expect(close).not.toHaveBeenCalled();
        completeRequest();
        expect((await request).status).toBe(200);
        expect(close).not.toHaveBeenCalled();
        completeWork();
        await stopped;
        expect(close).toHaveBeenCalledOnce();
    });
    it('fails a timed-out drain rather than reporting a clean shutdown', async () => {
        const { runtime } = await start({ shutdownMs: 15 });
        runtime.onStop(() => new Promise(() => {}));
        await expect(runtime.stop()).rejects.toThrow('timed out');
    });
});

describe('HTTP body boundaries', () => {
    it('uses a small default budget and a separate resume upload budget', async () => {
        const { get } = await start({}, (app) => {
            app.use(requestBodies(express));
            app.post(['/api/login', '/api/ai/parse-resume'], (req, res) => res.json({ ok: true }));
            app.use(safeHttpError);
        });
        const body = JSON.stringify({ text: 'a'.repeat(1024 * 1024 + 1) });
        const headers = { 'content-type': 'application/json' };
        expect((await get('/api/login', { method: 'POST', headers, body })).status).toBe(413);
        expect((await get('/api/ai/parse-resume', { method: 'POST', headers, body })).status).toBe(200);
        const invalid = await get('/api/login', { method: 'POST', headers, body: '{secret' });
        expect(invalid.status).toBe(400);
        expect(await invalid.text()).not.toContain('secret');
    });
});
