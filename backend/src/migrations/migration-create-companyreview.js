'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('CompanyReviews', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER,
            },
            companyId: {
                type: Sequelize.INTEGER
            },
            userId: {
                type: Sequelize.INTEGER
            },
            star: {
                type: Sequelize.INTEGER
            },
            content: {
                type: Sequelize.TEXT
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
        await queryInterface.addIndex('CompanyReviews', ['companyId', 'userId'], {
            unique: true,
            name: 'companyreviews_companyid_userid_unique'
        });
    },
    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('CompanyReviews');
    }
};
