'use strict';
module.exports = (sequelize, DataTypes) => {
  const AuthIdentity = sequelize.define('AuthIdentity', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    provider: { type: DataTypes.STRING(40), allowNull: false },
    issuer: { type: DataTypes.STRING(255), allowNull: false },
    subject: { type: DataTypes.STRING(255), allowNull: false },
    emailAtLink: DataTypes.STRING(254),
    emailVerifiedAtLink: DataTypes.BOOLEAN,
    displayNameAtLink: DataTypes.STRING(120),
    lastLoginAt: DataTypes.DATE,
  }, { tableName: 'AuthIdentities', timestamps: true, indexes: [{ unique: true, fields: ['issuer', 'subject'] }] });
  AuthIdentity.associate = (db) => { AuthIdentity.belongsTo(db.User, { foreignKey: 'userId' }); };
  return AuthIdentity;
};
