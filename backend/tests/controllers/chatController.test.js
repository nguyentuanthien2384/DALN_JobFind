const mockService = {
  handleSendMessage: jest.fn(),
  getConversation: jest.fn(),
  getListConversation: jest.fn()
};
const mockEmitNewMessage = jest.fn();

jest.mock('../../src/services/chatService', () => mockService);
jest.mock('../../src/config/socket', () => ({ emitNewMessage: mockEmitNewMessage }));

const controller = require('../../src/controllers/chatController');
const { createRequest, createResponse } = require('../helpers/http');

describe('chatController', () => {
  const req = () => createRequest({
    body: { senderId: 999, receiverId: 8, content: 'hello' },
    query: { userId: 999, partnerId: 8, limit: 20 }
  });

  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterAll(() => console.log.mockRestore());

  test('uses the authenticated sender and broadcasts a successfully stored message', async () => {
    const saved = { id: 1, senderId: 7, receiverId: 8, content: 'hello' };
    mockService.handleSendMessage.mockResolvedValueOnce({ errCode: 0, data: saved });
    const res = createResponse();
    await controller.handleSendMessage(req(), res);
    expect(mockService.handleSendMessage).toHaveBeenCalledWith({ senderId: 7, receiverId: 8, content: 'hello' });
    expect(mockEmitNewMessage).toHaveBeenCalledWith(saved);
    expect(res.json).toHaveBeenCalledWith({ errCode: 0, data: saved });
  });

  test('does not broadcast a rejected message', async () => {
    mockService.handleSendMessage.mockResolvedValueOnce({ errCode: 2 });
    await controller.handleSendMessage(req(), createResponse());
    expect(mockEmitNewMessage).not.toHaveBeenCalled();
  });

  test('scopes conversation reads to the authenticated user', async () => {
    mockService.getConversation.mockResolvedValueOnce({ errCode: 0 });
    await controller.getConversation(req(), createResponse());
    expect(mockService.getConversation).toHaveBeenCalledWith({ userId: 7, partnerId: 8, limit: 20 });
    mockService.getListConversation.mockResolvedValueOnce({ errCode: 0 });
    await controller.getListConversation(req(), createResponse());
    expect(mockService.getListConversation).toHaveBeenCalledWith({ userId: 7 });
  });

  test.each([
    ['handleSendMessage', 'handleSendMessage'],
    ['getConversation', 'getConversation'],
    ['getListConversation', 'getListConversation']
  ])('%s returns the stable server error on failure', async (method, serviceMethod) => {
    mockService[serviceMethod].mockRejectedValueOnce(new Error('down'));
    const res = createResponse();
    await controller[method](req(), res);
    expect(res.json).toHaveBeenCalledWith({ errCode: -1, errMessage: 'Error from server' });
  });
});
