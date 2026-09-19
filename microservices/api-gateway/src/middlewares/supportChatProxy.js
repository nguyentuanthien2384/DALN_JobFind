import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { createHmac } from 'node:crypto';

// Keep streaming separate from the JSON legacy proxy; never buffer AI responses.
export const createSupportChatProxy = (target = process.env.LEGACY_URL || 'http://host.docker.internal:5000') => createProxyMiddleware({
    target, changeOrigin: true, pathRewrite: () => '/api/support-chat',
    proxyTimeout: 65000, timeout: 65000,
    on: {
        proxyReq: (proxyReq, req, res) => {
            for (const header of ['authorization', 'cookie', 'x-user-id', 'x-user-role', 'x-company-id',
                'x-company-status', 'x-company-censor', 'x-internal-secret', 'x-support-ip', 'x-support-signature']) proxyReq.removeHeader(header);
            // A signed address keeps independent backend limits per visitor behind the gateway.
            const ip = req.ip || req.socket.remoteAddress;
            if (process.env.INTERNAL_SECRET && ip) {
                proxyReq.setHeader('x-support-ip', ip);
                proxyReq.setHeader('x-support-signature', createHmac('sha256', process.env.INTERNAL_SECRET).update(ip).digest('hex'));
            }
            const abort = () => { if (!res.writableEnded) proxyReq.destroy(); };
            res.once('close', abort);
            res.once('finish', () => res.off('close', abort));
            fixRequestBody(proxyReq, req);
        },
        proxyRes: (upstream, _req, res) => {
            const abort = () => { if (!upstream.complete) upstream.destroy(); };
            res.once('close', abort);
            upstream.once('end', () => res.off('close', abort));
        },
        error: (_error, _req, res) => {
            if (res.destroyed) return;
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ errCode: 502, errMessage: 'Không kết nối được với chatbot.' }));
            } else res.end();
        }
    }
});
