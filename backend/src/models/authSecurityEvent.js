'use strict';
module.exports = (sequelize, DataTypes) => sequelize.define('AuthSecurityEvent', {
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  userId: DataTypes.INTEGER,
  event: { type: DataTypes.STRING(64), allowNull: false },
  deviceLabel: DataTypes.STRING(120),
}, { tableName: 'AuthSecurityEvents', timestamps: true, updatedAt: false });
