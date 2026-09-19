import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';

export const createSupportServiceProxy = (target = process.env.SUPPORT_CHAT_URL || 'http://support-chat-service:4008') => createProxyMiddleware({
    target, changeOrigin: true, pathRewrite: (_path, req) => req.originalUrl.replace(/^\/api/, ''), proxyTimeout: 70000, timeout: 70000,
    on: {
        proxyReq: (out, req, res) => {
            for (const name of ['authorization','cookie','x-user-id','x-user-role','x-company-id','x-company-status','x-company-censor','x-internal-secret','x-support-ip','x-support-signature']) out.removeHeader(name);
            if (process.env.INTERNAL_SECRET) out.setHeader('x-internal-secret', process.env.INTERNAL_SECRET);
            if (req.user) {
                out.setHeader('x-user-id', String(req.user.id)); out.setHeader('x-user-role', req.user.roleCode);
                out.setHeader('x-company-id', String(req.user.companyId || ''));
                out.setHeader('x-company-status', req.user.companyStatusCode || ''); out.setHeader('x-company-censor', req.user.companyCensorCode || '');
            }
            const cancel = () => { if (!res.writableEnded) out.destroy(); };
            res.once('close', cancel); res.once('finish', () => res.off('close', cancel));
            fixRequestBody(out, req);
        },
        proxyRes: (upstream, _req, res) => { res.once('close', () => { if (!upstream.complete) upstream.destroy(); }); },
        error: (_error, _req, res) => {
            if (res.destroyed) return;
            if (!res.headersSent) { res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ errCode: 503, errMessage: 'Dịch vụ hỗ trợ chưa sẵn sàng. Vui lòng thử lại.' })); }
            else res.end();
        }
    }
});
