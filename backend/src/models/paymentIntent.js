'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class PaymentIntent extends Model {
        static associate(models) {
            PaymentIntent.belongsTo(models.User, {
                foreignKey: 'userId',
                targetKey: 'id',
                as: 'paymentUserData'
            });
            PaymentIntent.belongsTo(models.Company, {
                foreignKey: 'companyId',
                targetKey: 'id',
                as: 'paymentCompanyData'
            });
            PaymentIntent.hasOne(models.OrderPackage, {
                foreignKey: 'paymentIntentId',
                as: 'postOrderData'
            });
            PaymentIntent.hasOne(models.OrderPackageCV, {
                foreignKey: 'paymentIntentId',
                as: 'cvOrderData'
            });
        }
    }

    PaymentIntent.init({
        provider: {
            type: DataTypes.STRING(20),
            allowNull: false,
            defaultValue: 'PAYPAL'
        },
        providerPaymentId: {
            type: DataTypes.STRING(191),
            allowNull: false
        },
        providerToken: {
            type: DataTypes.STRING(191),
            allowNull: false
        },
        providerPayerId: DataTypes.STRING(191),
        userId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        companyId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        packageType: {
            type: DataTypes.STRING(20),
            allowNull: false
        },
        packageId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        quantity: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        unitPrice: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false
        },
        totalPrice: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false
        },
        currency: {
            type: DataTypes.STRING(3),
            allowNull: false,
            defaultValue: 'USD'
        },
        entitlementType: {
            type: DataTypes.STRING(30),
            allowNull: false
        },
        entitlementAmount: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        status: {
            type: DataTypes.STRING(20),
            allowNull: false,
            defaultValue: 'PENDING'
        },
        expiresAt: {
            type: DataTypes.DATE,
            allowNull: false
        },
        completedAt: DataTypes.DATE
    }, {
        sequelize,
        modelName: 'PaymentIntent',
        indexes: [
            { unique: true, fields: ['providerPaymentId'] },
            { unique: true, fields: ['providerToken'] },
            { fields: ['userId', 'packageType', 'status'] },
            { fields: ['expiresAt', 'status'] }
        ]
    });

    return PaymentIntent;
};
