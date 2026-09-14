// Shared by all sockets for a user and by the REST send path. Redis mode uses an
// atomic fixed window across processes; failures fail closed before any write.
const buckets = new Map();
const connections = new Map();
let redis = null;
const prefix = () => {
    const value = process.env.SOCKET_REDIS_PREFIX || 'jobfind';
    if (!/^[A-Za-z0-9:_-]{1,64}$/.test(value)) throw new Error('Invalid SOCKET_REDIS_PREFIX');
    return value;
};
const LUA = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('PTTL',KEYS[1])}";
const consume = async (key, limit, windowMs) => {
    if (redis) {
        if (!redis.isReady) throw new Error('REALTIME_LIMITER_UNAVAILABLE');
        const [count, ttl] = await redis.eval(LUA, { keys: [`${prefix()}:realtime:limit:${key}`], arguments: [String(windowMs)] });
        return { allowed: count <= limit, retryAfterMs: Math.max(1, ttl) };
    }
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) {
        if (buckets.size >= 10000) {
            for (const [k, b] of buckets) if (b.until <= now) buckets.delete(k);
            if (buckets.size >= 10000) return { allowed: false, retryAfterMs: windowMs };
        }
        bucket = { count: 0, until: now + windowMs };
        buckets.set(key, bucket);
    }
    return { allowed: ++bucket.count <= limit, retryAfterMs: bucket.until - now };
};
const connectionKey = (userId) => `${prefix()}:realtime:connections:${userId}`;
const slot = async (userId, lease, renew = false) => {
    const now = Date.now(), until = now + 60000;
    if (redis) {
        if (!redis.isReady) throw new Error('REALTIME_LIMITER_UNAVAILABLE');
        const script = "redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); "
            + (renew ? "if not redis.call('ZSCORE',KEYS[1],ARGV[3]) then return 0 end; " : "if redis.call('ZCARD',KEYS[1])>=10 then return 0 end; ")
            + "redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3]); redis.call('PEXPIRE',KEYS[1],60000); return 1";
        return (await redis.eval(script, { keys: [connectionKey(userId)], arguments: [String(now), String(until), lease] })) === 1;
    }
    // Bound memory even when a peer disconnects before namespace acceptance.
    for (const [key, value] of connections) if (value.until <= now) connections.delete(key);
    if (renew && !connections.has(lease)) return false;
    if (!renew && (connections.size >= 10000 || [...connections.values()].filter((value) => value.userId === userId).length >= 10)) return false;
    connections.set(lease, { userId, until }); return true;
};
const release = async (userId, lease) => {
    if (redis) { if (redis.isReady) await redis.zRem(connectionKey(userId), lease); }
    else connections.delete(lease);
};
module.exports = { prefix, consume, slot, release, setRedis: (client) => { redis = client; }, reset: () => { buckets.clear(); connections.clear(); redis = null; } };
