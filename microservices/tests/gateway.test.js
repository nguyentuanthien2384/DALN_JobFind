import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';

const mocks = vi.hoisted(() => {
    const axios = vi.fn();
    axios.post = vi.fn();
    const verify = vi.fn();
    const resolveCurrentIdentity = vi.fn();
    const breakerInstances = [];
    class Breaker {
        constructor(action, options) {
            this.action = action;
            this.options = options;
            this.handlers = {};
            this.fire = vi.fn((args) => action(args));
            this.stats = { successes: 0, failures: 0, timeouts: 0, rejects: 0 };
            this.opened = false;
            this.halfOpen = false;
            breakerInstances.push(this);
        }
        on(name, callback) { this.handlers[name] = callback; return this; }
    }
    const redisInstances = [];
    class Redis {
        constructor(url, options) {
            this.url = url;
            this.options = options;
            this.handlers = {};
            this.connect = vi.fn().mockResolvedValue(undefined);
            this.incr = vi.fn();
            this.expire = vi.fn().mockResolvedValue(1);
            this.ttl = vi.fn().mockResolvedValue(30);
            this.decr = vi.fn().mockResolvedValue(0);
            this.quit = vi.fn().mockResolvedValue(undefined);
            redisInstances.push(this);
        }
        on(name, callback) { this.handlers[name] = callback; return this; }
    }
    return { axios, verify, resolveCurrentIdentity, Breaker, breakerInstances, Redis, redisInstances };
});

