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
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-22T08:00:00Z'));
  mockRows.clear(); jest.clearAllMocks(); mockFindUser.mockResolvedValue(user);
});
afterEach(() => { jest.useRealTimers(); });
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

test.each([
  [undefined, true, 14 * 24],
  [true, true, 14 * 24],
  [false, false, 8],
])('rememberMe %s issues the expected absolute lifetime', async (preference, expected, hours) => {
  const issued = await sessions.createSession(7, 'password', { rememberMe: preference });
  expect(issued.rememberMe).toBe(expected);
  expect(issued.expiresAt.getTime() - Date.now()).toBe(hours * 60 * 60 * 1000);
  expect(mockRows.get(sessions.hashOpaque(issued.refreshToken)).rememberMe).toBe(expected);
});

test.each([false, true])('rotation preserves rememberMe=%s and does not extend its deadline', async rememberMe => {
  const first = await sessions.createSession(7, 'password', { rememberMe });
  jest.advanceTimersByTime(2 * 60 * 60 * 1000);
  const next = await sessions.rotateSession(first.refreshToken);
  expect(next.rememberMe).toBe(rememberMe);
  expect(next.expiresAt).toEqual(first.expiresAt);
  expect(mockRows.get(sessions.hashOpaque(next.refreshToken)).rememberMe).toBe(rememberMe);
  const res = { cookie: jest.fn() };
  sessions.setRefreshCookie(res, next.refreshToken, next.expiresAt, next.rememberMe);
  const options = res.cookie.mock.calls[0][2];
  if (rememberMe) expect(options.maxAge).toBe(first.expiresAt.getTime() - Date.now());
  else {
    expect(options).not.toHaveProperty('maxAge');
    expect(options).not.toHaveProperty('expires');
  }
});

test('unremembered sessions cannot refresh after the eight-hour deadline', async () => {
  const first = await sessions.createSession(7, 'password', { rememberMe: false });
  jest.advanceTimersByTime(8 * 60 * 60 * 1000);
  expect(await sessions.rotateSession(first.refreshToken)).toBeNull();
  expect(await sessions.activeFamily([...mockRows.values()][0].familyId, 7)).toBe(false);
});

test('existing rows without an explicit preference keep their persistent session on rotation', async () => {
  const first = await sessions.createSession(7);
  delete mockRows.get(sessions.hashOpaque(first.refreshToken)).rememberMe;
  const next = await sessions.rotateSession(first.refreshToken);
  expect(next.rememberMe).toBe(true);
  expect(mockRows.get(sessions.hashOpaque(next.refreshToken)).rememberMe).toBe(true);
});

test('refresh cookies retain security flags and persistence is capped at fourteen days', () => {
  const res = { cookie: jest.fn() };
  sessions.setRefreshCookie(res, 'opaque', new Date(Date.now() + 30 * 86400000));
  expect(res.cookie).toHaveBeenLastCalledWith(sessions.refreshCookieName(), 'opaque', {
    ...sessions.cookieSettings(), maxAge: 14 * 86400000,
  });
  sessions.setRefreshCookie(res, 'opaque', new Date(Date.now() - 1000));
  expect(res.cookie.mock.calls[1][2].maxAge).toBe(0);
  sessions.setRefreshCookie(res, 'opaque', undefined, false);
  expect(res.cookie).toHaveBeenLastCalledWith(sessions.refreshCookieName(), 'opaque', {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
  });
});
