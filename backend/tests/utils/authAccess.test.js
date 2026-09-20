const mockActiveFamily = jest.fn();
jest.mock('../../src/services/authSessionService', () => ({ activeFamily: mockActiveFamily }));
const { validAccessSession } = require('../../src/utils/authAccess');
const original = process.env.AUTH_ALLOW_LEGACY_TOKENS;
const nodeEnv = process.env.NODE_ENV;
afterAll(() => {
  if (original === undefined) delete process.env.AUTH_ALLOW_LEGACY_TOKENS;
  else process.env.AUTH_ALLOW_LEGACY_TOKENS = original;
  process.env.NODE_ENV = nodeEnv;
});
beforeEach(() => mockActiveFamily.mockReset());
test('a session JWT is accepted only when its database family is active', async () => {
  mockActiveFamily.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await validAccessSession({ sub: 7, sid: 'session-family' })).toBe(true);
  expect(await validAccessSession({ sub: 7, sid: 'revoked-family' })).toBe(false);
  expect(mockActiveFamily).toHaveBeenCalledWith('session-family', 7);
});
test('production rejects legacy JWTs by default', async () => {
  delete process.env.AUTH_ALLOW_LEGACY_TOKENS;
  process.env.NODE_ENV = 'production';
  expect(await validAccessSession({ sub: 7 })).toBe(false);
});
