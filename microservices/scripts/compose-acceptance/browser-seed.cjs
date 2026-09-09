// Complete the disposable legacy schema for the real App shell/public readers.
// This is fixture DDL, never a migration of an existing user database.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const backend = createRequire('/backend/package.json');
assert.equal(process.env.DB_HOST, 'mysql'); assert.equal(process.env.DB_NAME, 'acceptance');
backend('dotenv').config = () => ({ parsed: {} });
backend('@babel/register')({ babelrc: false, configFile: false, cache: false,
    only: [file => file.startsWith('/backend/src/')],
    presets: [[backend.resolve('@babel/preset-env'), { targets: { node: 'current' } }]] });
const db = backend('./src/models/index.js');
(async () => {
    const qi = db.sequelize.getQueryInterface();
    for (const model of Object.values(db).filter(value => value?.rawAttributes)) {
        const table = model.getTableName();
        const attributes = Object.fromEntries(Object.entries(model.rawAttributes).map(([key, value]) => {
            const { references, onDelete, onUpdate, ...attribute } = value;
            return [key, attribute];
        }));
        let columns;
        try { columns = await qi.describeTable(table); } catch { columns = null; }
        if (!columns) await qi.createTable(table, attributes, { engine: 'InnoDB' });
        else for (const [key, value] of Object.entries(attributes)) if (!columns[key]) {
            await qi.addColumn(table, key, { ...value, allowNull: true });
        }
    }
    const codes = [ ['IT','JOBTYPE','Công nghệ thông tin'], ['HN','PROVINCE','Hà Nội'], ['SAL1','SALARYTYPE','Thỏa thuận'],
        ['JL1','JOBLEVEL','Nhân viên'], ['WT1','WORKTYPE','Toàn thời gian'], ['EXP1','EXPTYPE','Hai năm'],
        ['G1','GENDERPOST','Không yêu cầu'], ['CANDIDATE','ROLE','Ứng viên'], ['COMPANY','ROLE','Công ty'],
        ['EMPLOYER','ROLE','Nhân viên tuyển dụng'], ['ADMIN','ROLE','Quản trị'], ['S1','STATUS','Hoạt động'] ];
    for (const [code,type,value] of codes) await db.sequelize.query('INSERT INTO allcodes(code,type,value) VALUES(:code,:type,:value)', { replacements: { code,type,value } });
    const password = await backend('bcryptjs').hash(process.env.FIXTURE_PASSWORD, 10);
    await db.sequelize.query("INSERT INTO users(id,firstName,lastName,email) VALUES(18,'Browser','Candidate','browser@example.invalid')");
    await db.sequelize.query("INSERT INTO accounts(userId,roleCode,statusCode,phonenumber,password) VALUES(18,'CANDIDATE','S1','0018',:password)", { replacements: { password } });
    await db.sequelize.query('INSERT INTO usersettings(userId,isFindJob,isTakeMail) VALUES(18,0,0)');
    await db.sequelize.query("UPDATE companies SET address='Hà Nội',website='https://example.invalid',amountEmployer=10,thumbnail='/assets/img/service/1.png',coverimage='/assets/img/hero/h1_hero.jpg' WHERE id=3");
    await db.sequelize.query("UPDATE users SET image='/assetsAdmin/images/faces/face9.jpg' WHERE id IN (10,11,18)");
    console.log('PASS: browser fixture schema, dictionaries and dedicated candidate ready');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.sequelize.close());
