'use strict';
const { Model } = require('sequelize');

// Don thanh toan qua cong VNPAY / MoMo / ZaloPay / PayPal.
// purpose: POINT_TOPUP (ung vien nap diem) | PACKAGE_POST | PACKAGE_CV (nha tuyen dung mua goi).
// amount luon la VND do server tinh; providerAmount la so tien gui sang cong (USD voi PayPal).
module.exports = (sequelize, DataTypes) => {
    class PaymentOrder extends Model {
        static associate(models) {
            PaymentOrder.belongsTo(models.User, { foreignKey: 'userId', targetKey: 'id', as: 'paymentOrderUserData' });
            PaymentOrder.belongsTo(models.Company, { foreignKey: 'companyId', targetKey: 'id', as: 'paymentOrderCompanyData' });
        }
    }

    PaymentOrder.init({
        orderCode: { type: DataTypes.STRING(64), allowNull: false },
        provider: { type: DataTypes.STRING(20), allowNull: false },
        purpose: { type: DataTypes.STRING(30), allowNull: false },
        userId: { type: DataTypes.INTEGER, allowNull: false },
        companyId: DataTypes.INTEGER,
        itemCode: { type: DataTypes.STRING(40), allowNull: false },
        itemName: DataTypes.STRING(191),
        quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        unitPrice: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        originalAmount: { type: DataTypes.INTEGER, allowNull: false },
        discountAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        amount: { type: DataTypes.INTEGER, allowNull: false },
        promoCode: DataTypes.STRING(40),
        currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'VND' },
        providerAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
        points: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        entitlementType: DataTypes.STRING(30),
        entitlementAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PENDING' },
        providerRef: DataTypes.STRING(191),
        providerTransId: DataTypes.STRING(191),
        failureReason: DataTypes.STRING(255),
        simulated: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        paidAt: DataTypes.DATE,
        expiresAt: { type: DataTypes.DATE, allowNull: false }
    }, {
        sequelize,
        modelName: 'PaymentOrder',
        indexes: [
            { unique: true, fields: ['orderCode'] },
            { fields: ['userId', 'createdAt'] },
            { fields: ['status', 'expiresAt'] }
        ]
    });

    return PaymentOrder;
};
