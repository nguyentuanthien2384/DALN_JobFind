'use strict';
// Additive and restartable: retain existing sessions and pending OAuth flows.
module.exports = {
  async up(q, S) {
    for (const table of ['AuthSessions', 'OidcTransactions']) {
      const fields = await q.describeTable(table);
      if (!fields.rememberMe) await q.addColumn(table, 'rememberMe', {
        type: S.BOOLEAN, allowNull: false, defaultValue: true,
      });
    }
    const tables = (await q.showAllTables()).map(table => String(table).toLowerCase());
    if (!tables.includes('authregistrationlocks')) await q.createTable('AuthRegistrationLocks', {
      key: { type: S.STRING(64), allowNull: false, primaryKey: true },
    }, { charset: 'utf8mb4', collate: 'utf8mb4_bin' });
    if (!tables.includes('authsignuprequests')) await q.createTable('AuthSignupRequests', {
      tokenHash: { type: S.STRING(64), primaryKey: true },
      provider: { type: S.STRING(40), allowNull: false },
      issuer: { type: S.STRING(255), allowNull: false },
      subject: { type: S.STRING(255), allowNull: false },
      email: { type: S.STRING(254), allowNull: false },
      firstName: S.STRING(100), lastName: S.STRING(100),
      rememberMe: { type: S.BOOLEAN, allowNull: false, defaultValue: true },
      expiresAt: { type: S.DATE, allowNull: false },
      createdAt: { type: S.DATE, allowNull: false },
      updatedAt: { type: S.DATE, allowNull: false },
    }, { charset: 'utf8mb4', collate: 'utf8mb4_bin' });
    const indexes = await q.showIndex('AuthSignupRequests');
    if (!indexes.some(index => index.name === 'idx_auth_signup_expiry')) await q.addIndex('AuthSignupRequests', ['expiresAt'], { name: 'idx_auth_signup_expiry' });
  },
  async down() { throw new Error('Keep auth data when rolling back application code.'); },
};
