const mockDb = { Sequelize: { Op: { lt: Symbol('lt') } }, AuthSecurityEvent: { create: jest.fn(), findAll: jest.fn() } };
jest.mock('../../src/models/index', () => mockDb);
const audit = require('../../src/services/authAuditService');
beforeEach(() => { jest.resetAllMocks(); mockDb.AuthSecurityEvent.create.mockResolvedValue({}); });

test('records only allowed fields and discards credentials and arbitrary errors', async () => {
  await audit.recordSecurityEvent({ event: 'login_failed', password: 'private-password', token: 'private-token', error: 'private-error', email: 'private-email' });
  expect(mockDb.AuthSecurityEvent.create).toHaveBeenCalledWith({ event: 'login_failed', userId: null, deviceLabel: null });
  await expect(audit.recordSecurityEvent({ event: 'attacker-controlled' })).rejects.toThrow('UNKNOWN_AUTH_EVENT');
});
test('defers events until the auth transaction commits and logging failure is contained', async () => {
  let committed;
  await audit.recordSecurityEvent({ event: 'session_revoked', userId: 7 }, { afterCommit: fn => { committed = fn; } });
  expect(mockDb.AuthSecurityEvent.create).not.toHaveBeenCalled();
  mockDb.AuthSecurityEvent.create.mockRejectedValue(new Error('sensitive database details'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(committed()).resolves.toBeUndefined();
  expect(log).toHaveBeenCalledWith('AUTH_AUDIT_WRITE_FAILED'); log.mockRestore();
});
test('device description uses fixed labels instead of attacker-provided raw headers', () => {
  expect(audit.deviceLabel({ get: () => 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Edg/131.0 secret' })).toBe('Edge · Windows');
  expect(audit.deviceLabel({ get: () => '<script>secret</script>\r\nInjected: log' })).toBe('Trình duyệt khác · Thiết bị khác');
});
test('history is bounded, keyset paginated and always restricted to its owner', async () => {
  mockDb.AuthSecurityEvent.findAll.mockResolvedValue(Array.from({ length: 21 }, (_, i) => ({ id: 40 - i, event: 'login_succeeded' })));
  const page = await audit.recentSecurityEvents(7, '50');
  expect(page.events).toHaveLength(20); expect(page.nextCursor).toBe('21');
  expect(mockDb.AuthSecurityEvent.findAll).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId: 7, id: { [mockDb.Sequelize.Op.lt]: '50' } }, limit: 21,
    attributes: ['id', 'event', 'deviceLabel', 'createdAt'],
  }));
  for (const cursor of ['0', '-1', '1 OR 1=1', ['1'], '999999999999999999999']) await expect(audit.recentSecurityEvents(7, cursor)).rejects.toThrow('INVALID_CURSOR');
});
