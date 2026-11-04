'use strict';
const { Model } = require('sequelize');

// Vi diem dung chung: ung vien (ownerType CANDIDATE, ownerId = userId) va
// nha tuyen dung (ownerType COMPANY, ownerId = companyId, diem Top Point).
module.exports = (sequelize, DataTypes) => {
    class RewardWallet extends Model {
        static associate(models) {
            RewardWallet.hasMany(models.RewardTransaction, { foreignKey: 'walletId', as: 'walletTransactionData' });
        }
    }

    RewardWallet.init({
        ownerType: { type: DataTypes.STRING(20), allowNull: false },
        ownerId: { type: DataTypes.INTEGER, allowNull: false },
        balance: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        lifetimeEarned: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        lifetimeSpent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
    }, {
        sequelize,
        modelName: 'RewardWallet',
        indexes: [{ unique: true, fields: ['ownerType', 'ownerId'] }]
    });

    return RewardWallet;
};
