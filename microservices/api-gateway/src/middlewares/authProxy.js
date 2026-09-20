import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { isSafeProxyPath } from '../libs/security.js';

// Auth needs an HTTP pass-through: the generic Axios JSON proxy drops Set-Cookie
// and 302/303 Location, which would silently break refresh sessions and OIDC.
export const createAuthProxy = (target = process.env.LEGACY_URL || 'http://host.docker.internal:5000') =>
  createProxyMiddleware({
    target, changeOrigin: true,
    pathRewrite: (_path, req) => req.originalUrl,
    proxyTimeout: 15000, timeout: 15000,
    on: {
      proxyReq: (out, req, res) => {
        // Never forward client-forged service identity headers or internal secrets.
        for (const header of ['x-user-id', 'x-user-role', 'x-company-id', 'x-company-status',
          'x-company-censor', 'x-internal-secret']) out.removeHeader(header);
        fixRequestBody(out, req, res);
      },
      proxyRes: (upstream) => {
        upstream.headers['cache-control'] = 'no-store';
      },
      error: (_err, _req, res) => {
        if (res.destroyed) return;
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ errCode: 502, errMessage: 'Không kết nối được máy chủ xác thực' }));
        } else res.end();
      },
    },
  });
export const authProxyPathGuard = (req, res, next) => {
  if (!isSafeProxyPath(req.originalUrl)) return res.status(400).json({ errCode: 400, errMessage: 'Invalid auth path' });
  return next();
};
