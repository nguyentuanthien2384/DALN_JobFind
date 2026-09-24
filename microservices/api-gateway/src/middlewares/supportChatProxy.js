import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';

// Preserve the earlier stateless SSE API while routing it through the same
// Claude-backed support service as saved conversations.
export const createSupportChatProxy = (target = process.env.SUPPORT_CHAT_URL || 'http://support-chat-service:4008') => createProxyMiddleware({
    target, changeOrigin: true, pathRewrite: () => '/support/legacy-turn',
    proxyTimeout: 70000, timeout: 70000,
    on: {
        proxyReq: (proxyReq, req, res) => {
            for (const header of ['authorization', 'cookie', 'x-user-id', 'x-user-role', 'x-company-id',
                'x-company-status', 'x-company-censor', 'x-internal-secret', 'x-support-ip', 'x-support-signature']) proxyReq.removeHeader(header);
            if (process.env.INTERNAL_SECRET) proxyReq.setHeader('x-internal-secret', process.env.INTERNAL_SECRET);
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
