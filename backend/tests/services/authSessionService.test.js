const mockRows = new Map();
jest.mock('../../src/services/authAuditService', () => ({ recordSecurityEvent: jest.fn() }));
const mockFindUser = jest.fn();
const mockCreate = jest.fn(async data => {
  const row = { ...data, async update(patch) { Object.assign(this, patch); } };
  mockRows.set(data.tokenHash, row);
  return row;
});
const mockFindOne = jest.fn(async ({ where }) => {
  if (where.tokenHash) return mockRows.get(where.tokenHash) || null;
  if (where.familyId) return [...mockRows.values()].find(r =>
    r.familyId === where.familyId && (where.userId === undefined || r.userId === where.userId) && !r.revokedAt && !r.rotatedAt && r.expiresAt > new Date()) || null;
  return null;
});
const mockUpdate = jest.fn(async (patch, { where }) => {
  for (const row of mockRows.values()) {
    if (row.familyId === where.familyId || row.userId === where.userId) Object.assign(row, patch);
  }
});
jest.mock('../../src/models/index', () => ({
  Sequelize: { Op: { gt: Symbol('gt') } },
  sequelize: { transaction: jest.fn(async cb => cb({ LOCK: { UPDATE: 'UPDATE' } })) },
  AuthSession: { create: mockCreate, findOne: mockFindOne, update: mockUpdate },
  User: { findByPk: mockFindUser }, Account: { findOne: jest.fn() }, Company: {},
}));
jest.mock('jsonwebtoken', () => ({ sign: jest.fn((payload) => `access:${payload.sid}`) }));
const sessions = require('../../src/services/authSessionService');
const crypto = require('crypto');
const user = {
  id: 7, companyId: null, firstName: 'A',
  userAccountData: { statusCode: 'S1', roleCode: 'CANDIDATE' },
  toJSON() { return { id: 7, companyId: null, firstName: 'A', userAccountData: this.userAccountData }; },
};
beforeEach(() => { mockRows.clear(); jest.clearAllMocks(); mockFindUser.mockResolvedValue(user); });
test('login issues opaque refresh credential and stores only its hash', async () => {
  const issued = await sessions.createSession(7);
  expect(issued.token).toMatch(/^access:/);
  expect(issued.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
  expect(issued.user).toMatchObject({ id: 7, roleCode: 'CANDIDATE' });
  expect(JSON.stringify([...mockRows.values()])).not.toContain(issued.refreshToken);
  expect(mockRows.has(crypto.createHash('sha256').update(issued.refreshToken).digest('hex'))).toBe(true);
});
test('rotation invalidates old generation, and replay revokes the entire family', async () => {
  const first = await sessions.createSession(7);
  const next = await sessions.rotateSession(first.refreshToken);
  expect(next.refreshToken).not.toBe(first.refreshToken);
  expect(await sessions.activeFamily([...mockRows.values()][0].familyId, 7)).toBe(true);
  expect(await sessions.rotateSession(first.refreshToken)).toBeNull();
  expect(await sessions.rotateSession(next.refreshToken)).toBeNull();
  expect([...mockRows.values()].every(row => row.revokedAt)).toBe(true);
});
test('logout revokes all generations; inactive accounts cannot refresh', async () => {
  const initial = await sessions.createSession(7);
  await sessions.revokeByRefresh(initial.refreshToken);
  expect(await sessions.rotateSession(initial.refreshToken)).toBeNull();
  const next = await sessions.createSession(7);
  mockFindUser.mockResolvedValueOnce(null);
  expect(await sessions.rotateSession(next.refreshToken)).toBeNull();
});

test('rotation preserves device and original login time without extending absolute expiry', async () => {
  const first = await sessions.createSession(7, 'password', { deviceLabel: 'Firefox · Windows' });
  const initial = { ...mockRows.get(sessions.hashOpaque(first.refreshToken)) };
  const next = await sessions.rotateSession(first.refreshToken);
  const current = mockRows.get(sessions.hashOpaque(next.refreshToken));
  expect(current.deviceLabel).toBe('Firefox · Windows');
  expect(current.startedAt).toEqual(initial.startedAt);
  expect(current.expiresAt).toEqual(initial.expiresAt);
  const res = { cookie: jest.fn() };
  sessions.setRefreshCookie(res, next.refreshToken, new Date(Date.now() + 60000));
  expect(res.cookie.mock.calls[0][2].maxAge).toBeLessThanOrEqual(60000);
});