vi.mock('axios', () => ({ default: mocks.axios }));
vi.mock('jsonwebtoken', () => ({ default: { verify: mocks.verify } }));
vi.mock('../api-gateway/src/libs/accountStore.js', () => ({
    resolveCurrentIdentity: mocks.resolveCurrentIdentity
}));
vi.mock('opossum', () => ({ default: mocks.Breaker }));
vi.mock('ioredis', () => ({ default: mocks.Redis }));

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('gateway authentication', () => {
    beforeEach(() => {
        mocks.verify.mockReset();
        mocks.resolveCurrentIdentity.mockReset().mockResolvedValue({
            id: 9, roleCode: 'ADMIN', companyId: 4, statusCode: 'S1',
            companyStatusCode: 'S1', companyCensorCode: 'CS1'
        });
    });

    it('optionally attaches a normalized JWT identity', async () => {
        mocks.verify.mockReturnValue({ sub: 9, roleCode: 'ADMIN', companyId: 4 });
        const { optionalAuth } = await import('../api-gateway/src/middlewares/auth.js');
        const req = makeReq({ headers: { authorization: 'Bearer token' } });
        const next = vi.fn();
        await optionalAuth(req, makeRes(), next);
        expect(mocks.verify.mock.calls[0][0]).toBe('token');
        expect(req.user).toEqual({
            id: 9, roleCode: 'ADMIN', companyId: 4,
            companyStatusCode: 'S1', companyCensorCode: 'CS1'
        });
        expect(next).toHaveBeenCalledOnce();
    });

    it('treats missing, empty, and invalid tokens as anonymous', async () => {
        mocks.verify.mockImplementation(() => { throw new Error('invalid'); });
        const { optionalAuth } = await import('../api-gateway/src/middlewares/auth.js');
        for (const authorization of [undefined, 'Bearer ', 'bad']) {
            const req = makeReq({ headers: authorization ? { authorization } : {} });
            const next = vi.fn();
            await optionalAuth(req, makeRes(), next);
            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalledOnce();
        }
    });

    it('requires login and supports tokens using id', async () => {
        const { requireAuth } = await import('../api-gateway/src/middlewares/auth.js');
        const denied = makeRes();
        await requireAuth(makeReq(), denied, vi.fn());
        expect(denied.statusCode).toBe(401);

        mocks.verify.mockReturnValue({ id: 12 });
        mocks.resolveCurrentIdentity.mockResolvedValue({
            id: 12, roleCode: 'CANDIDATE', companyId: null, statusCode: 'S1'
        });
        const req = makeReq({ headers: { authorization: 'plain-token' } });
        const next = vi.fn();
        await requireAuth(req, makeRes(), next);
        expect(req.user).toEqual({
            id: 12, roleCode: 'CANDIDATE', companyId: null,
            companyStatusCode: null, companyCensorCode: null
        });
        expect(next).toHaveBeenCalledOnce();
    });

    it('uses current DB role/company instead of stale JWT claims', async () => {
        mocks.verify.mockReturnValue({
            sub: 9, roleCode: 'ADMIN', companyId: 999
        });
        mocks.resolveCurrentIdentity.mockResolvedValue({
            id: 9, roleCode: 'EMPLOYER', companyId: 7, statusCode: 'S1',
            companyStatusCode: 'S1', companyCensorCode: 'CS1'
        });
        const { optionalAuth } = await import('../api-gateway/src/middlewares/auth.js');
        const req = makeReq({ headers: { authorization: 'Bearer stale-token' } });
        await optionalAuth(req, makeRes(), vi.fn());
        expect(req.user).toEqual({
            id: 9, roleCode: 'EMPLOYER', companyId: 7,
            companyStatusCode: 'S1', companyCensorCode: 'CS1'
        });
        expect(mocks.resolveCurrentIdentity).toHaveBeenCalledWith(9);
    });

    it('rejects inactive/unknown accounts and fails closed when identity DB is unavailable', async () => {
        mocks.verify.mockReturnValue({ sub: 9 });
        const { requireAuth } = await import('../api-gateway/src/middlewares/auth.js');

        mocks.resolveCurrentIdentity.mockResolvedValueOnce({
            id: 9, roleCode: 'COMPANY', companyId: 2, statusCode: 'S2'
        });
        const inactive = makeRes();
        await requireAuth(makeReq({ headers: { authorization: 'Bearer token' } }), inactive, vi.fn());
        expect(inactive.statusCode).toBe(403);

        mocks.resolveCurrentIdentity.mockResolvedValueOnce(null);
        const deleted = makeRes();
        await requireAuth(makeReq({ headers: { authorization: 'Bearer token' } }), deleted, vi.fn());
        expect(deleted.statusCode).toBe(401);

        mocks.resolveCurrentIdentity.mockRejectedValueOnce(new Error('db down'));
        const unavailable = makeRes();
        await requireAuth(makeReq({ headers: { authorization: 'Bearer token' } }), unavailable, vi.fn());
        expect(unavailable.statusCode).toBe(503);
    });

    it('enforces roles after authentication', async () => {
        const { requireRole } = await import('../api-gateway/src/middlewares/auth.js');
        const middleware = requireRole('ADMIN', 'COMPANY');
        const noUser = makeRes();
        middleware(makeReq(), noUser, vi.fn());
        expect(noUser.statusCode).toBe(401);
        const wrong = makeRes();
        middleware(makeReq({ user: { roleCode: 'CANDIDATE' } }), wrong, vi.fn());
        expect(wrong.statusCode).toBe(403);
        const next = vi.fn();
        middleware(makeReq({ user: { roleCode: 'ADMIN' } }), makeRes(), next);
        expect(next).toHaveBeenCalledOnce();
    });

    it('enforces the centralized permission matrix and company scope', async () => {
        const { requirePermission } = await import('../api-gateway/src/middlewares/auth.js');
        const { PERMISSIONS } = await import('../shared/accessControl.js');
        const middleware = requirePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true });

        const candidate = makeRes();
        middleware(makeReq({ user: { id: 1, roleCode: 'CANDIDATE' } }), candidate, vi.fn());
        expect(candidate.statusCode).toBe(403);

        const companyless = makeRes();
        middleware(makeReq({ user: { id: 2, roleCode: 'EMPLOYER', companyId: null } }), companyless, vi.fn());
        expect(companyless.statusCode).toBe(403);

        const companylessAdminNext = vi.fn();
        middleware(makeReq({ user: {
            id: 9, roleCode: 'ADMIN', companyId: null
        } }), makeRes(), companylessAdminNext);
        expect(companylessAdminNext).toHaveBeenCalledOnce();

        const next = vi.fn();
        middleware(makeReq({ user: {
            id: 2, roleCode: 'EMPLOYER', companyId: 7,
            companyStatusCode: 'S1', companyCensorCode: 'CS1'
        } }), makeRes(), next);
        expect(next).toHaveBeenCalledOnce();

        const pending = makeRes();
        middleware(makeReq({ user: {
            id: 2, roleCode: 'EMPLOYER', companyId: 7,
            companyStatusCode: 'S1', companyCensorCode: 'CS3'
        } }), pending, vi.fn());
        expect(pending.statusCode).toBe(403);
    });
});

