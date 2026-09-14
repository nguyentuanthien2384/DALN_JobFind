const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-streams-adapter');
const limiter = require('../utils/realtimeLimiter');
const metrics = require('../utils/realtimeMetrics');
let client;
export const connectSocketRedis = async () => {
    if (!process.env.SOCKET_REDIS_URL) return undefined;
    const prefix = limiter.prefix();
    client = createClient({ url: process.env.SOCKET_REDIS_URL, disableOfflineQueue: true,
        socket: { connectTimeout: 5000, reconnectStrategy: (retries) => Math.min(250 * (retries + 1), 5000) } });
    client.on('error', () => metrics.increment('socket_redis_errors_total'));
    let timeout;
    try {
        await Promise.race([client.connect(), new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Socket Redis startup timeout')), 8000);
        })]);
        limiter.setRedis(client);
        // The Streams reader must wait for reconnection. Inheriting the
        // fail-fast limiter policy makes its XREAD loop spin on rejected promises
        // and starves the Node event loop during a Redis outage (chaos-tested).
        const adapterClient = new Proxy(client, { get(target, property) {
            if (property === 'duplicate') return () => target.duplicate({ disableOfflineQueue: false, commandsQueueMaxLength: 1000 });
            // Adapter 0.3.x does not await ephemeral publish/session SET. These
            // are best-effort; missing recovery falls back to SQL reconciliation.
            if (['publish', 'sPublish', 'set'].includes(property)) return (...args) => target[property](...args).catch(() => {
                metrics.increment('socket_publish_errors_total'); return null;
            });
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
        } });
        return createAdapter(adapterClient, { streamName: `${prefix}:socket.io`, channelPrefix: `${prefix}:socket.io`, sessionKeyPrefix: `${prefix}:session:`, maxLen: 10000 });
    } catch (error) {
        client.destroy(); client = null;
        throw error;
    } finally { clearTimeout(timeout); }
};
export const closeSocketRedis = async () => {
    limiter.setRedis(null);
    const closing = client; client = null;
    // Drain pending session/stream writes before closing the publisher. Destroy
    // rejects those promises during Socket.IO shutdown and can crash the process.
    if (closing?.isOpen) await closing.close();
};
