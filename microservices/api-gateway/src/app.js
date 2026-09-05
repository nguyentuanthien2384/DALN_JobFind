import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { createServiceRuntime } from '../../shared/serviceRuntime.js';
import { requestBodies, safeHttpError } from '../../shared/httpBoundary.js';
import { rejectUnknownModernRoute } from '../../shared/requestContract.js';
import { checkAccountStore, closeAccountStore } from './libs/accountStore.js';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createLogger } from '../../shared/logger.js';
import { listServices, startHealthPolling } from './libs/registry.js';
import { createProxy, getBreakerStats } from './middlewares/proxy.js';
import { optionalAuth, requireAuth, requireRole, requirePermission } from './middlewares/auth.js';
import { PERMISSIONS } from '../../shared/accessControl.js';
import { assertSecureJwtSecret, getJwtPolicy } from '../../shared/securityConfig.js';
import { createRateLimiter, checkRedis, closeRedis } from './middlewares/rateLimit.js';
import { auditMiddleware } from './middlewares/audit.js';
import {
    applySocketCorsHeaders,
    createSocketUpgradeHandler,
    mountLoginRateLimit,
    parseAllowedOrigins,
    parseTrustedProxies,
    hasInternalPathSegment,
    rejectUnsafeProxyPath
} from './libs/security.js';

const logger = createLogger('api-gateway');
assertSecureJwtSecret(process.env.JWT_SECRET);
getJwtPolicy();
const app = express();
const PORT = Number(process.env.PORT || 4000);
const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);
const runtime = createServiceRuntime(app, { service: 'api-gateway', logger,
    checks: { mysql: () => checkAccountStore(), redis: () => checkRedis() } });
runtime.onClose(() => closeAccountStore());
runtime.onClose(() => closeRedis());

// Mac dinh false: bo qua hoan toan X-Forwarded-For do client tu gui. Neu co
// reverse proxy, TRUST_PROXY phai la IP/CIDR cu the cua proxy do.
app.set('trust proxy', parseTrustedProxies(process.env.TRUST_PROXY));

app.use(cors({
    origin: allowedOrigins,
    exposedHeaders: ['Retry-After', 'X-Correlation-Id'],
    credentials: true
}));
// Chan path traversal truoc moi route/proxy va truoc ca body parser.
app.use(rejectUnsafeProxyPath);
// Socket.IO phai duoc chuyen tiep TRUOC express.json().
//
// Hai ly do: (1) body parser doc het luong du lieu, sau do khong con gi de chuyen
// tiep; (2) WebSocket can giao thuc nang cap ket noi (HTTP Upgrade), ma lop proxy
// dua tren axios o duoi khong lam duoc - no chi biet request/response thong thuong.
// Neu thieu doan nay, chat va thong bao realtime se chet lang khi frontend tro
// vao Gateway.
// Dung pathFilter thay vi app.use('/socket.io', ...): khi mount theo tien to,
// Express cat bo '/socket.io' khoi req.url, ben duoi nhan duoc '/?EIO=4...' va
// tra 404. pathFilter giu nguyen duong dan day du.
const socketProxy = createProxyMiddleware({
    target: process.env.LEGACY_URL || 'http://host.docker.internal:5000',
    changeOrigin: true,
    ws: true,
    pathFilter: '/socket.io/**',
    on: {
        proxyRes: (proxyRes, req) => applySocketCorsHeaders(proxyRes, req, allowedOrigins)
    }
});
app.use(socketProxy);

app.use(requestBodies(express));


app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        logger[level]('request', {
            method: req.method,
            route: req.route?.path || req.metricRoute || 'unmatched',
            status: res.statusCode,
            durationMs: Date.now() - start,
            requestId: req.correlationId
        });
    });
    next();
});

app.use(optionalAuth);
// Ghi nhat ky sau optionalAuth de biet ai thao tac, truoc cac route de bao phu het.
app.use(auditMiddleware);

// ===================== HAN MUC GOI =====================
const loginLimiter = createRateLimiter({
    name: 'login', windowSeconds: 900, max: 10, countOnlyFailures: true, failClosed: true
});
const publicLimiter = createRateLimiter({ name: 'public', windowSeconds: 60, max: 120 });
const writeLimiter = createRateLimiter({ name: 'write', windowSeconds: 60, max: 30 });
// AI ton kem nen siet chat hon han cac API thuong.
const aiLimiter = createRateLimiter({ name: 'ai', windowSeconds: 3600, max: 30, failClosed: true });

// Route nay tiep tuc roi xuong proxy legacy o cuoi file sau khi vuot qua limiter.
// Dat rieng tai day de moi IP co toi da 10 lan dang nhap that bai / 15 phut.
mountLoginRateLimit(app, loginLimiter);

// ===================== GIAM SAT =====================
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'api-gateway',
        message: 'Job Finder API Gateway is running',
        endpoints: {
            health: '/health',
            status: '/status',
            api: '/api'
        }
    });
});


