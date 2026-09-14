require('@babel/register')({ presets: [['@babel/preset-env', { targets: { node: 'current' } }]], babelrc: false, configFile: false });
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('./fixture.cjs')(process.env.CHAT_FIXTURE_DATABASE_URL);
const { initSocket } = require('../../src/config/socket');
const { connectSocketRedis, closeSocketRedis } = require('../../src/config/socketRedis');
const { getJwtSecret, getJwtVerifyOptions } = require('../../src/utils/securityConfig');
const controller = require('../../src/controllers/chatController');
let io;
(async () => {
    await db.sequelize.authenticate();
    const app = express(); app.use(express.json());
    app.post('/send', (req, res, next) => {
        try { req.user = { id: Number(jwt.verify(req.headers.authorization.slice(7), getJwtSecret(), getJwtVerifyOptions()).sub) }; next(); }
        catch { res.sendStatus(401); }
    }, controller.handleSendMessage);
    const server = http.createServer(app);
    io = initSocket(server, await connectSocketRedis());
    io.on('connection', (socket) => socket.on('disconnect', () => process.send({ disconnectedUser: socket.data.userId })));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.send({ port: server.address().port });
})().catch((error) => { process.send({ error: error.message }); process.exitCode = 1; });
process.on('message', async (message) => {
    if (message !== 'close') return;
    if (io) await new Promise((resolve) => io.close(resolve));
    await closeSocketRedis(); await db.sequelize.close(); process.exit(0);
});
