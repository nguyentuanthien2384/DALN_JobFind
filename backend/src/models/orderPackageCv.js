'use strict';
const {
    Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
    class OrderPackageCV extends Model {
        /**
         * Helper method for defining associations.
         * This method is not a part of Sequelize lifecycle.
         * The `models/index` file will call this method automatically.
         */
        static associate(models) {
           //User
           OrderPackageCV.belongsTo(models.User,{foreignKey:'userId',targetKey:'id',as: 'userOrderCvData'})

           //PackageCv
           OrderPackageCV.belongsTo(models.PackageCv, {foreignKey: 'packageCvId',targetKey:'id',as:'packageOrderCvData'})

           OrderPackageCV.belongsTo(models.PaymentIntent, {foreignKey: 'paymentIntentId',targetKey:'id',as:'paymentIntentData'})

        }
    };
    OrderPackageCV.init({
        packageCvId: DataTypes.INTEGER,
        userId: DataTypes.INTEGER,
        currentPrice: DataTypes.DOUBLE,
        amount: DataTypes.INTEGER,
        paymentIntentId: {
            type: DataTypes.INTEGER,
            unique: true
        }
    }, 
    {
        sequelize,
        modelName: 'OrderPackageCV',
    });
    return OrderPackageCV;
};
