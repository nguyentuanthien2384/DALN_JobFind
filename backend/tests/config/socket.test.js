const mockDb = { User: {findByPk:jest.fn()}, Company:{findOne:jest.fn()}, Post:{findByPk:jest.fn()}, Account: { findOne: jest.fn() } };
const mockChat = { handleSendMessage: jest.fn(), markConversationRead: jest.fn(), canParticipantsChat: jest.fn() };
const emitter = { emit: jest.fn() }; emitter.volatile = emitter;
const mockIo = { use: jest.fn(), on: jest.fn(), to: jest.fn(() => emitter), in: jest.fn(), emit: jest.fn() };
const mockServer = jest.fn(() => mockIo);
jest.mock('../../src/models/index', () => mockDb);
jest.mock('../../src/services/chatService', () => mockChat);
jest.mock('../../src/services/realtimePresenceService', () => ({ touch: jest.fn(async () => {}), lastSeen: jest.fn(async () => null) }));
jest.mock('socket.io', () => ({ Server: mockServer }));
const jwt = require('jsonwebtoken');
const api = require('../../src/config/socket');
const limiter = require('../../src/utils/realtimeLimiter');
const security = require('../../src/utils/securityConfig');
const payload = { v: 1, receiverId: 8, content: 'hello', clientMessageId: 'abcdefghijklmnop' };
let handlers, socket, options;
const authenticate = () => mockIo.use.mock.calls[0][0];
const connect = () => mockIo.on.mock.calls.find(([name]) => name === 'connection')[1](socket);
beforeEach(() => {
    jest.clearAllMocks(); jest.useFakeTimers(); limiter.reset();
    process.env.URL_REACT = 'http://localhost:3000,http://localhost:3001';
    mockDb.Account.findOne.mockResolvedValue({ userId: 7, roleCode: 'CANDIDATE' });
    mockChat.canParticipantsChat.mockResolvedValue({ allowed: true });
    handlers = {};
    socket = { data: { userId: 7, authExp: Math.floor(Date.now() / 1000) + 900, roleCode: 'CANDIDATE' },
        handshake: { auth: {}, query: {} }, conn: { once: jest.fn() }, join: jest.fn(), disconnect: jest.fn(), emit: jest.fn(),
        on: jest.fn((name, fn) => { handlers[name] = fn; }) };
    api.initSocket({}); options = mockServer.mock.calls[0][1];
});
afterEach(() => { if (handlers.disconnect) handlers.disconnect('transport close'); jest.useRealTimers(); });
test('strict origins, payload cap, heartbeat and middleware on recovery', async () => {
    expect(options).toEqual(expect.objectContaining({ maxHttpBufferSize: 65536, pingInterval: 25000, pingTimeout: 20000,
        connectionStateRecovery: { maxDisconnectionDuration: 120000, skipMiddlewares: false } }));
    for (const origin of [undefined, 'null', 'http://localhost:3000.evil', 'http://localhost:3000/']) {
        const done = jest.fn(); options.allowRequest({ headers: { origin }, socket: {} }, done); expect(done).toHaveBeenCalledWith(null, false);
    }
    const done = jest.fn(); options.allowRequest({ headers: { origin: 'http://localhost:3000' }, socket: { remoteAddress: '127.0.0.1' } }, done);
    await Promise.resolve(); expect(done).toHaveBeenCalledWith(null, true);
});
test('accepts only valid auth tokens and active accounts, never query tokens', async () => {
    const token = jwt.sign({ sub: '7' }, security.getJwtSecret(), security.getJwtSignOptions());
    for (const value of [undefined, {}, 42, 'invalid']) {
        socket.handshake.auth.token = value; socket.handshake.query.token = token;
        const next = jest.fn(); await authenticate()(socket, next); expect(next.mock.calls[0][0].data.code).toBe('AUTH_INVALID');
    }
    socket.handshake.auth.token = `Bearer ${token}`;
    let next = jest.fn(); await authenticate()(socket, next); expect(next).toHaveBeenCalledWith(); expect(socket.data.userId).toBe(7);
    mockDb.Account.findOne.mockResolvedValueOnce(null);
    next = jest.fn(); await authenticate()(socket, next); expect(next.mock.calls[0][0].data.code).toBe('AUTH_INACTIVE');
    mockDb.Account.findOne.mockRejectedValueOnce(new Error('db'));
    next = jest.fn(); await authenticate()(socket, next); expect(next.mock.calls[0][0].data.code).toBe('AUTH_UNAVAILABLE');
    socket.recovered = true; socket.data.userId = 99;
    next = jest.fn(); await authenticate()(socket, next); expect(next.mock.calls[0][0].data.code).toBe('AUTH_INVALID');
});
test('authenticates the sender, rejects spoofing and publishes only new commits', async () => {
    connect(); expect(socket.join).toHaveBeenCalledWith('user:7');
    let ack = jest.fn(); await handlers['chat:send']({ ...payload, senderId: 999 }, ack);
    expect(ack.mock.calls[0][0].code).toBe('PAYLOAD_INVALID'); expect(mockChat.handleSendMessage).not.toHaveBeenCalled();
    const message = { id: 1, senderId: 7, receiverId: 8, content: 'hello' };
    mockChat.handleSendMessage.mockResolvedValue({ errCode: 0, data: message });
    ack = jest.fn(); await handlers['chat:send'](payload, ack);
    expect(mockChat.handleSendMessage).toHaveBeenCalledWith({ senderId: 7, receiverId: 8, content: 'hello', clientMessageId: payload.clientMessageId });
    expect(ack.mock.calls[0][0]).toEqual(expect.objectContaining({ ok: true, code: 'OK', traceId: expect.any(String) }));
    expect(emitter.emit).toHaveBeenCalledWith('chat:new-message', expect.objectContaining({ id: 1, eventId: 'chat:1', v: 1 }));
    emitter.emit.mockClear(); mockChat.handleSendMessage.mockResolvedValue({ errCode: 0, duplicate: true, data: message });
    await handlers['chat:send'](payload); expect(emitter.emit).not.toHaveBeenCalled();
});
test('typing/read require authorization and read receipt carries snapshot boundary', async () => {
    connect(); mockChat.canParticipantsChat.mockResolvedValueOnce({ allowed: false });
    const ack = jest.fn(); await handlers['chat:typing']({ receiverId: 8 }, ack);
    expect(ack.mock.calls[0][0].code).toBe('CHAT_NOT_ALLOWED'); expect(emitter.emit).not.toHaveBeenCalled();
    await handlers['chat:typing']({ receiverId: 8 });
    expect(emitter.emit).toHaveBeenCalledWith('chat:typing', { v: 1, fromUserId: 7 });
    mockChat.markConversationRead.mockResolvedValue({ errCode: 0 });
    await handlers['chat:read']({ partnerId: 8, throughMessageId: 10 });
    expect(mockChat.markConversationRead).toHaveBeenCalledWith({ userId: 7, partnerId: 8, throughMessageId: 10 });
    expect(emitter.emit).toHaveBeenCalledWith('chat:read', expect.objectContaining({ byUserId: 7, throughMessageId: 10 }));
});
test('cleans timers, expires live JWTs and disconnects inactive accounts', async () => {
    socket.data.authExp = Math.floor(Date.now() / 1000) + 1;
    connect(); await jest.advanceTimersByTimeAsync(1001);
    expect(socket.emit).toHaveBeenCalledWith('auth:expired', { v: 1, code: 'AUTH_EXPIRED' }); expect(socket.disconnect).toHaveBeenCalledWith(true);
    handlers.disconnect('transport close'); expect(jest.getTimerCount()).toBe(0);
    socket.data.authExp += 900; connect(); mockDb.Account.findOne.mockResolvedValueOnce(null);
    await jest.advanceTimersByTimeAsync(30000); expect(socket.emit).toHaveBeenCalledWith('auth:expired', { v: 1, code: 'AUTH_INACTIVE' });
});
test('rate limits across sockets and disconnects repeated malformed payloads', async () => {
    connect(); const ack = jest.fn();
    for (let i = 0; i < 121; i++) await handlers['chat:read']({}, ack);
    expect(socket.disconnect).toHaveBeenCalledWith(true); expect(ack.mock.calls[120][0].code).toBe('RATE_LIMITED');
});
test('safe errors never contain DB details, tokens or message text', async () => {
    connect(); mockChat.handleSendMessage.mockRejectedValueOnce(new Error('secret DB credentials'));
    const ack = jest.fn(); await handlers['chat:send'](payload, ack);
    expect(ack.mock.calls[0][0]).toEqual(expect.objectContaining({ code: 'INTERNAL_ERROR', retryable: true }));
    expect(JSON.stringify(ack.mock.calls)).not.toContain('secret DB');
});
test('notification targets one user; unscoped dashboard targets only admins', async () => {
    api.emitNotification(8, { id: 1 }); expect(mockIo.to).toHaveBeenCalledWith('user:8');
    api.emitNotificationRead(8); expect(mockIo.to).toHaveBeenLastCalledWith('user:8');
    await api.emitDashboardChanged('cv'); expect(mockIo.to).toHaveBeenCalledWith(['feature:dashboard:admin']); expect(mockIo.emit).not.toHaveBeenCalled();
});


