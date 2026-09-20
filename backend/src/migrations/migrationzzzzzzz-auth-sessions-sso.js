'use strict';
// Additive migration. Never drop these tables during an application rollback.
module.exports = {
  async up(q, S) {
    await q.createTable('AuthSessions', {
      id: { type: S.UUID, primaryKey: true },
      familyId: { type: S.UUID, allowNull: false },
      userId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      tokenHash: { type: S.STRING(64), allowNull: false, unique: true },
      method: { type: S.STRING(64), allowNull: false },
      expiresAt: { type: S.DATE, allowNull: false },
      rotatedAt: S.DATE, revokedAt: S.DATE,
      createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
    });
    await q.addIndex('AuthSessions', ['familyId'], { name: 'idx_auth_family' });
    await q.addIndex('AuthSessions', ['userId', 'revokedAt'], { name: 'idx_auth_user_revoked' });
    await q.createTable('AuthIdentities', {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      userId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      provider: { type: S.STRING(40), allowNull: false },
      issuer: { type: S.STRING(255), allowNull: false }, subject: { type: S.STRING(255), allowNull: false },
      emailAtLink: S.STRING(254), lastLoginAt: S.DATE,
      createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
    });
    await q.addIndex('AuthIdentities', ['issuer', 'subject'], { unique: true, name: 'uq_oidc_issuer_subject' });
    await q.createTable('OidcTransactions', {
      stateHash: { type: S.STRING(64), primaryKey: true },
      provider: { type: S.STRING(40), allowNull: false },
      verifier: { type: S.STRING(128), allowNull: false },
      nonce: { type: S.STRING(128), allowNull: false },
      expiresAt: { type: S.DATE, allowNull: false },
      browserHash: { type: S.STRING(64), allowNull: false },
      linkUserId: S.INTEGER,
      createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
    });
  },
  async down(q) {
    await q.dropTable('OidcTransactions');
    await q.dropTable('AuthIdentities');
    await q.dropTable('AuthSessions');
  }
};
