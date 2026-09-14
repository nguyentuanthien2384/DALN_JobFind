// Real HTTP, Engine.IO, JWT, Socket.IO, controller and chat service. The DB is a
// deterministic fixture; SQL/unique-index behavior needs the separate MySQL test.
const mockRows = [];
const mockInactive = new Set();
const mockDb = {
    Account: { findOne: jest.fn(async ({ where }) => mockInactive.has(Number(where.userId)) ? null : ({ userId: where.userId, roleCode: 'ADMIN' })) },
    User: { findAll: jest.fn(async () => [7, 8, 9].map((id) => ({ id, userAccountData: { roleCode: id === 7 ? 'ADMIN' : 'CANDIDATE', statusCode: mockInactive.has(id) ? 'S2' : 'S1' } }))) },
    Company: {},
    ChatMessage: {
        findOne: jest.fn(async ({ where }) => mockRows.find((m) => m.senderId === where.senderId && m.clientMessageId === where.clientMessageId)),
        create: jest.fn(async (data) => {
            // Model the database UNIQUE violation in the loser of a racing insert.
            if (mockRows.some((m) => m.senderId === data.senderId && m.clientMessageId === data.clientMessageId))
                throw Object.assign(new Error('duplicate'), { name: 'SequelizeUniqueConstraintError' });
            const message = { ...data, id: mockRows.length + 1, createdAt: new Date().toISOString() };
            mockRows.push(message); return message;
        }),
        update: jest.fn(async () => [1]),
    },
};
jest.mock('../../src/models/index', () => mockDb);
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { io: clientIO } = require('socket.io-client');
const { initSocket, emitNewMessage, disconnectUser } = require('../../src/config/socket');
const controller = require('../../src/controllers/chatController');
const security = require('../../src/utils/securityConfig');
const limiter = require('../../src/utils/realtimeLimiter');
let runtime, server, url, clients;
const tokenFor = (id, seconds = 900) => jwt.sign({ sub: String(id) }, security.getJwtSecret(), { ...security.getJwtSignOptions(), expiresIn: seconds });
const once = (socket, event) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, done); reject(new Error(`Timeout: ${event}`)); }, 4000);
    const done = (...args) => { clearTimeout(timer); resolve(args[0]); };
    socket.once(event, done);
});
const client = (id, options = {}) => {
    const socket = clientIO(url, { auth: { token: tokenFor(id) }, extraHeaders: { Origin: 'http://localhost:3000' },
        reconnection: false, forceNew: true, autoConnect: false, ...options });
    clients.push(socket); return socket;
};
const connect = async (socket) => { const ready = once(socket, 'connect'); socket.connect(); await ready; return socket; };
const send = { v: 1, receiverId: 8, content: 'hello', clientMessageId: 'integration-send-0001' };
beforeEach(async () => {
    limiter.reset(); mockRows.length = 0; mockInactive.clear(); clients = [];
    process.env.URL_REACT = 'http://localhost:3000';
    const app = express(); app.use(express.json());
    app.post('/send', (req, res, next) => {
        const claims = jwt.verify(req.headers.authorization.slice(7), security.getJwtSecret(), security.getJwtVerifyOptions());
        req.user = { id: Number(claims.sub) }; next();
    }, controller.handleSendMessage);
    server = http.createServer(app); runtime = initSocket(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { clients.forEach((socket) => socket.disconnect()); await new Promise((resolve) => runtime.close(resolve)); });

test.each(['polling', 'websocket'])('real %s connection, persistence then sender/receiver fanout', async (transport) => {
    const sender = await connect(client(7, { transports: [transport] }));
    const receiver = await connect(client(8, { transports: [transport] }));
    const received = once(receiver, 'chat:new-message'), echoed = once(sender, 'chat:new-message');
    const result = await sender.timeout(2000).emitWithAck('chat:send', send);
    expect(result).toEqual(expect.objectContaining({ ok: true, code: 'OK', v: 1 }));
    expect((await received).id).toBe(result.data.id); expect((await echoed).senderId).toBe(7); expect(mockRows).toHaveLength(1);
});
test('HTTP fallback after a lost ACK and concurrent retries return the same persisted ID', async () => {
    const sender = await connect(client(7));
    // Ignore the socket acknowledgement as if it was lost in transit.
    const committed = once(sender, 'chat:new-message'); sender.emit('chat:send', send); await committed;
    const response = await fetch(`${url}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', authorization: `Bearer ${tokenFor(7)}` }, body: JSON.stringify(send) });
    expect(await response.json()).toEqual(expect.objectContaining({ errCode: 0, duplicate: true, data: expect.objectContaining({ id: 1 }) }));
    const payload = { ...send, clientMessageId: 'integration-race-0001' };
    const results = await Promise.all(Array.from({ length: 5 }, () => sender.timeout(2000).emitWithAck('chat:send', payload)));
    expect(new Set(results.map((r) => r.data.id)).size).toBe(1); expect(mockRows).toHaveLength(2);
    const conflict = await sender.timeout(2000).emitWithAck('chat:send', { ...send, content: 'changed' });
    expect(conflict.code).toBe('IDEMPOTENCY_CONFLICT'); expect(mockRows).toHaveLength(2);
});
test.each(['polling', 'websocket'])('denies malicious or missing origins over %s', async (transport) => {
    for (const origin of ['http://localhost:3000.evil', undefined]) {
        const socket = client(7, { transports: [transport], extraHeaders: origin ? { Origin: origin } : {} });
        const rejected = once(socket, 'connect_error'); socket.connect(); await rejected; expect(socket.connected).toBe(false);
    }
});
test('rejects query tokens, spoofed sender, malformed payload, unauthorized typing/read/presence', async () => {
    const query = client(7, { auth: {}, query: { token: tokenFor(7) } });
    const rejected = once(query, 'connect_error'); query.connect(); expect((await rejected).data.code).toBe('AUTH_INVALID');
    const sender = await connect(client(8));
    for (const [event, payload] of [['chat:send', { ...send, senderId: 7 }], ['chat:send', { ...send, content: ['bad'] }]])
        expect((await sender.timeout(2000).emitWithAck(event, payload)).code).toBe('PAYLOAD_INVALID');
    for (const [event, payload] of [['chat:typing', { receiverId: 9 }], ['chat:read', { partnerId: 9 }], ['chat:presence', { partnerId: 9 }]])
        expect((await sender.timeout(2000).emitWithAck(event, payload)).code).toBe('CHAT_NOT_ALLOWED');
    expect(mockRows).toHaveLength(0);
});
test('expires a JWT on a live connection and rejects reconnect with that token', async () => {
    const token = tokenFor(7, 2);
    const socket = await connect(client(7, { auth: { token } }));
    const expired = once(socket, 'auth:expired'), disconnected = once(socket, 'disconnect');
    expect((await expired).code).toBe('AUTH_EXPIRED'); await disconnected;
    const rejected = once(socket, 'connect_error'); socket.connect(); expect((await rejected).data.code).toBe('AUTH_EXPIRED');
});
test('recovers a missed packet after transport loss and rechecks disabled accounts', async () => {
    const socket = await connect(client(8));
    const first = once(socket, 'chat:new-message'); emitNewMessage({ id: 1, senderId: 7, receiverId: 8 }); await first;
    const closed = once(runtime.sockets.sockets.get(socket.id), 'disconnect');
    socket.io.engine.close(); await closed;
    emitNewMessage({ id: 2, senderId: 7, receiverId: 8 });
    const recoveredMessage = once(socket, 'chat:new-message'); await connect(socket);
    expect(socket.recovered).toBe(true); expect((await recoveredMessage).id).toBe(2);
    const closedAgain = once(runtime.sockets.sockets.get(socket.id), 'disconnect'); socket.io.engine.close(); await closedAgain;
    mockInactive.add(8);
    const rejected = once(socket, 'connect_error'); socket.connect(); expect((await rejected).data.code).toBe('AUTH_INACTIVE');
});
test('multi-tab presence and revocation close every socket for the user', async () => {
    const sender = await connect(client(7)), tabA = await connect(client(8)), tabB = await connect(client(8));
    tabA.disconnect();
    expect((await sender.timeout(2000).emitWithAck('chat:presence', { partnerId: 8 })).data.online).toBe(true);
    const disconnected = once(tabB, 'disconnect'); disconnectUser(8); await disconnected;
    expect((await sender.timeout(2000).emitWithAck('chat:presence', { partnerId: 8 })).data.online).toBe(false);
});
test('oversized WebSocket payload closes the transport before persistence', async () => {
    const sender = await connect(client(7, { transports: ['websocket'] }));
    const disconnected = once(sender, 'disconnect'); sender.emit('chat:send', { ...send, content: 'x'.repeat(70000) });
    await disconnected; expect(mockRows).toHaveLength(0);
});
