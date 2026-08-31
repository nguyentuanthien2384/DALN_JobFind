const mockJwtVerify = jest.fn();
const mockChatService = { handleSendMessage: jest.fn(), markConversationRead: jest.fn() };
const mockFindAccount = jest.fn();
const mockIo = {
  use: jest.fn(), on: jest.fn(), to: jest.fn(), emit: jest.fn()
};
const mockServerConstructor = jest.fn(() => mockIo);

jest.mock('jsonwebtoken', () => ({ verify: mockJwtVerify }));
jest.mock('../../src/services/chatService', () => mockChatService);
jest.mock('../../src/models/index', () => ({
  Account: { findOne: mockFindAccount }
}));
jest.mock('socket.io', () => ({ Server: mockServerConstructor }));

const socketModule = require('../../src/config/socket');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const originalFrontendOrigins = process.env.URL_REACT;

describe('socket realtime layer', () => {
  let authMiddleware;
  let connectionHandler;
  let socket;
  let handlers;
  let roomEmitter;

  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterAll(() => {
    console.log.mockRestore();
    if (originalFrontendOrigins === undefined) delete process.env.URL_REACT;
    else process.env.URL_REACT = originalFrontendOrigins;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindAccount.mockResolvedValue({ userId: 7 });
    handlers = {};
    roomEmitter = { emit: jest.fn() };
    mockIo.to.mockReturnValue(roomEmitter);
    socket = {
      userId: 7,
      handshake: { auth: {}, query: {} },
      join: jest.fn(),
      on: jest.fn((event, callback) => { handlers[event] = callback; })
    };
  });

  test('emit helpers are safe before Socket.IO initialisation', () => {
    expect(socketModule.getIO()).toBeNull();
    expect(() => socketModule.emitNewMessage({ senderId: 1, receiverId: 2 })).not.toThrow();
    expect(() => socketModule.emitNotification(1, {})).not.toThrow();
    expect(() => socketModule.emitDashboardChanged('post')).not.toThrow();
  });

  test('initialises CORS, authenticates active-account handshake tokens and joins the private room', async () => {
    process.env.URL_REACT = ' http://frontend-one.test, http://frontend-two.test, ';
    const server = {};
    expect(socketModule.initSocket(server)).toBe(mockIo);
    expect(mockServerConstructor).toHaveBeenCalledWith(server, expect.objectContaining({
      cors: expect.objectContaining({
        origin: ['http://frontend-one.test', 'http://frontend-two.test'],
        credentials: true
      })
    }));
    authMiddleware = mockIo.use.mock.calls[0][0];
    connectionHandler = mockIo.on.mock.calls.find(([event]) => event === 'connection')[1];

    let next = jest.fn();
    await authMiddleware(socket, next);
    expect(next.mock.calls[0][0]).toEqual(new Error('UNAUTHORIZED'));

    socket.handshake.auth.token = 'Bearer valid';
    mockJwtVerify.mockReturnValueOnce({ sub: 7 });
    next = jest.fn();
    await authMiddleware(socket, next);
    expect(mockJwtVerify).toHaveBeenCalledWith('valid', expect.anything());
    expect(mockFindAccount).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 7, statusCode: 'S1' },
      raw: true
    }));
    expect(socket.userId).toBe(7);
    expect(next).toHaveBeenCalledWith();

    socket.handshake.auth = {};
    socket.handshake.query.token = 'query-token';
    mockJwtVerify.mockImplementationOnce(() => { throw new Error('bad'); });
    next = jest.fn();
    await authMiddleware(socket, next);
    expect(next.mock.calls[0][0]).toEqual(new Error('UNAUTHORIZED'));

    connectionHandler(socket);
    expect(socket.join).toHaveBeenCalledWith('user:7');
    expect(Object.keys(handlers)).toEqual(expect.arrayContaining(['chat:send', 'chat:typing', 'chat:read']));
  });

  test('rejects disabled, deleted and database-unavailable accounts during the handshake', async () => {
    socketModule.initSocket({});
    authMiddleware = mockIo.use.mock.calls[0][0];
    socket.handshake.auth.token = 'valid';
    mockJwtVerify.mockReturnValue({ sub: 7 });

    mockFindAccount.mockResolvedValueOnce(null);
    let next = jest.fn();
    await authMiddleware(socket, next);
    expect(next.mock.calls[0][0]).toEqual(new Error('UNAUTHORIZED'));

    mockFindAccount.mockRejectedValueOnce(new Error('db down'));
    next = jest.fn();
    await authMiddleware(socket, next);
    expect(next.mock.calls[0][0]).toEqual(new Error('UNAUTHORIZED'));
  });

  test('stores a socket message under authenticated sender and broadcasts/acks success', async () => {
    socketModule.initSocket({});
    connectionHandler = mockIo.on.mock.calls.find(([event]) => event === 'connection')[1];
    connectionHandler(socket);
    const message = { id: 1, senderId: 7, receiverId: 8, content: 'hello' };
    mockChatService.handleSendMessage.mockResolvedValueOnce({ errCode: 0, data: message });
    const ack = jest.fn();
    await handlers['chat:send']({ senderId: 999, receiverId: 8, content: 'hello' }, ack);
    expect(mockChatService.handleSendMessage).toHaveBeenCalledWith({ senderId: 7, receiverId: 8, content: 'hello' });
    expect(mockIo.to).toHaveBeenCalledWith('user:8');
    expect(mockIo.to).toHaveBeenCalledWith('user:7');
    expect(roomEmitter.emit).toHaveBeenCalledWith('chat:new-message', message);
    expect(ack).toHaveBeenCalledWith({ errCode: 0, data: message });
  });

  test('message failures and rejected messages do not broadcast', async () => {
    socketModule.initSocket({});
    mockIo.on.mock.calls.find(([event]) => event === 'connection')[1](socket);
    mockChatService.handleSendMessage.mockResolvedValueOnce({ errCode: 2 });
    await handlers['chat:send']({}, undefined);
    expect(mockIo.to).not.toHaveBeenCalled();
    mockChatService.handleSendMessage.mockRejectedValueOnce(new Error('db'));
    const ack = jest.fn();
    await handlers['chat:send']({}, ack);
    expect(ack).toHaveBeenCalledWith({ errCode: -1, errMessage: 'Error from server' });
  });

  test('typing is sent only with a receiver', () => {
    socketModule.initSocket({});
    mockIo.on.mock.calls.find(([event]) => event === 'connection')[1](socket);
    handlers['chat:typing']({});
    expect(mockIo.to).not.toHaveBeenCalled();
    handlers['chat:typing']({ receiverId: 8 });
    expect(mockIo.to).toHaveBeenCalledWith('user:8');
    expect(roomEmitter.emit).toHaveBeenCalledWith('chat:typing', { fromUserId: 7 });
  });

  test('read receipts persist and notify the partner, with stable failure ack', async () => {
    socketModule.initSocket({});
    mockIo.on.mock.calls.find(([event]) => event === 'connection')[1](socket);
    await handlers['chat:read']({}, jest.fn());
    expect(mockChatService.markConversationRead).not.toHaveBeenCalled();
    mockChatService.markConversationRead.mockResolvedValueOnce({ errCode: 0, updatedCount: 2 });
    const ack = jest.fn();
    await handlers['chat:read']({ partnerId: 8 }, ack);
    expect(mockChatService.markConversationRead).toHaveBeenCalledWith({ userId: 7, partnerId: 8 });
    expect(roomEmitter.emit).toHaveBeenCalledWith('chat:read', { byUserId: 7 });
    expect(ack).toHaveBeenCalledWith({ errCode: 0, updatedCount: 2 });
    mockChatService.markConversationRead.mockRejectedValueOnce(new Error('db'));
    const failedAck = jest.fn();
    await handlers['chat:read']({ partnerId: 8 }, failedAck);
    expect(failedAck).toHaveBeenCalledWith({ errCode: -1, errMessage: 'Error from server' });
  });

  test('public emit helpers target private rooms and dashboards', () => {
    socketModule.initSocket({});
    const notification = { id: 1 };
    socketModule.emitNotification(8, notification);
    expect(mockIo.to).toHaveBeenCalledWith('user:8');
    expect(roomEmitter.emit).toHaveBeenCalledWith('notification:new', notification);
    socketModule.emitNotification(null, notification);
    socketModule.emitNewMessage(null);
    jest.spyOn(Date, 'now').mockReturnValueOnce(1234);
    socketModule.emitDashboardChanged('cv');
    expect(mockIo.emit).toHaveBeenCalledWith('dashboard:changed', { type: 'cv', at: 1234 });
    Date.now.mockRestore();
  });
});