test('presence hides last-seen while another tab is online and never queries private presence without permission', async () => {
    connect(); const presence = require('../../src/services/realtimePresenceService');
    const fetchSockets = jest.fn().mockResolvedValue([{data:{authExp:Date.now()/1000+300}}]);
    mockIo.in.mockReturnValue({fetchSockets});
    const ack=jest.fn(); await handlers['chat:presence']({partnerId:8},ack);
    expect(ack.mock.calls[0][0].data).toEqual(expect.objectContaining({online:true,lastSeenAt:null}));
    expect(presence.lastSeen).not.toHaveBeenCalled();
    fetchSockets.mockResolvedValue([]); presence.lastSeen.mockResolvedValueOnce('2026-01-03T12:00:00.000Z');
    await handlers['chat:presence']({partnerId:8},ack);
    expect(ack.mock.calls[1][0].data).toEqual(expect.objectContaining({online:false,lastSeenAt:'2026-01-03T12:00:00.000Z'}));
    mockChat.canParticipantsChat.mockResolvedValueOnce({allowed:false});
    await handlers['chat:presence']({partnerId:9},ack);
    expect(ack.mock.calls[2][0].code).toBe('CHAT_NOT_ALLOWED');
    expect(presence.lastSeen).toHaveBeenCalledTimes(1); expect(fetchSockets).toHaveBeenCalledTimes(2);
});

