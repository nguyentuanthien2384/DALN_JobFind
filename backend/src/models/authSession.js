'use strict';
module.exports = (sequelize, DataTypes) => {
  const AuthSession = sequelize.define('AuthSession', {
    id: { type: DataTypes.UUID, primaryKey: true },
    familyId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    method: { type: DataTypes.STRING(64), allowNull: false },
    deviceLabel: DataTypes.STRING(120),
    startedAt: DataTypes.DATE,
    lastUsedAt: DataTypes.DATE,
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    rotatedAt: DataTypes.DATE,
    revokedAt: DataTypes.DATE,
  }, { tableName: 'AuthSessions', timestamps: true });
  AuthSession.associate = (db) => { AuthSession.belongsTo(db.User, { foreignKey: 'userId' }); };
  return AuthSession;
};