describe('gateway audit middleware', () => {
    beforeEach(() => mocks.axios.post.mockReset().mockResolvedValue({}));

    it('ignores read-only and sensitive requests', async () => {
        const { auditMiddleware } = await import('../api-gateway/src/middlewares/audit.js');
        for (const req of [
            makeReq({ method: 'GET' }),
            makeReq({ method: 'POST', originalUrl: '/api/login' }),
            makeReq({ method: 'PATCH', originalUrl: '/changePassword' })
        ]) {
            const next = vi.fn();
            const res = makeRes();
            auditMiddleware(req, res, next);
            expect(next).toHaveBeenCalledOnce();
            expect(res.on).not.toHaveBeenCalled();
        }
    });

    it('posts a sanitized action after the response finishes', async () => {
        vi.stubEnv('INTERNAL_SECRET', 'secret');
        vi.stubEnv('ADMIN_URL', 'http://admin');
        const { auditMiddleware } = await import('../api-gateway/src/middlewares/audit.js');
        const req = makeReq({
            method: 'POST', originalUrl: '/api/jobs?q=x', ip: '10.0.0.1',
            user: { id: 2, roleCode: 'COMPANY', companyId: 3 }
        });
        const res = makeRes();
        const next = vi.fn();
        auditMiddleware(req, res, next);
        res.statusCode = 201;
        res.listeners.finish();
        expect(mocks.axios.post).toHaveBeenCalledWith(
            'http://admin/internal/audit-action',
            expect.objectContaining({ method: 'POST', route: '/api/jobs', actorId: 2, status: 201 }),
            { headers: { 'x-internal-secret': 'secret' }, timeout: 3000 }
        );
    });

    it('does not send without the internal secret', async () => {
        const { auditMiddleware } = await import('../api-gateway/src/middlewares/audit.js');
        const res = makeRes();
        auditMiddleware(makeReq({ method: 'DELETE' }), res, vi.fn());
        res.listeners.finish();
        expect(mocks.axios.post).not.toHaveBeenCalled();
    });
});

describe('service registry', () => {
    it('resolves services, lists state, and ignores unknown health keys', async () => {
        const registry = await import('../api-gateway/src/libs/registry.js');
        expect(registry.getService('jobs')).toMatchObject({ name: 'job-core-service' });
        expect(registry.listServices()).toHaveLength(6);
        registry.markHealth('jobs', false, 'down');
        expect(registry.listServices().find((s) => s.key === 'jobs')).toMatchObject({ healthy: false, lastError: 'down' });
        expect(() => registry.markHealth('unknown', false)).not.toThrow();
        registry.markHealth('jobs', true);
    });

    it('polls every service and marks HTTP/network health', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn()
            .mockResolvedValueOnce({ status: 200 })
            .mockResolvedValueOnce({ status: 503 })
            .mockRejectedValueOnce(new Error('dns'))
            .mockResolvedValue({ status: 404 });
        vi.stubGlobal('fetch', fetch);
        const { startHealthPolling, listServices } = await import('../api-gateway/src/libs/registry.js');
        const timer = startHealthPolling(1000);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
        const states = listServices();
        expect(states[0].healthy).toBe(true);
        expect(states[1].healthy).toBe(false);
        expect(states[2]).toMatchObject({ healthy: false, lastError: 'dns' });
        expect(states[3]).toMatchObject({ healthy: false, lastError: 'HTTP 404' });
        clearInterval(timer);
    });
});

