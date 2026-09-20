'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
    class ChatAttachment extends Model { static associate() {} }
    ChatAttachment.init({
        id: { type: DataTypes.UUID, primaryKey: true }, senderId: DataTypes.INTEGER, receiverId: DataTypes.INTEGER,
        name: DataTypes.STRING(255), mimeType: DataTypes.STRING(64), size: DataTypes.INTEGER, pageCount: DataTypes.INTEGER,
        sha256: DataTypes.STRING(64), bytes: DataTypes.BLOB('long'),
    }, { sequelize, modelName: 'ChatAttachment', defaultScope: { attributes: { exclude: ['bytes'] } } });
    return ChatAttachment;
};
