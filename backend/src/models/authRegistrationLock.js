'use strict';
module.exports = (sequelize, DataTypes) => sequelize.define('AuthRegistrationLock', {
  key: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
}, { tableName: 'AuthRegistrationLocks', timestamps: false });
