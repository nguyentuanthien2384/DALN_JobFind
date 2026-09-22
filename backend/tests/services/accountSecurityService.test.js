const mockAccount = { userId: 7, password: 'new-hash', save: jest.fn() };
const mockLock = jest.fn(), mockRevoke = jest.fn();
const mockTransaction = {};
jest.mock('../../src/models/index', () => ({ sequelize: { transaction: work => work(mockTransaction) } }));
jest.mock('../../src/services/authSessionService', () => ({ lockAccount: mockLock, revokeAll: mockRevoke }));
const { saveAndRevokeSessions } = require('../../src/services/accountSecurityService');
beforeEach(() => jest.clearAllMocks());
test('rejects a password proof invalidated by a concurrent reset before writing or revoking', async () => {
  mockLock.mockResolvedValue({ password: 'changed-by-other-request' });
  await expect(saveAndRevokeSessions(mockAccount, 'old-hash')).rejects.toThrow('CREDENTIALS_CHANGED');
  expect(mockAccount.save).not.toHaveBeenCalled();
  expect(mockRevoke).not.toHaveBeenCalled();
});
test('saves and revokes within the lock when the current password proof still matches', async () => {
  mockLock.mockResolvedValue({ password: 'old-hash' });
  await saveAndRevokeSessions(mockAccount, 'old-hash');
  expect(mockAccount.save).toHaveBeenCalledWith({ transaction: mockTransaction });
  expect(mockRevoke).toHaveBeenCalledWith(7, mockTransaction, 'account_security_changed');
});
