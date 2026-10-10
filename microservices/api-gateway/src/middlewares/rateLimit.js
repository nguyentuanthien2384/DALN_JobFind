import Redis from 'ioredis';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('api-gateway');

// Chong spam bang Redis.
//
// Dem trong bo nho khong dung duoc o day: Gateway co the chay nhieu ban sao de
// chiu tai, va moi ban sao se giu mot bo dem rieng - ke tan cong chi can rai
// request deu ra cac ban sao la vuot han muc. Redis cho tat ca cung dem mot cho.
//
// ===== THUAT TOAN: FIXED WINDOW COUNTER (Redis INCR + EXPIRE, thu vien ioredis) =====
// Moi khoa "ratelimit:<ten>:<user|ip>" la mot bo dem; lan dem dau dat TTL = cua so.
// INCR la lenh nguyen tu cua Redis nen nhieu Gateway dem dong thoi van dung.
// Danh doi: o ranh gioi hai cua so co the lot toi 2x max trong thoi gian ngan. Sliding
// window (sorted set) hay token bucket chinh xac hon nhung ton bo nho/lenh hon; voi
// muc dich chong spam/brute-force o day, fixed window la du va re nhat.
// Header X-RateLimit-* va Retry-After theo quy uoc chung de client biet khi nao thu lai.
// failClosed: route AI (ton tien goi model) chan khi mat Redis; route thuong cho qua
// (fail-open) de mot su co Redis khong lam sap ca he thong.

const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 500, 5000)
});

let redisReady = false;
redis.on('ready', () => {
    redisReady = true;
    logger.info('da ket noi Redis cho rate limit');
});
redis.on('error', (err) => {
    if (redisReady) logger.warn('mat ket noi Redis', { error: err.message });
    redisReady = false;
});
redis.on('close', () => { redisReady = false; });
redis.on('end', () => { redisReady = false; });
redis.connect().catch((err) => logger.warn('chua ket noi duoc Redis', { error: err.message }));

const clientKey = (req) => {
    // Nguoi da dang nhap dem theo tai khoan; khach vang lai dem theo IP. Neu chi
    // dem theo IP thi ca mot van phong chung NAT se chia nhau mot han muc.
    if (req.user?.id) return `user:${req.user.id}`;
    return `ip:${req.ip}`;
};

export const createRateLimiter = ({ windowSeconds, max, name, countOnlyFailures = false, failClosed = false }) => {
    return async (req, res, next) => {
        // Redis chet thi cho request di qua. Chan het nguoi dung chi vi mat Redis
        // la tu bien mot su co phu thanh su co toan he thong.
        const unavailable = () => failClosed
            ? res.status(503).json({ errCode: 503, errMessage: 'Rate limiter unavailable; retry later' })
            : next();
        if (!redisReady) return unavailable();

        const key = `ratelimit:${name}:${clientKey(req)}`;

        try {
            const count = await redis.incr(key);
            let ttl = await redis.ttl(key);
            // INCR va EXPIRE la hai lenh rieng: neu EXPIRE chua tung chay (tien trinh
            // chet, mat phan hoi) thi key khong bao gio het han va khach bi chan mai mai.
            // Key khong co TTL (-1) duoc dat lai cua so thay vi giu bo dem vinh vien.
            if (count === 1 || ttl < 0) {
                await redis.expire(key, windowSeconds);
                ttl = windowSeconds;
            }
            res.setHeader('X-RateLimit-Limit', max);
            res.setHeader('X-RateLimit-Remaining', Math.max(max - count, 0));

            if (count > max) {
                res.setHeader('Retry-After', ttl > 0 ? ttl : windowSeconds);
                logger.warn('chan vi vuot han muc', { limiter: name, count, max });
                return res.status(429).json({
                    errCode: 429,
                    errMessage: `Bạn thao tác quá nhanh, vui lòng thử lại sau ${ttl > 0 ? ttl : windowSeconds} giây`
                });
            }

            if (countOnlyFailures) {
                // Dung cho dang nhap: chi lan that bai moi tinh vao han muc, nguoi
                // dung dung mat khau se khong bao gio bi khoa.
                const originalJson = res.json.bind(res);
                let refunded = false;
                const refund = () => { if (!refunded) { refunded = true; redis.decr(key).catch(() => {}); } };
                res.json = (body) => {
                    const ok = res.statusCode < 400 && body?.errCode === 0;
                    if (ok) refund();
                    return originalJson(body);
                };
                // Auth is an HTTP stream proxy, so successful responses bypass res.json.
                res.on?.('finish', () => { if (res.statusCode >= 200 && res.statusCode < 300) refund(); });
            }

            return next();
        } catch (error) {
            logger.warn('rate limit unavailable', { limiter: name, failClosed });
            return unavailable();
        }
    };
};

// Reading a persisted task does not call the model. Give polling its own short
// window so waiting for one task cannot exhaust the paid-generation allowance.
export const createAiRateLimiter = () => {
    const generation = createRateLimiter({ name: 'ai', windowSeconds: 3600, max: 30, failClosed: true });
    const taskRead = createRateLimiter({ name: 'ai-task-read', windowSeconds: 60, max: 120, failClosed: true });
    return (req, res, next) => (req.method === 'GET' ? taskRead : generation)(req, res, next);
};

export const closeRedis = () => redis.quit().catch(() => {});
export const checkRedis = async () => redisReady && await redis.ping() === 'PONG';
