'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('CandidateViews', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            companyId: {
                allowNull: false,
                type: Sequelize.INTEGER,
                references: {
                    model: 'Companies',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            candidateId: {
                allowNull: false,
                type: Sequelize.INTEGER,
                references: {
                    model: 'Users',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            allowanceType: {
                allowNull: false,
                type: Sequelize.ENUM('FREE', 'PAID')
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

        await queryInterface.addConstraint('CandidateViews', {
            fields: ['companyId', 'candidateId'],
            type: 'unique',
            name: 'candidate_views_company_candidate_unique'
        });
        await queryInterface.addIndex('CandidateViews', ['candidateId'], {
            name: 'candidate_views_candidate_idx'
        });
    },

    down: async (queryInterface) => {
        await queryInterface.dropTable('CandidateViews');
    }
};
