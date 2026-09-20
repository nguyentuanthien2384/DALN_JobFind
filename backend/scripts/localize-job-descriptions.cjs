// Dry run by default; --apply writes an original-content backup before committing.
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const mysql = require('mysql2/promise');
const { localizeJobContent } = require('./data/localize-job-content.cjs');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

async function main() {
    const apply = process.argv.includes('--apply');
    const { serializeEventPayload } = await import(pathToFileURL(path.join(__dirname, '../../microservices/shared/eventContract.js')));
    const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME });
    try {
        await db.beginTransaction();
        const [rows] = await db.query('SELECT * FROM detailposts ORDER BY id FOR UPDATE');
        const changes = rows.map(before => ({ before, after: localizeJobContent(before) }))
            .filter(({ before, after }) => Object.keys(after).some(key => before[key] !== after[key]));
        console.log(JSON.stringify({ apply, changes: changes.map(({ before, after }) => ({ id: before.id, name: after.name })) }, null, 2));
        if (!apply || !changes.length) { await db.rollback(); return; }
        const [engines] = await db.query("SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('detailposts','posts','outbox_events')");
        if (engines.length !== 3 || engines.some(row => row.ENGINE !== 'InnoDB')) throw new Error('Cần các bảng InnoDB và outbox để cập nhật đồng bộ.');
        const backup = path.join(__dirname, '../../.local/backups', `job-vietnamese-${Date.now()}.json`);
        await fs.mkdir(path.dirname(backup), { recursive: true });
        await fs.writeFile(backup, JSON.stringify(changes.map(({ before }) => before), null, 2), { flag: 'wx' });
        let eventCount = 0;
        for (const { before, after } of changes) {
            await db.query('UPDATE detailposts SET name=?, descriptionHTML=?, descriptionMarkdown=? WHERE id=?',
                [after.name, after.descriptionHTML, after.descriptionMarkdown, before.id]);
            const [posts] = await db.query('SELECT * FROM posts WHERE detailPostId=? FOR UPDATE', [before.id]);
            for (const post of posts) {
                const [[company]] = await db.query(`SELECT c.id AS companyId, c.name AS companyName, c.thumbnail AS companyLogo,
                    c.statusCode AS companyStatusCode, c.censorCode AS companyCensorCode
                    FROM users u LEFT JOIN companies c ON c.id=u.companyId WHERE u.id=?`, [post.userId]);
                const job = { ...company };
                for (const key of ['id', 'statusCode', 'timePost', 'timeEnd', 'isHot', 'userId']) job[key] = post[key] ?? null;
                const detail = { ...before, ...after };
                for (const key of ['name', 'descriptionHTML', 'descriptionMarkdown', 'amount', 'categoryJobCode', 'addressCode',
                    'salaryJobCode', 'categoryJoblevelCode', 'categoryWorktypeCode', 'experienceJobCode', 'genderPostCode']) job[key] = detail[key] ?? null;
                const { json, aggregateId } = serializeEventPayload('job.updated', { job }, { aggregateId: post.id });
                await db.query(`INSERT INTO outbox_events (id,aggregateType,aggregateId,eventType,payload,createdAt)
                    VALUES (?, 'legacy-job', ?, 'job.updated', ?, NOW(3))`, [randomUUID(), aggregateId, json]);
                eventCount++;
            }
        }
        await db.commit();
        console.log(JSON.stringify({ updated: changes.length, events: eventCount, backup }));
    } catch (error) {
        await db.rollback();
        throw error;
    } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
