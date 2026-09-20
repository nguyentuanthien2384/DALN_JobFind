const mockFindTx = jest.fn();
jest.mock('../../src/models/index', () => ({
  sequelize: { transaction: jest.fn(async cb => cb({ LOCK: { UPDATE: 'UPDATE' } })) },
  OidcTransaction: { findByPk: mockFindTx, destroy: jest.fn(), create: jest.fn() },
}));
jest.mock('../../src/services/authSessionService', () => ({
  hashOpaque: jest.fn(x => x), loadUser: jest.fn(),
}));
const oidc = require('../../src/services/oidcService');
const res = () => ({ clearCookie: jest.fn() });
beforeEach(() => jest.clearAllMocks());
test('callback without state or browser-bound transaction fails before token exchange', async () => {
  await expect(oidc.complete('google', { query: { state: 'random' }, headers: {} }, res()))
    .rejects.toThrow('OIDC_STATE');
  expect(mockFindTx).not.toHaveBeenCalled();
});
test('a missing or previously consumed state cannot be used twice', async () => {
  mockFindTx.mockResolvedValue(null);
  const request = { query: { state: 'valid', code: 'code' }, headers: { cookie: `jobfind_oidc_tx=${'a'.repeat(48)}` } };
  await expect(oidc.complete('google', request, res())).rejects.toThrow('OIDC_STATE');
  expect(mockFindTx).toHaveBeenCalledWith('valid', expect.objectContaining({ lock: 'UPDATE' }));
});
