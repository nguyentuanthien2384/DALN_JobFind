'use strict';
module.exports = {
  async up(q, S) {
    const columns = await q.describeTable('OidcTransactions');
    if (!columns.linkSessionId) await q.addColumn('OidcTransactions', 'linkSessionId', { type: S.UUID, allowNull: true });
    // Provider subjects are opaque, case-sensitive identifiers.
    await q.sequelize.query('ALTER TABLE `AuthIdentities` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  },
  async down() {
    throw new Error('Keep auth data and binding columns when rolling back application code.');
  },
};
