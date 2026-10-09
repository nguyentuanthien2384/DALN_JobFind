const mockAccount = { findOne: jest.fn() };
jest.mock('../../src/models', () => ({ Account: mockAccount }));
const { supportChatAccess } = require('../../src/middlewares/supportChatAccess');
const { createResponse } = require('../helpers/http');

const user = (roleCode, company = {}) => ({ id: 7, userAccountData: { roleCode }, ...company });

beforeEach(() => mockAccount.findOne.mockReset());

test.each([
  user('CANDIDATE'),
  user('ADMIN'),
  user('COMPANY', { companyId: 4, userCompanyData: { id: 4, statusCode: 'S1', censorCode: 'CS1' } }),
  user('EMPLOYER', { companyId: 4, userCompanyData: { id: 4, statusCode: 'S1', censorCode: 'CS1' } })
])('ordinary chat permission proceeds without a support-agent lookup (%j)', async authenticated => {
  const next = jest.fn(), res = createResponse();
  await supportChatAccess({ user: authenticated }, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(mockAccount.findOne).not.toHaveBeenCalled();
  expect(res.status).not.toHaveBeenCalled();
});

test.each([undefined, user('UNKNOWN')])('denies identities without account access (%j)', async authenticated => {
  const next = jest.fn(), res = createResponse();
  const req = { user: authenticated, path: '/api/get-list-chat-conversation' };
  await supportChatAccess(req, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
  expect(mockAccount.findOne).not.toHaveBeenCalled();
  expect(req).not.toHaveProperty('supportOnly');
});

test('restricts an unattached recruiter conversation list to support', async () => {
  const req = { user: user('EMPLOYER'), path: '/api/get-list-chat-conversation' }, next = jest.fn();
  await supportChatAccess(req, createResponse(), next);
  expect(req.supportOnly).toBe(true);
  expect(next).toHaveBeenCalledTimes(1);
  expect(mockAccount.findOne).not.toHaveBeenCalled();
});

test.each([undefined, 0, -1, 1.5, 'invalid', Number.MAX_SAFE_INTEGER + 1])(
  'rejects malformed support recipients before querying the database (%j)', async receiverId => {
    const next = jest.fn(), res = createResponse();
    await supportChatAccess({ user: user('EMPLOYER'), body: { receiverId }, query: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(mockAccount.findOne).not.toHaveBeenCalled();
  }
);

test.each([{ body: { receiverId: '21' } }, { query: { partnerId: '21' } }])(
  'allows only the exact active administrator requested by the caller (%j)', async target => {
    mockAccount.findOne.mockResolvedValueOnce({ userId: 21 });
    const next = jest.fn();
    await supportChatAccess({ user: user('EMPLOYER'), ...target }, createResponse(), next);
    expect(mockAccount.findOne).toHaveBeenCalledWith({
      where: { userId: 21, roleCode: 'ADMIN', statusCode: 'S1' }, attributes: ['userId']
    });
    expect(next).toHaveBeenCalledTimes(1);
  }
);

test('denies ordinary recipients while a recruiter company is awaiting approval', async () => {
  mockAccount.findOne.mockResolvedValueOnce(null);
  const next = jest.fn(), res = createResponse();
  await supportChatAccess({
    user: user('COMPANY', { companyId: 4, userCompanyData: { id: 4, statusCode: 'S1', censorCode: 'CS2' } }),
    body: { receiverId: 8 }
  }, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errCode: 403 }));
  expect(next).not.toHaveBeenCalled();
});

test('fails closed with retryable status when the administrator cannot be verified', async () => {
  mockAccount.findOne.mockRejectedValueOnce(new Error('database unavailable'));
  const next = jest.fn(), res = createResponse();
  await supportChatAccess({ user: user('EMPLOYER'), query: { partnerId: 21 } }, res, next);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errCode: 503 }));
  expect(next).not.toHaveBeenCalled();
});
