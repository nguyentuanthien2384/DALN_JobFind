'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('FavoritePosts', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER,
            },
            userId: {
                type: Sequelize.INTEGER
            },
            postId: {
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
        await queryInterface.addIndex('FavoritePosts', ['userId', 'postId'], {
            unique: true,
            name: 'favoriteposts_userid_postid_unique'
        });
    },
    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('FavoritePosts');
    }
};
