// Disposable test proxy with explicit target switching for rolling-node tests.
const http = require('node:http');
const net = require('node:net');
module.exports = async (initialTarget) => {
    let target = new URL(initialTarget);
    const peers = new Set();
    const server = http.createServer((req, res) => {
        const upstream = http.request({ hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers: req.headers }, (reply) => {
            res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
        });
        upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
        req.pipe(upstream);
    });
    server.on('connection', (socket) => { peers.add(socket); socket.on('close', () => peers.delete(socket)); });
    server.on('upgrade', (req, socket, head) => {
        const upstream = net.connect(Number(target.port), target.hostname);
        upstream.on('connect', () => {
            const headers = Object.entries(req.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n');
            upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`);
            if (head.length) upstream.write(head);
            socket.pipe(upstream); upstream.pipe(socket);
        });
        upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
        socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy());
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, switchTo: (url) => { target = new URL(url); },
        close: () => { peers.forEach((socket) => socket.destroy()); return new Promise((resolve) => server.close(resolve)); } };
};
