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
    db.ChatAttachment = require('../../src/models/chatattachment')(db.sequelize, DataTypes);
    db.Allcode = require('../../src/models/allcode')(db.sequelize, DataTypes);
    db.DetailPost = require('../../src/models/detailpost')(db.sequelize, DataTypes);
    db.Post = require('../../src/models/post')(db.sequelize, DataTypes);
    db.Post.belongsTo(db.User, { foreignKey: 'userId', as: 'userPostData' });
    db.Post.belongsTo(db.DetailPost, { foreignKey: 'detailPostId', as: 'postDetailData' });
    for (const [foreignKey, as] of [['salaryJobCode', 'salaryTypePostData'], ['experienceJobCode', 'expTypePostData'],
        ['addressCode', 'provincePostData'], ['categoryWorktypeCode', 'workTypePostData']]) {
        db.DetailPost.belongsTo(db.Allcode, { foreignKey, targetKey: 'code', as });
    }
    db.RealtimePresence = require('../../src/models/realtimePresence')(db.sequelize, DataTypes);
    db.AuthSession = require('../../src/models/authSession')(db.sequelize, DataTypes);
    db.AuthSession.associate(db);
    db.WebPushSubscription = require('../../src/models/webPushSubscription')(db.sequelize,DataTypes);
    db.WebPushDelivery = require('../../src/models/webPushDelivery')(db.sequelize,DataTypes);
    db.Notification = require('../../src/models/notification')(db.sequelize,DataTypes);
    // Use the real service/controller with explicitly isolated fixture models.
    // Never import the project's database configuration or .env credentials.
    const modelPath = require.resolve('../../src/models/index');
    require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: db };
    return db;
};
