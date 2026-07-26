'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('ChatMessages', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER,
            },
            senderId: {
                type: Sequelize.INTEGER
            },
            receiverId: {
                type: Sequelize.INTEGER
            },
            content: {
                type: Sequelize.TEXT
            },
            isRead: {
                type: Sequelize.TINYINT,
                defaultValue: 0
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });
        await queryInterface.addIndex('ChatMessages', ['senderId', 'receiverId'], {
            name: 'chatmessages_sender_receiver_idx'
        });
    },
    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('ChatMessages');
    }
};