describe('Redis rate limiter', () => {
    let redis;
    let createRateLimiter;

    beforeEach(async () => {
        ({ createRateLimiter } = await import('../api-gateway/src/middlewares/rateLimit.js'));
        redis = mocks.redisInstances[0];
        redis.incr.mockReset();
        redis.expire.mockClear();
        redis.ttl.mockReset().mockResolvedValue(15);
        redis.decr.mockReset().mockResolvedValue(0);
    });

    it('fails open while Redis is unavailable', async () => {
        redis.handlers.error(new Error('offline'));
        const next = vi.fn();
        await createRateLimiter({ name: 'public', windowSeconds: 60, max: 2 })(makeReq(), makeRes(), next);
        expect(next).toHaveBeenCalledOnce();
        expect(redis.incr).not.toHaveBeenCalled();
    });

    it('counts by user, sets headers, and expires a new key', async () => {
        redis.handlers.ready();
        redis.incr.mockResolvedValue(1);
        const req = makeReq({ user: { id: 5 }, ip: 'x' });
        const res = makeRes();
        const next = vi.fn();
        await createRateLimiter({ name: 'write', windowSeconds: 60, max: 3 })(req, res, next);
        expect(redis.incr).toHaveBeenCalledWith('ratelimit:write:user:5');
        expect(redis.expire).toHaveBeenCalledWith('ratelimit:write:user:5', 60);
        expect(res.headers).toMatchObject({ 'X-RateLimit-Limit': 3, 'X-RateLimit-Remaining': 2 });
        expect(next).toHaveBeenCalledOnce();
    });

    it('isolates anonymous clients by the trusted req.ip and ignores spoofed headers', async () => {
        redis.handlers.ready();
        redis.incr.mockResolvedValue(1);
        const limiter = createRateLimiter({ name: 'login', windowSeconds: 900, max: 10 });

        await limiter(makeReq({
            ip: '203.0.113.10',
            headers: { 'x-forwarded-for': '198.51.100.99' }
        }), makeRes(), vi.fn());
        await limiter(makeReq({
            ip: '203.0.113.11',
            headers: { 'x-forwarded-for': '198.51.100.99' }
        }), makeRes(), vi.fn());

        expect(redis.incr).toHaveBeenNthCalledWith(1, 'ratelimit:login:ip:203.0.113.10');
        expect(redis.incr).toHaveBeenNthCalledWith(2, 'ratelimit:login:ip:203.0.113.11');
    });

    it('returns 429 with a retry delay after the limit', async () => {
        redis.handlers.ready();
        redis.incr.mockResolvedValue(4);
        const res = makeRes();
        await createRateLimiter({ name: 'public', windowSeconds: 60, max: 3 })(makeReq({ ip: '1.2.3.4' }), res, vi.fn());
        expect(res.statusCode).toBe(429);
        expect(res.headers['Retry-After']).toBe(15);
        expect(res.body.errCode).toBe(429);
    });

    it('refunds successful login attempts and fails open on Redis errors', async () => {
        redis.handlers.ready();
        redis.incr.mockResolvedValueOnce(2).mockRejectedValueOnce(new Error('redis down'));
        const limiter = createRateLimiter({ name: 'login', windowSeconds: 10, max: 3, countOnlyFailures: true });
        const res = makeRes();
        const original = res.json;
        await limiter(makeReq(), res, vi.fn());
        res.json({ errCode: 0 });
        expect(redis.decr).toHaveBeenCalled();
        expect(original).toHaveBeenCalledWith({ errCode: 0 });
        const next = vi.fn();
        await limiter(makeReq(), makeRes(), next);
        expect(next).toHaveBeenCalledOnce();
    });

    it('caps reconnect delay and closes Redis safely', async () => {
        const { closeRedis } = await import('../api-gateway/src/middlewares/rateLimit.js');
        expect(redis.options.retryStrategy(1)).toBe(500);
        expect(redis.options.retryStrategy(99)).toBe(5000);
        redis.quit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('closed'));
        await expect(closeRedis()).resolves.toBeUndefined();
        await expect(closeRedis()).resolves.toBeUndefined();
    });
});