test('dashboard delivery resolves the actual post owner and targets only its company plus admins', async () => {
    mockDb.Post.findByPk.mockResolvedValue({userId:8}); mockDb.User.findByPk.mockResolvedValue({companyId:11});
    await api.emitDashboardChanged('cv',{postId:17});
    expect(mockDb.Post.findByPk).toHaveBeenCalledWith(17,expect.any(Object));
    expect(mockDb.User.findByPk).toHaveBeenCalledWith(8,expect.any(Object));
    expect(mockIo.to).toHaveBeenCalledWith(['feature:dashboard:admin','feature:dashboard:company:11']);
    expect(emitter.emit).toHaveBeenCalledWith('dashboard:changed',expect.objectContaining({v:1,type:'cv'}));
});
test('recovery clears previous company rooms and role changes disconnect the old session', async () => {
    socket.handshake.auth.token=jwt.sign({sub:'7'},security.getJwtSecret(),security.getJwtSignOptions());
    mockDb.Account.findOne.mockResolvedValue({userId:7,roleCode:'EMPLOYER'});
    mockDb.User.findByPk.mockResolvedValue({companyId:11});mockDb.Company.findOne.mockResolvedValue({id:11});
    const next=jest.fn();await authenticate()(socket,next);expect(next).toHaveBeenCalledWith();
    socket.rooms=new Set(['feature:dashboard:company:99','feature:dashboard']);socket.leave=jest.fn();connect();
    expect(socket.leave).toHaveBeenCalledWith('feature:dashboard:company:99');
    expect(socket.join).toHaveBeenCalledWith('feature:dashboard:company:11');
    mockDb.Account.findOne.mockResolvedValue({userId:7,roleCode:'CANDIDATE'});
    await jest.advanceTimersByTimeAsync(30000);expect(socket.disconnect).toHaveBeenCalledWith(true);
});
