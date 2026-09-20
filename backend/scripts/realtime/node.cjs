require('@babel/register')({ presets: [['@babel/preset-env', { targets: { node: 'current' } }]], babelrc: false, configFile: false });
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('./fixture.cjs')(process.env.CHAT_FIXTURE_DATABASE_URL);
const { initSocket, emitDashboardChanged } = require('../../src/config/socket');
const { connectSocketRedis, closeSocketRedis } = require('../../src/config/socketRedis');
const { getJwtSecret, getJwtVerifyOptions } = require('../../src/utils/securityConfig');
const controller = require('../../src/controllers/chatController');
const mediaController = require('../../src/controllers/chatMediaController');
let io;
(async () => {
    await db.sequelize.authenticate();
    const app = express();
    app.use('/api/chat-attachments', express.json({ limit: '8mb' }));
    app.use(express.json());
    const authenticate = (req, res, next) => {
        try { req.user = { id: Number(jwt.verify(req.headers.authorization.slice(7), getJwtSecret(), getJwtVerifyOptions()).sub) }; next(); }
        catch { res.sendStatus(401); }
    };
    app.post(['/send', '/api/send-chat-message'], authenticate, controller.handleSendMessage);
    app.get('/api/get-chat-conversation', authenticate, controller.getConversation);
    app.get('/api/get-list-chat-conversation', authenticate, controller.getListConversation);
    app.post('/api/chat-attachments', authenticate, mediaController.upload);
    app.get('/api/chat-attachments/:id', authenticate, mediaController.read);
    app.get('/api/chat-jobs', authenticate, mediaController.jobs);
    app.get('/api/push/config', require('../../src/middlewares/jwtVerify').verifyTokenUser, require('../../src/controllers/webPushController').config);
    app.post('/api/test-read-notification', require('../../src/middlewares/jwtVerify').verifyTokenUser, require('../../src/controllers/notificationController').handleMarkReadNotification);
    if (process.env.CHAT_BROWSER_ASSETS) {
        app.use(express.static(process.env.CHAT_BROWSER_ASSETS,{dotfiles:'allow'}));
        app.get('/chat/:partnerId', (req,res) => res.sendFile(require('path').join(process.env.CHAT_BROWSER_ASSETS,'index.html'),{dotfiles:'allow'}));
    }
    const server = http.createServer(app);
    const adapter = await connectSocketRedis();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.URL_REACT += `,http://127.0.0.1:${server.address().port}`;
    io = initSocket(server, adapter);
    // Fault injection is confined to this isolated test server. The actual
    // application handler still validates, commits and broadcasts the message.
    if(process.env.CHAT_TEST_CONVERSATION==='true')io.on('connection',socket=>socket.use((packet,next)=>{
        if(packet[0]==='chat:send'&&packet[1]?.content?.startsWith('Kiểm thử mất ACK:')&&typeof packet[packet.length-1]==='function')packet[packet.length-1]=()=>{};
        next();
    }));
    io.on('connection', (socket) => socket.on('disconnect', () => process.send({ disconnectedUser: socket.data.userId })));
    process.send({ port: server.address().port });
})().catch((error) => { process.send({ error: error.message }); process.exitCode = 1; });
process.on('message', async (message) => {
    if (message?.action === 'dashboard') { await emitDashboardChanged(message.type, message.scope); process.send({dashboardSent:true}); return; }
    if (message !== 'close') return;
    if (io) await new Promise((resolve) => io.close(resolve));
    await closeSocketRedis(); await require('../../src/utils/realtimeTracing').close(); await db.sequelize.close(); process.exit(0);
});
