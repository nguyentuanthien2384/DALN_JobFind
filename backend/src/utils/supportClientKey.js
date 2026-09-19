const { createHmac, timingSafeEqual } = require('node:crypto');
const { isIP } = require('node:net');

// Only the trusted gateway can supply a visitor address. Spoofed headers fall back to socket IP.
const supportClientKey = (req) => {
    const ip = req.headers?.['x-support-ip'];
    const signature = req.headers?.['x-support-signature'];
    if (process.env.INTERNAL_SECRET && typeof ip === 'string' && isIP(ip)
        && typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature)) {
        const expected = createHmac('sha256', process.env.INTERNAL_SECRET).update(ip).digest();
        if (timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return ip;
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
};
module.exports = { supportClientKey };
