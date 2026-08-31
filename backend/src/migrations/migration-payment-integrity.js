'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('PaymentIntents', {
            id: {
                allowNull: false,
                primaryKey: true,
                type: Sequelize.INTEGER,
                autoIncrement: true
            },
            provider: {
                allowNull: false,
                type: Sequelize.STRING(20),
                defaultValue: 'PAYPAL'
            },
            providerPaymentId: {
                allowNull: false,
                type: Sequelize.STRING(191)
            },
            providerToken: {
                allowNull: false,
                type: Sequelize.STRING(191)
            },
            providerPayerId: Sequelize.STRING(191),
            userId: {
                allowNull: false,
                type: Sequelize.INTEGER,
                references: { model: 'Users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT'
            },
            companyId: {
                allowNull: false,
                type: Sequelize.INTEGER,
                references: { model: 'Companies', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT'
            },
            packageType: {
                allowNull: false,
                type: Sequelize.STRING(20)
            },
            packageId: {
                allowNull: false,
                type: Sequelize.INTEGER
            },
            quantity: {
                allowNull: false,
                type: Sequelize.INTEGER
            },
            unitPrice: {
                allowNull: false,
                type: Sequelize.DECIMAL(12, 2)
            },
            totalPrice: {
                allowNull: false,
                type: Sequelize.DECIMAL(12, 2)
            },
            currency: {
                allowNull: false,
                type: Sequelize.STRING(3),
                defaultValue: 'USD'
            },
            entitlementType: {
                allowNull: false,
                type: Sequelize.STRING(30)
            },
            entitlementAmount: {
                allowNull: false,
                type: Sequelize.INTEGER
            },
            status: {
                allowNull: false,
                type: Sequelize.STRING(20),
                defaultValue: 'PENDING'
            },
            expiresAt: {
                allowNull: false,
                type: Sequelize.DATE
            },
            completedAt: Sequelize.DATE,
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        await queryInterface.addIndex('PaymentIntents', ['providerPaymentId'], {
            name: 'UX_PaymentIntents_ProviderPaymentId',
            unique: true
        });
        await queryInterface.addIndex('PaymentIntents', ['providerToken'], {
            name: 'UX_PaymentIntents_ProviderToken',
            unique: true
        });
        await queryInterface.addIndex('PaymentIntents', ['userId', 'packageType', 'status'], {
            name: 'IX_PaymentIntents_User_Type_Status'
        });
        await queryInterface.addIndex('PaymentIntents', ['expiresAt', 'status'], {
            name: 'IX_PaymentIntents_Expiry_Status'
        });

        await queryInterface.addColumn('OrderPackages', 'paymentIntentId', {
            type: Sequelize.INTEGER,
            allowNull: true,
            unique: true,
            references: { model: 'PaymentIntents', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT'
        });
        await queryInterface.addColumn('OrderPackageCVs', 'paymentIntentId', {
            type: Sequelize.INTEGER,
            allowNull: true,
            unique: true,
            references: { model: 'PaymentIntents', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT'
        });
    },

    down: async (queryInterface) => {
        await queryInterface.removeColumn('OrderPackageCVs', 'paymentIntentId');
        await queryInterface.removeColumn('OrderPackages', 'paymentIntentId');
        await queryInterface.dropTable('PaymentIntents');
    }
};
