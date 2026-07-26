'use strict';
const {
    Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
    class ChatMessage extends Model {
        static associate(models) {
            ChatMessage.belongsTo(models.User, { foreignKey: 'senderId', targetKey: 'id', as: 'senderData' })
            ChatMessage.belongsTo(models.User, { foreignKey: 'receiverId', targetKey: 'id', as: 'receiverData' })
        }
    };
    ChatMessage.init({
        senderId: DataTypes.INTEGER,
        receiverId: DataTypes.INTEGER,
        content: DataTypes.TEXT,
        isRead: DataTypes.TINYINT
    },
    {
        sequelize,
        modelName: 'ChatMessage',
    });
    return ChatMessage;
};
