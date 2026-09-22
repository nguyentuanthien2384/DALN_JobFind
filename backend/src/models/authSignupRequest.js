'use strict';
module.exports = (sequelize, DataTypes) => sequelize.define('AuthSignupRequest', {
  tokenHash: { type: DataTypes.STRING(64), primaryKey: true },
  provider: { type: DataTypes.STRING(40), allowNull: false },
  issuer: { type: DataTypes.STRING(255), allowNull: false },
  subject: { type: DataTypes.STRING(255), allowNull: false },
  email: { type: DataTypes.STRING(254), allowNull: false },
  firstName: DataTypes.STRING(100),
  lastName: DataTypes.STRING(100),
  rememberMe: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
}, { tableName: 'AuthSignupRequests', timestamps: true });
