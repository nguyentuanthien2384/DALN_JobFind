'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('FollowCompanies', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER,
            },
            userId: {
                type: Sequelize.INTEGER
            },
            companyId: {
                type: Sequelize.INTEGER
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
        await queryInterface.addIndex('FollowCompanies', ['userId', 'companyId'], {
            unique: true,
            name: 'followcompanies_userid_companyid_unique'
        });
    },
    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('FollowCompanies');
    }
};
