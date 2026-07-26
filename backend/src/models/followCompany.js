'use strict';
const {
    Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
    class FollowCompany extends Model {
        static associate(models) {
            // Company
            FollowCompany.belongsTo(models.Company, { foreignKey: 'companyId', targetKey: 'id', as: 'companyFollowData' })
            // User
            FollowCompany.belongsTo(models.User, { foreignKey: 'userId', targetKey: 'id', as: 'userFollowData' })
        }
    };
    FollowCompany.init({
        userId: DataTypes.INTEGER,
        companyId: DataTypes.INTEGER
    },
    {
        sequelize,
        modelName: 'FollowCompany',
    });
    return FollowCompany;
};
