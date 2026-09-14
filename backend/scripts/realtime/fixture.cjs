const { Sequelize, DataTypes } = require('sequelize');
module.exports = (url) => {
    const db = { sequelize: new Sequelize(url, { logging: false, ...(process.env.CHAT_TEST_DB_TIMEZONE ? {timezone:process.env.CHAT_TEST_DB_TIMEZONE} : {}), pool: { max: 8 } }) };
    db.Account = db.sequelize.define('Account', { userId: DataTypes.INTEGER, roleCode: DataTypes.STRING, statusCode: DataTypes.STRING });
    db.Company = db.sequelize.define('Company', { name: DataTypes.STRING, thumbnail: DataTypes.STRING, statusCode: DataTypes.STRING, censorCode: DataTypes.STRING });
    db.User = db.sequelize.define('User', { companyId: DataTypes.INTEGER, firstName: DataTypes.STRING, lastName: DataTypes.STRING, image: DataTypes.STRING });
    db.Account.belongsTo(db.User, {foreignKey:'userId',as:'userAccountData'});
    db.User.hasOne(db.Account, { foreignKey: 'userId', as: 'userAccountData' });
    db.User.belongsTo(db.Company, { foreignKey: 'companyId', as: 'userCompanyData' });
    db.ChatMessage = require('../../src/models/chatMessage')(db.sequelize, DataTypes);
    db.ChatMessage.associate(db);
    db.RealtimePresence = require('../../src/models/realtimePresence')(db.sequelize, DataTypes);
    db.WebPushSubscription = require('../../src/models/webPushSubscription')(db.sequelize,DataTypes);
    db.WebPushDelivery = require('../../src/models/webPushDelivery')(db.sequelize,DataTypes);
    // Use the real service/controller with explicitly isolated fixture models.
    // Never import the project's database configuration or .env credentials.
    const modelPath = require.resolve('../../src/models/index');
    require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: db };
    return db;
};
