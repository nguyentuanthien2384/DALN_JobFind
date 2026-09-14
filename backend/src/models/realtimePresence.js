'use strict';
module.exports = (sequelize, DataTypes) => sequelize.define('RealtimePresence', {
    userId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
    lastSeenAt: { type: DataTypes.DATE(3), allowNull: false },
}, { timestamps: false });
