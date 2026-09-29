import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import catalog from '../microservices/shared/recruitmentCatalog.cjs';
import { catalogPlan, provinceChanges, migrateRecruitmentCatalog } from './recruitment-catalog-migration.mjs';

const { PROVINCES, JOB_LEVELS, normalizeProvinceCode, provinceFilterCodes } = catalog;
test('official province list has all 34 unique codes and six municipalities', () => {
    assert.equal(PROVINCES.length, 34);
    assert.equal(new Set(PROVINCES.map(p => p.code)).size, 34);
    assert.equal(new Set(PROVINCES.map(p => p.administrativeCode)).size, 34);
    for (const city of ['Hà Nội', 'Hải Phòng', 'Huế', 'Đà Nẵng', 'Hồ Chí Minh', 'Cần Thơ']) {
        assert.ok(PROVINCES.some(p => p.code === city));
    }
    assert.equal(PROVINCES.find(p => p.code === 'Huế').administrativeCode, '46');
    assert.equal(PROVINCES.find(p => p.code === 'Cà Mau').administrativeCode, '96');
});

test('mergers cover old locations without reinterpreting unknown codes or free text', () => {
    for (const province of PROVINCES) {
        assert.equal(normalizeProvinceCode(province.code), province.code);
        for (const previous of province.previousNames) {
            assert.equal(normalizeProvinceCode(previous), province.code);
            assert.ok(provinceFilterCodes(province.code).includes(previous));
        }
    }
    for (const [old, current] of [['Bến Tre', 'Vĩnh Long'], ['Bắc Giang', 'Bắc Ninh'],
        ['Bắc Kạn', 'Thái Nguyên'], ['Bà Rịa – Vũng Tàu', 'Hồ Chí Minh'], ['Long An', 'Tây Ninh'],
        ['Thừa Thiên Huế', 'Huế'], ['TP. Hồ Chí Minh', 'Hồ Chí Minh']]) {
        assert.equal(normalizeProvinceCode(old), current);
    }
    for (const value of [null, undefined, '', 'PROVINCE-1', '12 Nguyễn Huệ, Bến Tre']) {
        assert.equal(normalizeProvinceCode(value), value);
    }
});

test('levels preserve existing job keys and do not collide with internship work type', () => {
    assert.equal(JOB_LEVELS.length, 12);
    assert.equal(new Set(JOB_LEVELS.map(p => p.code)).size, 12);
    assert.ok(!JOB_LEVELS.some(p => p.code === 'thuc-tap'));
    for (const code of ['nhan-vien', 'truong-phong', 'giam-doc']) assert.ok(JOB_LEVELS.some(p => p.code === code));
    assert.throws(() => catalogPlan([{ code: 'thuc-tap-sinh', type: 'WORKTYPE', value: 'Custom' }]), /đang thuộc/);
});

test('migration is additive, preserves custom levels and archives aliases without deleting keys', () => {
    const rows = [{ code: 'Bến Tre', type: 'PROVINCE', value: 'Bến Tre' },
        { code: 'nhan-vien', type: 'JOBLEVEL', value: 'Nhân viên' },
        { code: 'custom-level', type: 'JOBLEVEL', value: 'Custom' }];
    const plan = catalogPlan(rows);
    assert.deepEqual(plan.archive.map(p => [p.before.code, p.target]), [['Bến Tre', 'Vĩnh Long']]);
    assert.ok(!plan.insert.some(row => row.code === 'nhan-vien'));
    assert.ok(!plan.update.some(row => row.before.code === 'custom-level'));
    assert.throws(() => catalogPlan([{ code: 'unknown-province', type: 'PROVINCE' }]), /Chưa xác định/);
    assert.deepEqual(provinceChanges([{ id: 1, addressCode: 'Bến Tre' }, { id: 2, addressCode: 'Hà Nội' },
        { id: 3, addressCode: null }]), [{ id: 1, before: 'Bến Tre', after: 'Vĩnh Long' }]);
});

