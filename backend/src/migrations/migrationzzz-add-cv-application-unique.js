'use strict';

module.exports = {
    up: async (queryInterface) => {
        await queryInterface.addConstraint('Cvs', {
            fields: ['userId', 'postId'],
            type: 'unique',
            name: 'cvs_userid_postid_unique'
        });
    },
    down: async (queryInterface) => {
        await queryInterface.removeConstraint('Cvs', 'cvs_userid_postid_unique');
    }
};
