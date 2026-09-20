// Read-only integration check against the configured MySQL database.
const assert = require('node:assert/strict');
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
require('dotenv').config();
require('@babel/register')({ presets: [[require.resolve('@babel/preset-env'), { targets: { node: 'current' } }]], babelrc: false, configFile: false });
const db = require('../src/models');
const service = require('../src/services/postService');

(async () => {
    try {
        const companies = await db.sequelize.query('SELECT DISTINCT companyId FROM users WHERE companyId IS NOT NULL LIMIT 5', { type: db.Sequelize.QueryTypes.SELECT });
        const scopes = [undefined, ...companies.map(row => row.companyId), -1];
        for (const companyId of scopes) {
            const result = await service.getStatisticalTypePost({ limit: 4, companyId });
            const [expected] = await db.sequelize.query(`SELECT COUNT(*) AS total FROM posts p
                ${companyId ? 'INNER JOIN users u ON u.id = p.userId' : ''}
                WHERE p.statusCode = 'PS1' ${companyId ? 'AND u.companyId = :companyId' : ''}`, {
                replacements: { companyId }, type: db.Sequelize.QueryTypes.SELECT
            });
            assert.equal(result.errCode, 0);
            assert.equal(result.totalPost, Number(expected.total));
            assert.ok(result.data.length <= 4);
            for (const row of result.data) {
                assert.ok(Number(row.amount) > 0);
                assert.equal(typeof row.postDetailData.jobTypePostData.value, 'string');
            }
            console.log(`PASS ${companyId === undefined ? 'platform' : companyId === -1 ? 'empty company' : 'company'}: total=${result.totalPost}, categories=${result.data.length}`);
        }
    } finally { await db.sequelize.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
