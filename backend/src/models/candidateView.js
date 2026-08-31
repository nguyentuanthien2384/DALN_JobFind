'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class CandidateView extends Model {
        static associate(models) {
            CandidateView.belongsTo(models.Company, {
                foreignKey: 'companyId',
                targetKey: 'id',
                as: 'candidateViewCompanyData'
            });
            CandidateView.belongsTo(models.User, {
                foreignKey: 'candidateId',
                targetKey: 'id',
                as: 'candidateViewCandidateData'
            });
        }
    }

    CandidateView.init({
        companyId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        candidateId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        allowanceType: {
            type: DataTypes.ENUM('FREE', 'PAID'),
            allowNull: false
        }
    }, {
        sequelize,
        modelName: 'CandidateView',
        indexes: [
            {
                unique: true,
                fields: ['companyId', 'candidateId'],
                name: 'candidate_views_company_candidate_unique'
            },
            {
                fields: ['candidateId'],
                name: 'candidate_views_candidate_idx'
            }
        ]
    });

    return CandidateView;
};
