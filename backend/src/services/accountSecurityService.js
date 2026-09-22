import db from '../models/index';
import { lockAccount, revokeAll } from './authSessionService';

// Commit credential/status changes and revocation together, under the same lock
// used by refresh. A failed revocation must roll back the account update too.
export const saveAndRevokeSessions = (account, expectedPasswordHash) => db.sequelize.transaction(async transaction => {
  const current = await lockAccount(account.userId, transaction);
  // Password proof checked before hashing must still match when the write lock
  // is acquired; a concurrent password change/reset invalidates that proof.
  if (expectedPasswordHash !== undefined && current?.password !== expectedPasswordHash) throw new Error('CREDENTIALS_CHANGED');
  await account.save({ transaction });
  await revokeAll(account.userId, transaction, 'account_security_changed');
});
