const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-streams-adapter');
const limiter = require('../utils/realtimeLimiter');
const metrics = require('../utils/realtimeMetrics');
let client;
export const connectSocketRedis = async () => {
    if (!process.env.SOCKET_REDIS_URL) return undefined;
    client = createClient({ url: process.env.SOCKET_REDIS_URL, disableOfflineQueue: true,
        socket: { connectTimeout: 5000, reconnectStrategy: (retries) => Math.min(250 * (retries + 1), 5000) } });
    client.on('error', () => metrics.increment('socket_redis_errors_total'));
    let timeout;
    try {
        await Promise.race([client.connect(), new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Socket Redis startup timeout')), 8000);
        })]);
        limiter.setRedis(client);
        return createAdapter(client, { streamName: 'jobfind:socket.io', maxLen: 10000 });
    } catch (error) {
        client.destroy(); client = null;
        throw error;
    } finally { clearTimeout(timeout); }
};
export const closeSocketRedis = async () => {
    limiter.setRedis(null);
    if (client) { client.destroy(); client = null; }
};
