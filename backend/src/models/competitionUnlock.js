'use strict';
const { Model } = require('sequelize');

// Ung vien da dung diem mo khoa bao cao canh tranh cua mot tin tuyen dung.
module.exports = (sequelize, DataTypes) => {
    class CompetitionUnlock extends Model {
        static associate(models) {
            CompetitionUnlock.belongsTo(models.User, { foreignKey: 'userId', targetKey: 'id', as: 'unlockUserData' });
            CompetitionUnlock.belongsTo(models.Post, { foreignKey: 'postId', targetKey: 'id', as: 'unlockPostData' });
        }
    }

    CompetitionUnlock.init({
        userId: { type: DataTypes.INTEGER, allowNull: false },
        postId: { type: DataTypes.INTEGER, allowNull: false },
        transactionId: DataTypes.INTEGER,
        pointsSpent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        expiresAt: { type: DataTypes.DATE, allowNull: false }
    }, {
        sequelize,
        modelName: 'CompetitionUnlock',
        indexes: [{ fields: ['userId', 'postId', 'expiresAt'] }]
    });

    return CompetitionUnlock;
};
