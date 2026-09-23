const mockRows = new Map();
jest.mock('../../src/services/authAuditService', () => ({ recordSecurityEvent: jest.fn() }));
const mockFindUser = jest.fn();
const mockFindAccount = jest.fn();
const mockFindIdentity = jest.fn();
const mockCreate = jest.fn(async data => {
  const row = { ...data, async update(patch) { Object.assign(this, patch); } };
  mockRows.set(data.tokenHash, row);
  return row;
});
const mockFindOne = jest.fn(async ({ where }) => {
  if (where.tokenHash) return mockRows.get(where.tokenHash) || null;
  if (where.familyId) return [...mockRows.values()].find(r =>
    r.familyId === where.familyId &&
    (where.userId === undefined || r.userId === where.userId) &&
    (where.revokedAt === undefined || !r.revokedAt) &&
    (where.rotatedAt === undefined || !r.rotatedAt) &&
    (where.expiresAt === undefined || r.expiresAt > new Date())) || null;
  return null;
});
const mockUpdate = jest.fn(async (patch, { where }) => {
  let changed = 0;
  for (const row of mockRows.values()) {
    if ((where.familyId === undefined || row.familyId === where.familyId) &&
        (where.userId === undefined || row.userId === where.userId) &&
        (where.revokedAt === undefined || !row.revokedAt)) {
      Object.assign(row, patch);
      changed++;
    }
  }
  return [changed];
});
jest.mock('../../src/models/index', () => ({
  Sequelize: { Op: { gt: Symbol('gt') } },
  sequelize: { transaction: jest.fn(async cb => cb({ LOCK: { UPDATE: 'UPDATE' } })) },
  AuthSession: { create: mockCreate, findOne: mockFindOne, update: mockUpdate },
  User: { findByPk: mockFindUser }, Account: { findOne: mockFindAccount },
  AuthIdentity: { findOne: mockFindIdentity }, Company: {},
}));
jest.mock('jsonwebtoken', () => ({ sign: jest.fn((payload) => `access:${payload.sid}`) }));
const sessions = require('../../src/services/authSessionService');
const db = require('../../src/models/index');
const { recordSecurityEvent } = require('../../src/services/authAuditService');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const user = {
  id: 7, companyId: null, firstName: 'A',
  userAccountData: { statusCode: 'S1', roleCode: 'CANDIDATE' },
  toJSON() { return { id: 7, companyId: null, firstName: 'A', userAccountData: this.userAccountData }; },
};
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-22T08:00:00Z'));
  mockRows.clear(); jest.clearAllMocks(); mockFindUser.mockResolvedValue(user);
  mockFindAccount.mockResolvedValue({ userId: 7 });
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

