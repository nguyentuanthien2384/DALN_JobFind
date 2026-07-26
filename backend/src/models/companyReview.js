'use strict';
const {
    Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
    class CompanyReview extends Model {
        static associate(models) {
            // Company
            CompanyReview.belongsTo(models.Company, { foreignKey: 'companyId', targetKey: 'id', as: 'companyReviewData' })
            // User
            CompanyReview.belongsTo(models.User, { foreignKey: 'userId', targetKey: 'id', as: 'userReviewData' })
        }
    };
    CompanyReview.init({
        companyId: DataTypes.INTEGER,
        userId: DataTypes.INTEGER,
        star: DataTypes.INTEGER,
        content: DataTypes.TEXT
    },
    {
        sequelize,
        modelName: 'CompanyReview',
    });
    return CompanyReview;
};
