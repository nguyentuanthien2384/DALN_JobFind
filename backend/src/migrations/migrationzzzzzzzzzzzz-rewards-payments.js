'use strict';

// Tich diem ung vien, JobFind Rewards (Top Point) cho nha tuyen dung, bao cao canh
// tranh va don thanh toan qua VNPAY / MoMo / ZaloPay / PayPal.
// Chi them bang moi; khong dong cham du lieu hien co.
const timestamps = (Sequelize) => ({
    createdAt: { allowNull: false, type: Sequelize.DATE },
    updatedAt: { allowNull: false, type: Sequelize.DATE }
});

module.exports = {
    up: async (queryInterface, Sequelize) => {
        const id = { allowNull: false, primaryKey: true, autoIncrement: true, type: Sequelize.INTEGER };

        await queryInterface.createTable('RewardWallets', {
            id,
            ownerType: { allowNull: false, type: Sequelize.STRING(20) },
            ownerId: { allowNull: false, type: Sequelize.INTEGER },
            balance: { allowNull: false, type: Sequelize.INTEGER, defaultValue: 0 },
            lifetimeEarned: { allowNull: false, type: Sequelize.INTEGER, defaultValue: 0 },
            lifetimeSpent: { allowNull: false, type: Sequelize.INTEGER, defaultValue: 0 },
            ...timestamps(Sequelize)
        });
        await queryInterface.addIndex('RewardWallets', ['ownerType', 'ownerId'], {
            name: 'UX_RewardWallets_Owner', unique: true
        });

        await queryInterface.createTable('RewardTransactions', {
            id,
            walletId: {
                allowNull: false, type: Sequelize.INTEGER,
                references: { model: 'RewardWallets', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE'
            },
            direction: { allowNull: false, type: Sequelize.STRING(10) },
            amount: { allowNull: false, type: Sequelize.INTEGER },
            balanceAfter: { allowNull: false, type: Sequelize.INTEGER },
            reasonCode: { allowNull: false, type: Sequelize.STRING(40) },
            description: Sequelize.STRING(255),
            refType: Sequelize.STRING(30),
            refId: Sequelize.STRING(64),
            idempotencyKey: { allowNull: false, type: Sequelize.STRING(191) },
            ...timestamps(Sequelize)
        });
        await queryInterface.addIndex('RewardTransactions', ['idempotencyKey'], {
            name: 'UX_RewardTransactions_Idempotency', unique: true
        });
        await queryInterface.addIndex('RewardTransactions', ['walletId', 'createdAt'], {
            name: 'IX_RewardTransactions_Wallet_Created'
        });

        await queryInterface.createTable('CompetitionUnlocks', {
            id,
            userId: {
                allowNull: false, type: Sequelize.INTEGER,
                references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE'
            },
            postId: {
                allowNull: false, type: Sequelize.INTEGER,
                references: { model: 'Posts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE'
            },
            transactionId: Sequelize.INTEGER,
            pointsSpent: { allowNull: false, type: Sequelize.INTEGER, defaultValue: 0 },
            expiresAt: { allowNull: false, type: Sequelize.DATE },
            ...timestamps(Sequelize)
        });
        await queryInterface.addIndex('CompetitionUnlocks', ['userId', 'postId', 'expiresAt'], {
            name: 'IX_CompetitionUnlocks_User_Post'
        });

        await queryInterface.createTable('PaymentOrders', {
            id,
            orderCode: { allowNull: false, type: Sequelize.STRING(64) },
            provider: { allowNull: false, type: Sequelize.STRING(20) },
            purpose: { allowNull: false, type: Sequelize.STRING(30) },
            userId: {
                allowNull: false, type: Sequelize.INTEGER,
                references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'
            },
            companyId: {
                allowNull: true, type: Sequelize.INTEGER,
                references: { model: 'Companies', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'
            },
            itemCode: { allowNull: false, type: Sequelize.STRING(40) },
            itemName: Sequelize.STRING(191),
            quantity: { allowNull: false, type: Sequelize.INTEGER, defaultValue: 1 },
            unitPrice: { allowNull: false, type: Sequelize.DECIMAL(12, 2), defaultValue: 0 },
            originalAmount: { allowNull: false, type: Sequelize.INTEGER },
            discountAmount: { allowNull: false, type: Sequelize.INTEGER, defaultValue: 0 },
            amount: { allowNull: false, type: Sequelize.INTEGER },
            promoCode: Sequelize.STRING(40),
            currency: { allowNull: false, type: Sequelize.STRING(3), defaultValue: 'VND' },
            providerAmount: { allowNull: false, type: Sequelize.DECIMAL(14, 2) },
            points: { allowNull: false, type: Sequelize.INTEGER, defaultValue: 0 },
            entitlementType: Sequelize.STRING(30),
            entitlementAmount: { allowNull: false, type: Sequelize.INTEGER, defaultValue: 0 },
            status: { allowNull: false, type: Sequelize.STRING(20), defaultValue: 'PENDING' },
            providerRef: Sequelize.STRING(191),
            providerTransId: Sequelize.STRING(191),
            failureReason: Sequelize.STRING(255),
            simulated: { allowNull: false, type: Sequelize.BOOLEAN, defaultValue: false },
            paidAt: Sequelize.DATE,
            expiresAt: { allowNull: false, type: Sequelize.DATE },
            ...timestamps(Sequelize)
        });
        await queryInterface.addIndex('PaymentOrders', ['orderCode'], { name: 'UX_PaymentOrders_OrderCode', unique: true });
        await queryInterface.addIndex('PaymentOrders', ['userId', 'createdAt'], { name: 'IX_PaymentOrders_User_Created' });
        await queryInterface.addIndex('PaymentOrders', ['status', 'expiresAt'], { name: 'IX_PaymentOrders_Status_Expiry' });
    },

    down: async (queryInterface) => {
        await queryInterface.dropTable('PaymentOrders');
        await queryInterface.dropTable('CompetitionUnlocks');
        await queryInterface.dropTable('RewardTransactions');
        await queryInterface.dropTable('RewardWallets');
    }
};
