'use strict';
module.exports = (sequelize, DataTypes) => sequelize.define('OidcTransaction', {
  stateHash: { type: DataTypes.STRING(64), primaryKey: true },
  provider: { type: DataTypes.STRING(40), allowNull: false },
  verifier: { type: DataTypes.STRING(128), allowNull: false },
  nonce: { type: DataTypes.STRING(128), allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  browserHash: { type: DataTypes.STRING(64), allowNull: false },
  linkUserId: DataTypes.INTEGER,
}, { tableName: 'OidcTransactions', timestamps: true });
