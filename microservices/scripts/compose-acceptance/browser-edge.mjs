import http from 'node:http';

// Test-only ingress: fixed Gateway destination, no arbitrary proxy targets.
// This is the only container on the loopback-facing network; all services,
// databases and the synthetic provider remain on the internal network.
const server = http.createServer((req, res) => {
    const upstream = http.request({ hostname: 'api-gateway', port: 4000,
        path: req.url, method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.setTimeout(60000, () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"errCode":502}'); });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
});
server.listen(4012, '0.0.0.0');
process.once('SIGTERM', () => { server.close(); server.closeIdleConnections(); });
