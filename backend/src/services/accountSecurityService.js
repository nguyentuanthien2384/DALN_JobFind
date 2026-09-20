import db from '../models/index';
import { lockAccount, revokeAll } from './authSessionService';

// Commit credential/status changes and revocation together, under the same lock
// used by refresh. A failed revocation must roll back the account update too.
export const saveAndRevokeSessions = account => db.sequelize.transaction(async transaction => {
  await lockAccount(account.userId, transaction);
  await account.save({ transaction });
  await revokeAll(account.userId, transaction);
});
