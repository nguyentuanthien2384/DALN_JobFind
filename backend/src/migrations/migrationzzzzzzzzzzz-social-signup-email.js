'use strict';
// Additive and restartable: social signups may arrive without a provider-verified email.
module.exports = {
  async up(q, S) {
    const fields = await q.describeTable('AuthSignupRequests');
    if (!fields.emailVerified) await q.addColumn('AuthSignupRequests', 'emailVerified', {
      type: S.BOOLEAN, allowNull: false, defaultValue: false,
    });
    if (fields.email && !fields.email.allowNull) await q.changeColumn('AuthSignupRequests', 'email', {
      type: S.STRING(254), allowNull: true,
    });
  },
  async down() { throw new Error('Keep auth data when rolling back application code.'); },
};