// Cho biet service nao dang song va circuit breaker dang o trang thai nao.
app.get('/status', requireAuth, requireRole('ADMIN'), (req, res) => {
    res.json({
        gateway: 'ok',
        services: listServices(),
        circuitBreakers: getBreakerStats()
    });
});

// ===================== DINH TUYEN =====================
app.use(rejectUnknownModernRoute);
// Cac duong dan noi bo (/internal/*) khong duoc mo ra ngoai: chung danh cho
// cac service goi lan nhau trong mang Docker.
app.use((req, res, next) => {
    const rawPath = String(req.originalUrl || req.url || '').split('?')[0];
    if (hasInternalPathSegment(rawPath)) {
        return res.status(404).json({ errCode: 404, errMessage: 'Not found' });
    }
    next();
});

// Voi app.use(tien_to), req.path la phan con lai sau tien to.
const sub = (prefix) => (req) => `${prefix}${req.path === '/' ? '' : req.path}`;

// --- Identity & Profile Service ---
app.use('/api/profile/cvs', requirePermission(PERMISSIONS.CV_SELF_MANAGE),
    createProxy('identity', sub('/profile/cvs')));
app.use('/api/profile', requirePermission(PERMISSIONS.PROFILE_SELF),
    createProxy('identity', sub('/profile')));

// --- Search & Discovery (ben Doc) - mo cho khach vang lai ---
app.use('/api/search', publicLimiter, createProxy('search', sub('/search')));

// --- Job Core (ben Ghi) - phai dang nhap va dung vai tro ---
// Day la app.post/get chu khong phai app.use, nen req.path la duong dan day du.
// Dung req.params de dung lai duong dan cua service ben duoi.
app.post('/api/jobs', writeLimiter,
    requirePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true }),
    createProxy('jobs', () => '/jobs'));
app.put('/api/jobs/:id', writeLimiter,
    requirePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true }),
    createProxy('jobs', (req) => `/jobs/${req.params.id}`));
app.delete('/api/jobs/:id', writeLimiter,
    requirePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true }),
    createProxy('jobs', (req) => `/jobs/${req.params.id}`));
app.get('/api/jobs/:id', publicLimiter, createProxy('jobs', (req) => `/jobs/${req.params.id}`));

// --- Quan ly ho so ung tuyen (Application & Workflow Service) ---
// Ung vien chi duoc xem lich su ung tuyen cua chinh minh.
app.get('/api/my-applications', requirePermission(PERMISSIONS.APPLICATION_SELF_READ),
    createProxy('applications', () => '/my-applications'));
// Danh sach cac buoc trong pipeline - giao dien can de ve cot Kanban.
app.get('/api/applications/stages',
    requirePermission(PERMISSIONS.APPLICATION_MANAGE, { companyRequired: true }),
    createProxy('applications', () => '/applications/stages'));
// Toan bo phan con lai chi danh cho nha tuyen dung.
app.use('/api/applications',
    requirePermission(PERMISSIONS.APPLICATION_MANAGE, { companyRequired: true }),
    createProxy('applications', sub('/applications')));
app.use('/api/talent-pool',
    requirePermission(PERMISSIONS.TALENT_POOL_MANAGE, { companyRequired: true }),
    createProxy('applications', sub('/talent-pool')));

// --- Bao cao & quan tri (Admin & Reporting Service) - chi ADMIN ---
app.use('/api/admin', requirePermission(PERMISSIONS.ADMIN_READ), createProxy('admin', sub('')));

// --- Cac tinh nang AI ---
app.use('/api/ai', requirePermission(PERMISSIONS.AI_CANDIDATE_USE), aiLimiter,
    createProxy('jobs', sub('/ai')));

// --- Monolith cu: moi thu chua tach ra van chay binh thuong qua Gateway ---
// Nho nhanh nay, frontend chi can tro vao Gateway mot lan duy nhat; viec tach
// dan tung tinh nang ve sau khong bat frontend phai sua lai.
app.use('/api', createProxy('legacy', sub('/api')));

app.use((req, res) => {
    res.status(404).json({ errCode: 404, errMessage: `Không tìm thấy ${req.method} ${req.originalUrl}` });
});

// eslint-disable-next-line no-unused-vars
app.use(safeHttpError);

// Tu tao http server thay vi dung app.listen(): can bat su kien 'upgrade' de
// WebSocket bat tay duoc: Express khong xu ly su kien nay.
const server = http.createServer(app);
server.on('upgrade', createSocketUpgradeHandler({
    allowedOrigins,
    upgrade: socketProxy.upgrade,
    logger
}));

server.listen(PORT, () => {
    logger.info(`API Gateway dang chay tren cong ${PORT}`);
    for (const svc of listServices()) {
        logger.info(`  dinh tuyen ${svc.key} -> ${svc.baseUrl}`);
    }
    logger.info('  chuyen tiep WebSocket /socket.io -> backend cu');
    // Do suc khoe dinh ky de /status luon phan anh dung thuc te.
    const timer = startHealthPolling();
    runtime.onStop(() => clearInterval(timer));
});
runtime.attach(server);
