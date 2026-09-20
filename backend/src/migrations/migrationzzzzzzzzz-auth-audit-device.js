'use strict';
// Additive and restartable: MySQL DDL may commit before a later statement fails.
module.exports = {
  async up(q, S) {
    const fields = await q.describeTable('AuthSessions');
    for (const [name, type] of [['deviceLabel', S.STRING(120)], ['startedAt', S.DATE], ['lastUsedAt', S.DATE]]) {
      if (!fields[name]) await q.addColumn('AuthSessions', name, { type, allowNull: true });
    }
    const identityFields = await q.describeTable('AuthIdentities');
    if (!identityFields.emailVerifiedAtLink) await q.addColumn('AuthIdentities', 'emailVerifiedAtLink', { type: S.BOOLEAN, allowNull: true });
    if (!identityFields.displayNameAtLink) await q.addColumn('AuthIdentities', 'displayNameAtLink', { type: S.STRING(120), allowNull: true });
    const tables = (await q.showAllTables()).map(t => String(t).toLowerCase());
    if (!tables.includes('authsecurityevents')) await q.createTable('AuthSecurityEvents', {
      id: { type: S.BIGINT, autoIncrement: true, primaryKey: true },
      userId: { type: S.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' },
      event: { type: S.STRING(64), allowNull: false },
      deviceLabel: S.STRING(120),
      createdAt: { type: S.DATE, allowNull: false },
    });
    const indexes = await q.showIndex('AuthSecurityEvents');
    if (!indexes.some(i => i.name === 'idx_auth_event_user_id')) await q.addIndex('AuthSecurityEvents', ['userId', 'id'], { name: 'idx_auth_event_user_id' });
  },
  async down() { throw new Error('Retain authentication history during rollback; roll back application code only.'); },
};