test('MySQL migration: dry-run, backup gate, atomic rollback, events and idempotence', {
    skip: process.env.TEST_CATALOG_MYSQL !== '1'
}, async () => {
    const require = createRequire(new URL('../backend/package.json', import.meta.url));
    const env = require('dotenv').parse(await fs.readFile(new URL('../backend/.env', import.meta.url)));
    const db = await require('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
        user: env.DB_USER, password: env.DB_PASSWORD || '' });
    const database = 'jobfind_catalog_test_' + randomUUID().replaceAll('-', '');
    try {
        await db.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await db.query(`USE \`${database}\``);
        await db.query('CREATE TABLE allcodes (code VARCHAR(100) PRIMARY KEY, type VARCHAR(30), value VARCHAR(100), image TEXT) ENGINE=InnoDB');
        await db.query('CREATE TABLE detailposts (id INT PRIMARY KEY, name VARCHAR(255), addressCode VARCHAR(100), categoryJoblevelCode VARCHAR(100), descriptionHTML TEXT, FOREIGN KEY (addressCode) REFERENCES allcodes(code)) ENGINE=InnoDB');
        await db.query('CREATE TABLE usersettings (id INT PRIMARY KEY, addressCode VARCHAR(100), FOREIGN KEY (addressCode) REFERENCES allcodes(code)) ENGINE=InnoDB');
        await db.query('CREATE TABLE posts (id INT PRIMARY KEY, detailPostId INT, userId INT, statusCode VARCHAR(10), timePost VARCHAR(30), timeEnd VARCHAR(30), isHot INT) ENGINE=InnoDB');
        await db.query('CREATE TABLE users (id INT PRIMARY KEY, companyId INT) ENGINE=InnoDB');
        await db.query('CREATE TABLE companies (id INT PRIMARY KEY, name VARCHAR(100), thumbnail TEXT, statusCode VARCHAR(10), censorCode VARCHAR(10)) ENGINE=InnoDB');
        await db.query('CREATE TABLE outbox_events (id VARCHAR(36) PRIMARY KEY, aggregateType VARCHAR(50), aggregateId VARCHAR(50), eventType VARCHAR(50), payload LONGTEXT, createdAt DATETIME(3)) ENGINE=InnoDB');
        await db.query("INSERT INTO allcodes(code,type,value) VALUES ('Bến Tre','PROVINCE','Bến Tre'),('nhan-vien','JOBLEVEL','Nhân viên'),('thuc-tap','WORKTYPE','Thực tập')");
        await db.query("INSERT INTO detailposts VALUES (1,'Existing job','Bến Tre','nhan-vien','<p>Keep original content</p>')");
        await db.query("INSERT INTO usersettings VALUES (7,'Bến Tre')");
        await db.query("INSERT INTO posts VALUES (9,1,11,'PS1','1700000000000','1900000000000',0)");
        await db.query("INSERT INTO users VALUES (11,12)");
        await db.query("INSERT INTO companies VALUES (12,'Test company',NULL,'S1','CS1')");
        const before = async () => (await db.query('SELECT addressCode FROM detailposts WHERE id=1'))[0][0].addressCode;
        const count = async table => Number((await db.query(`SELECT COUNT(*) n FROM ${table}`))[0][0].n);
        const preview = await migrateRecruitmentCatalog(db);
        assert.equal(preview.jobLocations, 1);
        assert.equal(await before(), 'Bến Tre');
        assert.equal(await count('allcodes'), 3);
        await assert.rejects(migrateRecruitmentCatalog(db, { apply: true, saveBackup: async () => { throw Error('backup unavailable'); } }), /backup unavailable/);
        assert.equal(await count('allcodes'), 3);
        await assert.rejects(migrateRecruitmentCatalog(db, { apply: true, saveBackup: async () => {}, serialize: () => { throw Error('event invalid'); } }), /event invalid/);
        assert.equal(await before(), 'Bến Tre');
        assert.equal(await count('allcodes'), 3);
        assert.equal(await count('outbox_events'), 0);
        let backup;
        const result = await migrateRecruitmentCatalog(db, { apply: true, saveBackup: async value => { backup = value; } });
        assert.equal(backup.detailposts[0].before, 'Bến Tre');
        assert.equal(result.events, 1);
        assert.equal(await before(), 'Vĩnh Long');
        const [[detail]] = await db.query('SELECT * FROM detailposts WHERE id=1');
        assert.equal(detail.name, 'Existing job');
        assert.equal(detail.descriptionHTML, '<p>Keep original content</p>');
        assert.equal(detail.categoryJoblevelCode, 'nhan-vien');
        assert.equal((await db.query('SELECT statusCode FROM posts WHERE id=9'))[0][0].statusCode, 'PS1');
        assert.equal((await db.query("SELECT type FROM allcodes WHERE code='Bến Tre'"))[0][0].type, 'PROVINCE_LEGACY');
        const [[event]] = await db.query('SELECT payload FROM outbox_events');
        assert.equal(JSON.parse(event.payload).job.addressCode, 'Vĩnh Long');
        const repeated = await migrateRecruitmentCatalog(db, { apply: true });
        assert.equal(repeated.insert + repeated.update + repeated.archive + repeated.jobLocations + repeated.candidateLocations, 0);
        assert.equal(await count('outbox_events'), 1);
        // Validate every legacy spelling against the real DB collation and PK,
        // not only JavaScript string equality, on a separate disposable table.
        await db.query('CREATE TABLE seed_catalog LIKE allcodes');
        await require('./src/seeders/20250101000001-demo-allcodes.js').up({
            bulkInsert: async (_table, rows) => db.query('INSERT INTO seed_catalog (code,type,value,image) VALUES ?',
                [rows.map(row => [row.code, row.type, row.value, row.image])])
        });
        assert.equal(Number((await db.query("SELECT COUNT(*) n FROM seed_catalog WHERE type='PROVINCE'"))[0][0].n), 34);
        assert.equal(Number((await db.query("SELECT COUNT(*) n FROM seed_catalog WHERE type='JOBLEVEL'"))[0][0].n), 12);
    } finally {
        await db.query(`DROP DATABASE IF EXISTS \`${database}\``);
        await db.end();
    }
});