test('rotation preserves the original creation time for older rows without startedAt', async () => {
  const first = await sessions.createSession(7);
  const old = mockRows.get(sessions.hashOpaque(first.refreshToken));
  const createdAt = new Date(Date.now() - 60000);
  delete old.startedAt;
  old.createdAt = createdAt;
  const next = await sessions.rotateSession(first.refreshToken);
  expect(mockRows.get(sessions.hashOpaque(next.refreshToken)).startedAt).toEqual(createdAt);
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

test('cookie names and flags change in production, and clearing uses the same scope', () => {
  const previous = process.env.NODE_ENV;
  const res = { cookie: jest.fn(), clearCookie: jest.fn() };
  try {
    process.env.NODE_ENV = 'production';
    expect(sessions.refreshCookieName()).toBe('__Host-jobfind_rt');
    expect(sessions.cookieSettings()).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    sessions.setRefreshCookie(res, 'opaque', undefined);
    expect(res.cookie).toHaveBeenCalledWith('__Host-jobfind_rt', 'opaque', {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 14 * 86400000,
    });
    sessions.clearRefreshCookie(res);
    expect(res.clearCookie).toHaveBeenCalledWith('__Host-jobfind_rt', {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/',
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('reads only the exact refresh cookie and handles missing or malformed encoding', () => {
  const name = sessions.refreshCookieName();
  expect(sessions.readRefreshCookie({ headers: {} })).toBeNull();
  expect(sessions.readRefreshCookie({ headers: { cookie: `other_${name}=wrong; ${name}=abc%2D123; x=1` } })).toBe('abc-123');
  expect(sessions.readRefreshCookie({ headers: { cookie: `${name}=%ZZ` } })).toBeNull();
  expect(sessions.readRefreshCookie({ headers: { cookie: `${name}2=wrong` } })).toBeNull();
});

test('loads only active users and removes account internals from the public profile', async () => {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const employee = {
    ...user, companyId: 12,
    userCompanyData: { id: 12, statusCode: 'S1', censorCode: 'CS1' },
    toJSON() { return { id: 7, companyId: 12, userAccountData: this.userAccountData,
      userCompanyData: this.userCompanyData }; },
  };
  mockFindUser.mockResolvedValueOnce(employee).mockResolvedValueOnce({ ...user,
    userAccountData: { statusCode: 'S2', roleCode: 'CANDIDATE' },
  }).mockResolvedValueOnce(null);
  expect(await sessions.loadUser(7, transaction)).toBe(employee);
  expect(mockFindUser).toHaveBeenCalledWith(7, expect.objectContaining({
    raw: false, transaction, attributes: { exclude: ['file'] },
    include: expect.arrayContaining([expect.objectContaining({ as: 'userAccountData', required: true })]),
  }));
  expect(sessions.publicUser(employee)).toEqual({
    id: 7, companyId: 12, roleCode: 'CANDIDATE',
    companyStatusCode: 'S1', companyCensorCode: 'CS1',
  });
  expect(employee.userAccountData).toEqual({ statusCode: 'S1', roleCode: 'CANDIDATE' });
  expect(await sessions.loadUser(7, transaction)).toBeNull();
  expect(await sessions.loadUser(7, transaction)).toBeNull();
});

test('password login rechecks the current locked hash before issuing a session', async () => {
  mockFindAccount.mockResolvedValue({ userId: 7, password: bcrypt.hashSync('current-password', 4) });
  await expect(sessions.createSession(7, 'password', { password: 'old-password' }))
    .rejects.toThrow('CREDENTIALS_CHANGED');
  expect(mockCreate).not.toHaveBeenCalled();
  const issued = await sessions.createSession(7, 'password', { password: 'current-password', deviceLabel: 'Laptop' });
  expect(issued.user.id).toBe(7);
  expect(mockFindAccount).toHaveBeenCalledWith({
    where: { userId: 7 }, transaction: expect.any(Object), lock: 'UPDATE',
  });
  expect(mockCreate.mock.calls[0][0]).toMatchObject({ method: 'password', deviceLabel: 'Laptop' });
  expect(recordSecurityEvent).toHaveBeenCalledWith({
    event: 'login_succeeded', userId: 7, device: 'Laptop',
  }, expect.any(Object));
});

test('removed social identity or inactive account prevents session creation', async () => {
  await expect(sessions.createSession(7, 'google', { identityId: 81 })).rejects.toThrow('IDENTITY_REMOVED');
  expect(mockFindIdentity).toHaveBeenCalledWith({
    where: { id: 81, userId: 7 }, transaction: expect.any(Object),
  });
  expect(mockFindUser).not.toHaveBeenCalled();
  mockFindIdentity.mockResolvedValue({ id: 81 });
  mockFindUser.mockResolvedValue(null);
  await expect(sessions.createSession(7, 'google', { identityId: 81 })).rejects.toThrow('INACTIVE_ACCOUNT');
  expect(mockCreate).not.toHaveBeenCalled();
  expect(recordSecurityEvent).not.toHaveBeenCalled();
});

test('social identity proof stores the selected method and never stores the raw refresh token', async () => {
  mockFindIdentity.mockResolvedValue({ id: 81 });
  const issued = await sessions.createSession(7, 'google', { identityId: 81, deviceLabel: 'Mobile' });
  const row = mockRows.get(sessions.hashOpaque(issued.refreshToken));
  expect(row).toMatchObject({ userId: 7, method: 'google', deviceLabel: 'Mobile', rememberMe: true });
  expect(row.tokenHash).not.toBe(issued.refreshToken);
  expect(row.expiresAt.getTime() - row.startedAt.getTime()).toBe(14 * 86400000);
});

test('activeFamily checks a well-formed family, matching owner and unexpired live generation', async () => {
  const issued = await sessions.createSession(7);
  const row = mockRows.get(sessions.hashOpaque(issued.refreshToken));
  mockFindOne.mockClear();
  expect(await sessions.activeFamily('not-a-uuid', 7)).toBe(false);
  expect(mockFindOne).not.toHaveBeenCalled();
  expect(await sessions.activeFamily(row.familyId, 99)).toBe(false);
  expect(await sessions.activeFamily(row.familyId, 7)).toBe(true);
  expect(mockFindOne).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { familyId: row.familyId, userId: 7, revokedAt: null, rotatedAt: null,
      expiresAt: { [Op.gt]: new Date() } },
    attributes: ['id'],
  }));
  row.rotatedAt = new Date();
  expect(await sessions.activeFamily(row.familyId, 7)).toBe(false);
  row.rotatedAt = null;
  row.revokedAt = new Date();
  expect(await sessions.activeFamily(row.familyId, 7)).toBe(false);
  row.revokedAt = null;
  row.expiresAt = new Date(Date.now() - 1);
  expect(await sessions.activeFamily(row.familyId, 7)).toBe(false);
});

test('revokeFamily locks its owner, revokes every generation and audits exactly once', async () => {
  const first = await sessions.createSession(7, 'password', { deviceLabel: 'Browser' });
  const second = await sessions.rotateSession(first.refreshToken);
  const familyId = mockRows.get(sessions.hashOpaque(first.refreshToken)).familyId;
  db.sequelize.transaction.mockClear();
  mockFindAccount.mockClear();
  recordSecurityEvent.mockClear();
  await sessions.revokeFamily(familyId);
  expect(db.sequelize.transaction).toHaveBeenCalledTimes(1);
  expect(mockFindAccount).toHaveBeenCalledWith({
    where: { userId: 7 }, transaction: expect.any(Object), lock: 'UPDATE',
  });
  expect(mockUpdate).toHaveBeenCalledWith({ revokedAt: expect.any(Date) }, {
    where: { familyId, revokedAt: null }, transaction: expect.any(Object),
  });
  expect([...mockRows.values()].every(row => row.revokedAt instanceof Date)).toBe(true);
  expect(await sessions.rotateSession(second.refreshToken)).toBeNull();
  expect(recordSecurityEvent).toHaveBeenCalledTimes(1);
  expect(recordSecurityEvent).toHaveBeenCalledWith({
    event: 'session_revoked', userId: 7, device: 'Browser',
  }, expect.any(Object));
});

test('revokeFamily ignores absent and already revoked families without duplicate audit events', async () => {
  await sessions.revokeFamily(null);
  await sessions.revokeFamily('missing-family');
  expect(db.sequelize.transaction).not.toHaveBeenCalled();
  const first = await sessions.createSession(7);
  const familyId = mockRows.get(sessions.hashOpaque(first.refreshToken)).familyId;
  recordSecurityEvent.mockClear();
  await sessions.revokeFamily(familyId);
  await sessions.revokeFamily(familyId);
  expect(recordSecurityEvent).toHaveBeenCalledTimes(1);
});

test('revokeAll scopes updates to one user, holds the account lock and records the requested event', async () => {
  const first = await sessions.createSession(7);
  mockRows.set('other-token-hash', { userId: 99, familyId: 'other', revokedAt: null });
  recordSecurityEvent.mockClear();
  const changed = await sessions.revokeAll(7, undefined, 'password_changed');
  expect(changed).toEqual([1]);
  expect(mockFindAccount).toHaveBeenLastCalledWith({
    where: { userId: 7 }, transaction: expect.any(Object), lock: 'UPDATE',
  });
  expect(mockRows.get(sessions.hashOpaque(first.refreshToken)).revokedAt).toEqual(new Date());
  expect(mockRows.get('other-token-hash').revokedAt).toBeNull();
  expect(recordSecurityEvent).toHaveBeenCalledWith({ event: 'password_changed', userId: 7 }, expect.any(Object));
});

test('revokeByRefresh ignores malformed and unknown tokens, then revokes a known family', async () => {
  const first = await sessions.createSession(7);
  mockFindOne.mockClear();
  await sessions.revokeByRefresh('too-short');
  expect(mockFindOne).not.toHaveBeenCalled();
  await sessions.revokeByRefresh('x'.repeat(64));
  expect(mockUpdate).not.toHaveBeenCalled();
  await sessions.revokeByRefresh(first.refreshToken);
  expect(mockRows.get(sessions.hashOpaque(first.refreshToken)).revokedAt).toEqual(new Date());
  expect(mockFindOne).toHaveBeenCalledWith(expect.objectContaining({
    where: { tokenHash: sessions.hashOpaque(first.refreshToken) }, attributes: ['familyId'],
  }));
});

test.each([null, '', 'short', 'a'.repeat(129), `${'a'.repeat(63)}!`])(
  'rotateSession rejects an invalid credential before querying: %p', async raw => {
    expect(await sessions.rotateSession(raw)).toBeNull();
    expect(mockFindOne).not.toHaveBeenCalled();
  },
);

test('rotation returns null for unknown or removed generation after locking its owner', async () => {
  expect(await sessions.rotateSession('z'.repeat(64))).toBeNull();
  expect(db.sequelize.transaction).not.toHaveBeenCalled();
  mockFindOne.mockResolvedValueOnce({ userId: 7 }).mockResolvedValueOnce(null);
  expect(await sessions.rotateSession('a'.repeat(64))).toBeNull();
  expect(mockFindAccount).toHaveBeenCalledWith({
    where: { userId: 7 }, transaction: expect.any(Object), lock: 'UPDATE',
  });
  expect(mockCreate).not.toHaveBeenCalled();
});

test('revoked and expired generations cannot rotate or extend their deadline', async () => {
  const revoked = await sessions.createSession(7);
  mockRows.get(sessions.hashOpaque(revoked.refreshToken)).revokedAt = new Date();
  mockCreate.mockClear();
  expect(await sessions.rotateSession(revoked.refreshToken)).toBeNull();
  expect(mockCreate).not.toHaveBeenCalled();
  const expired = await sessions.createSession(7);
  mockRows.get(sessions.hashOpaque(expired.refreshToken)).expiresAt = new Date();
  mockCreate.mockClear();
  expect(await sessions.rotateSession(expired.refreshToken)).toBeNull();
  expect(mockCreate).not.toHaveBeenCalled();
});

test('inactive account during refresh revokes the entire family and audits the revocation', async () => {
  const issued = await sessions.createSession(7);
  const familyId = mockRows.get(sessions.hashOpaque(issued.refreshToken)).familyId;
  mockFindUser.mockResolvedValueOnce(null);
  recordSecurityEvent.mockClear();
  expect(await sessions.rotateSession(issued.refreshToken)).toBeNull();
  expect(mockRows.get(sessions.hashOpaque(issued.refreshToken)).revokedAt).toEqual(new Date());
  expect(recordSecurityEvent).toHaveBeenCalledWith({
    event: 'session_revoked', userId: 7, device: null,
  }, expect.any(Object));
  expect(await sessions.activeFamily(familyId, 7)).toBe(false);
});

test('database failures reject issuance, rotation and revocation without returning credentials', async () => {
  mockFindAccount.mockRejectedValueOnce(new Error('account unavailable'));
  await expect(sessions.createSession(7)).rejects.toThrow('account unavailable');
  expect(mockCreate).not.toHaveBeenCalled();
  const issued = await sessions.createSession(7);
  const row = mockRows.get(sessions.hashOpaque(issued.refreshToken));
  row.update = jest.fn().mockRejectedValueOnce(new Error('rotation failed'));
  await expect(sessions.rotateSession(issued.refreshToken)).rejects.toThrow('rotation failed');
  expect(mockRows.size).toBe(1);
  mockUpdate.mockRejectedValueOnce(new Error('revoke failed'));
  await expect(sessions.revokeAll(7)).rejects.toThrow('revoke failed');
});
