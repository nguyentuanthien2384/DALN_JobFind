// Read-only verification against the configured development database.
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
require('@babel/register')({ babelrc: false, configFile: false, ignore: [/node_modules/], presets: [require.resolve('@babel/preset-env')] });
const db = require('../src/models');
db.sequelize.options.logging = false;
const { getNotificationByUser } = require('../src/services/notificationService');
const { getNotificationJobs } = require('../src/services/notificationJobService');
const userId = Number(process.env.NOTIFICATION_TEST_USER_ID || 5);

(async () => {
    assert.ok(Number.isSafeInteger(userId) && userId > 0);
    try {
        const original = await db.Notification.findAll({ where: { userId }, raw: true });
        const notices = await getNotificationByUser({ userId, limit: 100, offset: 0 });
        assert.equal(notices.errCode, 0);
        assert.ok(Array.isArray(notices.data));
        const legacyDestinations = {
            'Công ty bạn theo dõi vừa đăng tin tuyển dụng mới': '/candidate/followed-jobs',
            'Có 2 việc làm mới phù hợp với kỹ năng của bạn': '/candidate/recommended-jobs',
        };
        for (const row of notices.data) {
            const stored = original.find(item => item.id === row.id);
            assert.ok(stored);
            assert.equal(row.isChecked, stored.isChecked);
            assert.equal(row.userId, stored.userId);
            const legacyLink = userId === 5 && stored.typeCode === 'NEW_POST' && stored.link === '/job'
                ? legacyDestinations[stored.content] : undefined;
            assert.equal(row.link, legacyLink || stored.link);
        }
        const follows = await db.FollowCompany.findAll({ where: { userId }, raw: true });
        for (const source of ['followed', 'recommended']) {
            const result = await getNotificationJobs({ userId, source, limit: 10, offset: 0 });
            assert.equal(result.errCode, 0);
            assert.ok(Number.isInteger(result.count));
            for (const row of result.data) {
                assert.equal(row.statusCode, 'PS1');
                assert.ok(Number(row.timeEnd) > Date.now());
                if (source === 'followed') assert.ok(follows.some(item => item.companyId === row.userPostData.userCompanyData.id));
                else assert.ok(row.matchScore > 0);
            }
            console.log(JSON.stringify({ source, count: result.count, returned: result.data.length, result: 'PASS' }));
        }
        assert.deepEqual(await db.Notification.findAll({ where: { userId }, raw: true }), original);
        console.log('PASS live notification normalization and collection queries; no rows changed');
    } finally { await db.sequelize.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
