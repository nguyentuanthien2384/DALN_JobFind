module.exports = (sequelize, S) =>
  sequelize.define("WebPushDelivery", {
    id: { type: S.INTEGER, primaryKey: true, autoIncrement: true },
    messageId: { type: S.INTEGER, allowNull: false },
    subscriptionId: { type: S.STRING(64), allowNull: false },
    generation: { type: S.STRING(36), allowNull: false },
    userId: { type: S.INTEGER, allowNull: false },
    status: { type: S.STRING(16), allowNull: false, defaultValue: "pending" },
    attempts: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
    nextAttemptAt: { type: S.DATE, allowNull: false },
    lease: { type: S.STRING(36) },
    leaseUntil: { type: S.DATE },
    lastCode: { type: S.STRING(24) },
  });
