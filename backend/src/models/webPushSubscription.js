module.exports = (sequelize, S) => sequelize.define('WebPushSubscription', {
    id: {type:S.STRING(64),primaryKey:true}, userId:{type:S.INTEGER,allowNull:false},
    generation:{type:S.STRING(36),allowNull:false}, endpoint:{type:S.TEXT,allowNull:false},
    p256dh:{type:S.STRING(100),allowNull:false}, auth:{type:S.STRING(32),allowNull:false},
    expiresAt:{type:S.DATE,allowNull:false},
});
