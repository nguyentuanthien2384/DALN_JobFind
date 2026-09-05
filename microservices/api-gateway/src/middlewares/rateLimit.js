import Redis from 'ioredis';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('api-gateway');

// Chong spam bang Redis.
//
// Dem trong bo nho khong dung duoc o day: Gateway co the chay nhieu ban sao de
// chiu tai, va moi ban sao se giu mot bo dem rieng - ke tan cong chi can rai
// request deu ra cac ban sao la vuot han muc. Redis cho tat ca cung dem mot cho.

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
            if (count === 1) {
                await redis.expire(key, windowSeconds);
            }

            const ttl = await redis.ttl(key);
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
                res.json = (body) => {
                    const ok = res.statusCode < 400 && body?.errCode === 0;
                    if (ok) redis.decr(key).catch(() => {});
                    return originalJson(body);
                };
            }

            return next();
        } catch (error) {
            logger.warn('rate limit unavailable', { limiter: name, failClosed });
            return unavailable();
        }
    };
};

export const closeRedis = () => redis.quit().catch(() => {});
export const checkRedis = async () => redisReady && await redis.ping() === 'PONG';
