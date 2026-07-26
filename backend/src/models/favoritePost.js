'use strict';
const {
    Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
    class FavoritePost extends Model {
        static associate(models) {
            // Post
            FavoritePost.belongsTo(models.Post, { foreignKey: 'postId', targetKey: 'id', as: 'postFavoriteData' })
            // User
            FavoritePost.belongsTo(models.User, { foreignKey: 'userId', targetKey: 'id', as: 'userFavoriteData' })
        }
    };
    FavoritePost.init({
        userId: DataTypes.INTEGER,
        postId: DataTypes.INTEGER
    },
    {
        sequelize,
        modelName: 'FavoritePost',
    });
    return FavoritePost;
};
