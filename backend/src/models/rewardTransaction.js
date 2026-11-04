'use strict';
const { Model } = require('sequelize');

// So cai diem (ledger) chi ghi them, khong sua. idempotencyKey UNIQUE dam bao
// mot su kien (nop CV, diem danh, don nap tien...) khong bao gio duoc cong 2 lan.
module.exports = (sequelize, DataTypes) => {
    class RewardTransaction extends Model {
        static associate(models) {
            RewardTransaction.belongsTo(models.RewardWallet, { foreignKey: 'walletId', targetKey: 'id', as: 'walletData' });
        }
    }

    RewardTransaction.init({
        walletId: { type: DataTypes.INTEGER, allowNull: false },
        direction: { type: DataTypes.STRING(10), allowNull: false },
        amount: { type: DataTypes.INTEGER, allowNull: false },
        balanceAfter: { type: DataTypes.INTEGER, allowNull: false },
        reasonCode: { type: DataTypes.STRING(40), allowNull: false },
        description: DataTypes.STRING(255),
        refType: DataTypes.STRING(30),
        refId: DataTypes.STRING(64),
        idempotencyKey: { type: DataTypes.STRING(191), allowNull: false }
    }, {
        sequelize,
        modelName: 'RewardTransaction',
        indexes: [
            { unique: true, fields: ['idempotencyKey'] },
            { fields: ['walletId', 'createdAt'] }
        ]
    });

    return RewardTransaction;
};
