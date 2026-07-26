'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('Notifications', 'content', {
            type: Sequelize.STRING(500)
        });
        await queryInterface.addColumn('Notifications', 'link', {
            type: Sequelize.STRING(255)
        });
    },
    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('Notifications', 'content');
        await queryInterface.removeColumn('Notifications', 'link');
    }
};
