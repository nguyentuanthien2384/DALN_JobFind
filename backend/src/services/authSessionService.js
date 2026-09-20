import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from '../models/index';
import { getJwtSecret, getJwtSignOptions } from '../utils/securityConfig';
import { Op } from 'sequelize';
import bcrypt from 'bcryptjs';
const REFRESH_TTL = 14 * 24 * 60 * 60;
const uuid = () => crypto.randomUUID();
const secret = () => crypto.randomBytes(48).toString('base64url');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const refreshCookieName = () => process.env.NODE_ENV === 'production' ? '__Host-jobfind_rt' : 'jobfind_rt';
export const cookieSettings = () => ({
  httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
});
export const setRefreshCookie = (res, token) => res.cookie(refreshCookieName(), token, {
  ...cookieSettings(), maxAge: REFRESH_TTL * 1000,
});
export const clearRefreshCookie = (res) => res.clearCookie(refreshCookieName(), cookieSettings());
export const readRefreshCookie = (req) => {
  const raw = req.headers.cookie || '';
  const name = `${refreshCookieName()}=`;
  const entry = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name));
  if (!entry) return null;
  try { return decodeURIComponent(entry.slice(name.length)); } catch { return null; }
};
const validToken = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{60,128}$/.test(value);
const signAccess = (user, familyId) => jwt.sign({
  sub: user.id, sid: familyId, roleCode: user.userAccountData.roleCode, companyId: user.companyId || null,
}, getJwtSecret(), getJwtSignOptions());
const accountIncludes = [
  { model: db.Account, as: 'userAccountData', attributes: ['roleCode', 'statusCode'], required: true },
  { model: db.Company, as: 'userCompanyData', attributes: ['id', 'statusCode', 'censorCode'], required: false },
];
export const loadUser = async (id, transaction) => {
  const user = await db.User.findByPk(id, { raw: false, transaction, attributes: { exclude: ['file'] }, include: accountIncludes });
  return user?.userAccountData?.statusCode === 'S1' ? user : null;
};
export const publicUser = (user) => {
  const data = user.toJSON();
  delete data.userAccountData;
  data.roleCode = user.userAccountData.roleCode;
  data.companyStatusCode = user.userCompanyData?.statusCode || null;
  data.companyCensorCode = user.userCompanyData?.censorCode || null;
  delete data.userCompanyData;
  return data;
};
export const createSession = async (userId, method = 'password', proof = {}) => {
  return db.sequelize.transaction(async transaction => {
  const account = await lockAccount(userId, transaction);
  if (proof.password !== undefined && (!account || !await bcrypt.compare(proof.password, account.password))) throw new Error('CREDENTIALS_CHANGED');
  if (proof.identityId && !await db.AuthIdentity.findOne({ where: { id: proof.identityId, userId }, transaction })) throw new Error('IDENTITY_REMOVED');
  const user = await loadUser(userId, transaction);
  if (!user) throw new Error('INACTIVE_ACCOUNT');
  const familyId = uuid();
  const refreshToken = secret();
  await db.AuthSession.create({
    id: uuid(), familyId, userId: user.id, tokenHash: digest(refreshToken), method,
    expiresAt: new Date(Date.now() + REFRESH_TTL * 1000),
  }, { transaction });
  return { refreshToken, token: signAccess(user, familyId), user: publicUser(user) };
  });
};
export const activeFamily = async (familyId, userId, transaction) => {
  if (typeof familyId !== 'string' || !/^[0-9a-f-]{36}$/i.test(familyId)) return false;
  return Boolean(await db.AuthSession.findOne({ where: {
    familyId, userId, revokedAt: null, rotatedAt: null, expiresAt: { [Op.gt]: new Date() },
  }, attributes: ['id'], transaction }));
};
export const revokeFamily = async (familyId, transaction) => {
  if (!familyId) return;
  if (!transaction) {
    const row = await db.AuthSession.findOne({ where: { familyId }, attributes: ['userId'] });
    if (!row) return;
    return db.sequelize.transaction(async tx => {
      await lockAccount(row.userId, tx);
      return revokeFamily(familyId, tx);
    });
  }
  await db.AuthSession.update({ revokedAt: new Date() }, { where: { familyId, revokedAt: null }, transaction });
};
export const lockAccount = (userId, transaction) => db.Account.findOne({ where: { userId }, transaction, lock: transaction.LOCK.UPDATE });
export const revokeAll = async (userId, transaction) => {
  if (!transaction) return db.sequelize.transaction(async tx => {
    await lockAccount(userId, tx);
    return revokeAll(userId, tx);
  });
  return db.AuthSession.update({ revokedAt: new Date() }, { where: { userId, revokedAt: null }, transaction });
};
export const revokeByRefresh = async (raw) => {
  if (!validToken(raw)) return;
  const existing = await db.AuthSession.findOne({ where: { tokenHash: digest(raw) }, attributes: ['familyId'] });
  if (existing) await revokeFamily(existing.familyId);
};
export const rotateSession = async (raw) => {
  if (!validToken(raw)) return null;
  const owner = await db.AuthSession.findOne({ where: { tokenHash: digest(raw) }, attributes: ['userId'] });
  if (!owner) return null;
  // Lock the generation row to serialize concurrent refreshes across API replicas.
  return db.sequelize.transaction(async (transaction) => {
    // Every creation, rotation and revocation locks the account first. A logout
    // cannot miss a new generation inserted concurrently by another replica.
    await lockAccount(owner.userId, transaction);
    const old = await db.AuthSession.findOne({ raw: false, where: { tokenHash: digest(raw) }, transaction,
      lock: transaction.LOCK.UPDATE });
    if (!old) return null;
    if (old.rotatedAt) {
      await revokeFamily(old.familyId, transaction); // reuse: invalidate the full token family
      return null;
    }
    if (old.revokedAt || old.expiresAt <= new Date()) return null;
    const user = await loadUser(old.userId, transaction);
    if (!user) {
      await revokeFamily(old.familyId, transaction);
      return null;
    }
    const nextToken = secret();
    const now = new Date();
    await old.update({ rotatedAt: now }, { transaction });
    await db.AuthSession.create({
      id: uuid(), familyId: old.familyId, userId: old.userId, tokenHash: digest(nextToken),
      method: old.method, expiresAt: old.expiresAt,
    }, { transaction });
    return { refreshToken: nextToken, token: signAccess(user, old.familyId), user: publicUser(user) };
  });
};
export const hashOpaque = digest;