describe('gateway HTTP and WebSocket security configuration', () => {
    it('rejects encoded path traversal before any route or downstream proxy', async () => {
        const {
            hasInternalPathSegment,
            isSafeProxyPath,
            rejectUnsafeProxyPath
        } = await import('../api-gateway/src/libs/security.js');
        expect(isSafeProxyPath('/api/search/jobs')).toBe(true);
        expect(isSafeProxyPath('/api/search/caf%C3%A9')).toBe(true);
        for (const unsafe of [
            '/api/%2e%2e/internal/emit-notification',
            '/api/search/%2e%2e/internal/reindex',
            '/api/jobs/..%2Finternal%2Fjobs',
            '/api/ai/.%2e/internal/jobs',
            '/api/applications/%252e%252e/internal/sync',
            '/api/admin/%2e./internal/audit-action',
            '/api/jobs/%5c..%5cinternal',
            '/api/jobs/%3finternal'
        ]) expect(isSafeProxyPath(unsafe)).toBe(false);

        const denied = makeRes();
        const next = vi.fn();
        rejectUnsafeProxyPath(makeReq({
            originalUrl: '/api/%2e%2e/internal/emit-notification?x=1'
        }), denied, next);
        expect(denied.statusCode).toBe(400);
        expect(next).not.toHaveBeenCalled();

        const allowedNext = vi.fn();
        rejectUnsafeProxyPath(makeReq({ originalUrl: '/api/search/jobs?q=node' }), makeRes(), allowedNext);
        expect(allowedNext).toHaveBeenCalledOnce();

        for (const internal of [
            '/internal/jobs',
            '/api/admin/internal/alias-map',
            '/api/admin/%69nternal/alias-map',
            '/api/admin/%2569nternal/alias-map'
        ]) expect(hasInternalPathSegment(internal)).toBe(true);
        expect(hasInternalPathSegment('/api/admin/internal-tools')).toBe(false);
        expect(hasInternalPathSegment('/api/search/jobs')).toBe(false);
    });

    it('normalizes and deduplicates a comma-separated CORS origin list', async () => {
        const { isOriginAllowed, parseAllowedOrigins } = await import('../api-gateway/src/libs/security.js');
        expect(parseAllowedOrigins(' http://localhost:3000/, https://jobs.example.com ,http://localhost:3000 '))
            .toEqual(['http://localhost:3000', 'https://jobs.example.com']);
        expect(() => parseAllowedOrigins('*')).toThrow(/khong duoc dung/);
        expect(() => parseAllowedOrigins('file:///tmp/app')).toThrow(/khong hop le/);
        expect(isOriginAllowed('not a URL', ['http://localhost:3000'])).toBe(false);
    });

    it('keeps forwarded IP headers disabled unless exact trusted proxies are configured', async () => {
        const { parseTrustedProxies } = await import('../api-gateway/src/libs/security.js');
        expect(parseTrustedProxies()).toBe(false);
        expect(parseTrustedProxies(' loopback, 172.18.0.10/32 '))
            .toEqual(['loopback', '172.18.0.10/32']);
        for (const unsafe of ['true', '*', 'all', '1', '0.0.0.0/0', '::/0']) {
            expect(() => parseTrustedProxies(unsafe)).toThrow(/khong an toan/);
        }
    });

    it('mounts the login limiter on POST /api/login', async () => {
        const { mountLoginRateLimit } = await import('../api-gateway/src/libs/security.js');
        const app = { post: vi.fn() };
        const limiter = vi.fn();
        mountLoginRateLimit(app, limiter);
        expect(app.post).toHaveBeenCalledWith('/api/login', limiter);
    });

    it('allows configured/missing Socket origins and rejects foreign websites', async () => {
        const { createSocketUpgradeHandler } = await import('../api-gateway/src/libs/security.js');
        const upgrade = vi.fn();
        const logger = { warn: vi.fn() };
        const handler = createSocketUpgradeHandler({
            allowedOrigins: ['http://localhost:3000', 'https://jobs.example.com'],
            upgrade,
            logger
        });
        const allowedSocket = { write: vi.fn(), destroy: vi.fn() };
        handler({ url: '/socket.io/?EIO=4', headers: { origin: 'https://jobs.example.com/' } }, allowedSocket, 'head-a');
        handler({ url: '/socket.io/?EIO=4', headers: {} }, allowedSocket, 'head-b');
        expect(upgrade).toHaveBeenCalledTimes(2);
        expect(allowedSocket.destroy).not.toHaveBeenCalled();

        const deniedSocket = { write: vi.fn(), destroy: vi.fn() };
        handler({ url: '/socket.io/?EIO=4', headers: { origin: 'https://evil.example' } }, deniedSocket, 'head-c');
        expect(deniedSocket.write).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'));
        expect(deniedSocket.destroy).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            origin: 'https://evil.example', path: '/socket.io/'
        }));
        expect(upgrade).toHaveBeenCalledTimes(2);

        const alreadyClosed = {
            write: vi.fn(() => { throw new Error('closed'); }),
            destroy: vi.fn()
        };
        expect(() => handler({ url: '/internal/jobs', headers: { origin: 'https://jobs.example.com' } }, alreadyClosed, 'head-d'))
            .not.toThrow();
        expect(alreadyClosed.destroy).toHaveBeenCalledOnce();
    });

    it('returns one valid CORS origin for proxied Socket polling responses', async () => {
        const { applySocketCorsHeaders } = await import('../api-gateway/src/libs/security.js');
        const allowedOrigins = ['http://localhost:3000', 'http://localhost:3001'];
        const response = { headers: {
            'access-control-allow-origin': 'http://localhost:3000,http://localhost:3001',
            'access-control-allow-credentials': 'true',
            vary: 'Accept-Encoding'
        } };
        applySocketCorsHeaders(response, {
            headers: { origin: 'http://localhost:3001/' }
        }, allowedOrigins);
        expect(response.headers).toMatchObject({
            'access-control-allow-origin': 'http://localhost:3001',
            'access-control-allow-credentials': 'true',
            vary: 'Accept-Encoding, Origin'
        });

        const denied = { headers: {
            'access-control-allow-origin': 'http://localhost:3000,http://localhost:3001',
            'access-control-allow-credentials': 'true'
        } };
        applySocketCorsHeaders(denied, {
            headers: { origin: 'https://evil.example' }
        }, allowedOrigins);
        expect(denied.headers['access-control-allow-origin']).toBeUndefined();
        expect(denied.headers['access-control-allow-credentials']).toBeUndefined();
    });
});

describe('circuit-breaker proxy', () => {
    beforeEach(() => {
        mocks.axios.mockReset();
        mocks.breakerInstances.length = 0;
    });

    it('forwards trusted identity while removing spoofable and hop-by-hop headers', async () => {
        vi.stubEnv('INTERNAL_SECRET', 'gateway-secret');
        mocks.axios.mockResolvedValue({ status: 201, headers: {}, data: { errCode: 0 } });
        const { createProxy } = await import('../api-gateway/src/middlewares/proxy.js');
        const req = makeReq({
            method: 'POST', path: '/jobs', query: { q: 'x' }, body: { name: 'A' },
            headers: {
                host: 'evil', connection: 'keep', 'content-length': '99',
                'x-user-id': '999', 'x-user-role': 'ADMIN',
                'x-company-id': '999', 'x-internal-secret': 'attacker-secret', custom: 'ok'
            },
            user: {
                id: 7, roleCode: 'COMPANY', companyId: 8,
                companyStatusCode: 'S1', companyCensorCode: 'CS1'
            }
        });
        const res = makeRes();
        await createProxy('jobs')(req, res, vi.fn());
        expect(res.statusCode).toBe(201);
        const request = mocks.axios.mock.calls[0][0];
        expect(request.url).toContain('job-core-service:4002/jobs');
        expect(request.headers).toMatchObject({
            custom: 'ok', 'x-user-id': '7', 'x-user-role': 'COMPANY',
            'x-company-id': '8', 'x-company-status': 'S1',
            'x-company-censor': 'CS1', 'x-correlation-id': 'corr-test',
            'x-internal-secret': 'gateway-secret'
        });
        expect(request.headers.host).toBeUndefined();
        expect(request.validateStatus(499)).toBe(true);
        expect(request.validateStatus(500)).toBe(false);
    });

    it('fails closed on unsafe downstream paths and never lends the internal secret to legacy APIs', async () => {
        vi.stubEnv('INTERNAL_SECRET', 'gateway-secret');
        const { createProxy } = await import('../api-gateway/src/middlewares/proxy.js');

        const denied = makeRes();
        await createProxy('jobs', () => '/jobs/../internal/jobs')(makeReq(), denied, vi.fn());
        expect(denied.statusCode).toBe(400);
        expect(mocks.axios).not.toHaveBeenCalled();

        mocks.axios.mockResolvedValueOnce({ status: 200, headers: {}, data: { errCode: 0 } });
        await createProxy('legacy', () => '/api/public')(makeReq({
            headers: { 'x-internal-secret': 'attacker-value' }
        }), makeRes(), vi.fn());
        const request = mocks.axios.mock.calls[0][0];
        expect(request.headers['x-internal-secret']).toBeUndefined();
    });

    it('delegates unknown services to error middleware', async () => {
        const { createProxy } = await import('../api-gateway/src/middlewares/proxy.js');
        const next = vi.fn();
        await createProxy('missing')(makeReq(), makeRes(), next);
        expect(next.mock.calls[0][0].message).toContain('missing');
    });

    it('maps open circuits to 503 and other failures to 502', async () => {
        const { createProxy } = await import('../api-gateway/src/middlewares/proxy.js');
        const middleware = createProxy('search', () => '/search/jobs');
        mocks.axios.mockRejectedValueOnce(Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }));
        const open = makeRes();
        await middleware(makeReq(), open, vi.fn());
        expect(open.statusCode).toBe(503);
        mocks.axios.mockRejectedValueOnce(new Error('socket hang up'));
        const failed = makeRes();
        await middleware(makeReq(), failed, vi.fn());
        expect(failed.statusCode).toBe(502);
    });

    it('reports breaker state and counters', async () => {
        const { createProxy, getBreakerStats } = await import('../api-gateway/src/middlewares/proxy.js');
        mocks.axios.mockResolvedValue({ status: 200, headers: {}, data: {} });
        await createProxy('admin')(makeReq(), makeRes(), vi.fn());
        const breaker = mocks.breakerInstances.at(-1);
        breaker.opened = true;
        breaker.stats = { successes: 2, failures: 1, timeouts: 1, rejects: 3 };
        expect(getBreakerStats().find((x) => x.service === 'admin')).toEqual({
            service: 'admin', state: 'open', stats: { successes: 2, failures: 1, timeouts: 1, rejects: 3 }
        });
        expect(() => breaker.handlers.open()).not.toThrow();
        expect(() => breaker.handlers.halfOpen()).not.toThrow();
        expect(() => breaker.handlers.close()).not.toThrow();
        expect(() => breaker.handlers.timeout()).not.toThrow();
    });
});
