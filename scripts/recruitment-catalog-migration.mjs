import { randomUUID } from 'node:crypto';
import catalog from '../microservices/shared/recruitmentCatalog.cjs';
import { serializeEventPayload } from '../microservices/shared/eventContract.js';

const { PROVINCES, JOB_LEVELS, normalizeProvinceCode } = catalog;
export function catalogPlan(rows) {
    const byCode = new Map(rows.map(row => [row.code, row]));
    const desired = [
        ...PROVINCES.map(({ code, value }) => ({ code, value, type: 'PROVINCE' })),
        ...JOB_LEVELS.map(({ code, value }) => ({ code, value, type: 'JOBLEVEL' }))
    ];
    const insert = [], update = [], archive = [];
    for (const row of desired) {
        const before = byCode.get(row.code);
        if (!before) insert.push(row);
        else {
            if (before.type !== row.type && !(row.type === 'PROVINCE' && before.type === 'PROVINCE_LEGACY')) {
                throw new Error(`Mã ${row.code} đang thuộc ${before.type}; chưa cập nhật dữ liệu.`);
            }
            if (before.type !== row.type || before.value !== row.value) update.push({ before, after: row });
        }
    }
    const currentCodes = new Set(PROVINCES.map(row => row.code));
    for (const row of rows.filter(row => row.type === 'PROVINCE' && !currentCodes.has(row.code))) {
        const target = normalizeProvinceCode(row.code);
        if (!currentCodes.has(target)) throw new Error(`Chưa xác định được tỉnh mới cho mã ${row.code}; cần đối chiếu trước khi cập nhật.`);
        archive.push({ before: row, target });
    }
    return { insert, update, archive };
}

export const provinceChanges = rows => rows.flatMap(row => {
    const addressCode = normalizeProvinceCode(row.addressCode);
    return addressCode === row.addressCode ? [] : [{ id: row.id, before: row.addressCode, after: addressCode }];
});

// Caller provides a backup writer; it must finish before the first data write.
// No primary keys, user content, quotas or job statuses are removed or reset.
export async function migrateRecruitmentCatalog(db, { apply = false, saveBackup, serialize = serializeEventPayload } = {}) {
    await db.beginTransaction();
    try {
        const [engines] = await db.query(`SELECT LOWER(TABLE_NAME) AS name, ENGINE AS engine FROM information_schema.TABLES
            WHERE TABLE_SCHEMA=DATABASE() AND LOWER(TABLE_NAME) IN ('allcodes','detailposts','usersettings','posts','outbox_events')`);
        if (engines.length !== 5 || engines.some(row => row.engine !== 'InnoDB')) {
            throw new Error('Cần đầy đủ bảng danh mục, tin, tùy chọn và outbox dùng InnoDB để cập nhật nguyên tử.');
        }
        const [rows] = await db.query('SELECT code, type, value, image FROM allcodes ORDER BY code FOR UPDATE');
        const plan = catalogPlan(rows);
        const [details] = await db.query('SELECT * FROM detailposts ORDER BY id FOR UPDATE');
        const [settings] = await db.query('SELECT id, addressCode FROM usersettings ORDER BY id FOR UPDATE');
        const jobs = provinceChanges(details), preferences = provinceChanges(settings);
        const summary = { apply, provinces: PROVINCES.length, jobLevels: JOB_LEVELS.length,
            insert: plan.insert.length, update: plan.update.length, archive: plan.archive.length,
            jobLocations: jobs.length, candidateLocations: preferences.length, events: 0 };
        const changed = summary.insert + summary.update + summary.archive + jobs.length + preferences.length;
        if (!apply || !changed) { await db.rollback(); return summary; }
        if (typeof saveBackup !== 'function') throw new Error('Phải lưu bản sao trước khi cập nhật danh mục.');
        await saveBackup({ version: 1, createdAt: new Date().toISOString(), allcodes: rows,
            detailposts: jobs, usersettings: preferences });
        for (const row of plan.insert) {
            await db.query('INSERT INTO allcodes (code,type,value,image) VALUES (?,?,?,NULL)', [row.code, row.type, row.value]);
        }
        for (const { after } of plan.update) {
            await db.query('UPDATE allcodes SET type=?, value=? WHERE code=?', [after.type, after.value, after.code]);
        }
        for (const { before } of plan.archive) {
            await db.query("UPDATE allcodes SET type='PROVINCE_LEGACY' WHERE code=?", [before.code]);
        }
        for (const change of preferences) {
            await db.query('UPDATE usersettings SET addressCode=? WHERE id=?', [change.after, change.id]);
        }
        for (const change of jobs) {
            await db.query('UPDATE detailposts SET addressCode=? WHERE id=?', [change.after, change.id]);
            // Build full current job snapshots; consumers use their usual versioned outbox flow.
            const [posts] = await db.query('SELECT * FROM posts WHERE detailPostId=? FOR UPDATE', [change.id]);
            const detail = { ...details.find(row => row.id === change.id), addressCode: change.after };
            for (const post of posts) {
                const [[company]] = await db.query(`SELECT c.id AS companyId, c.name AS companyName, c.thumbnail AS companyLogo,
                    c.statusCode AS companyStatusCode, c.censorCode AS companyCensorCode
                    FROM users u LEFT JOIN companies c ON c.id=u.companyId WHERE u.id=?`, [post.userId]);
                const job = { ...company };
                for (const key of ['id', 'statusCode', 'timePost', 'timeEnd', 'isHot', 'userId']) job[key] = post[key] ?? null;
                for (const key of ['name', 'descriptionHTML', 'descriptionMarkdown', 'amount', 'categoryJobCode', 'addressCode',
                    'salaryJobCode', 'categoryJoblevelCode', 'categoryWorktypeCode', 'experienceJobCode', 'genderPostCode']) job[key] = detail[key] ?? null;
                const { json, aggregateId } = serialize('job.updated', { job }, { aggregateId: post.id });
                await db.query(`INSERT INTO outbox_events (id,aggregateType,aggregateId,eventType,payload,createdAt)
                    VALUES (?, 'legacy-job', ?, 'job.updated', ?, NOW(3))`, [randomUUID(), aggregateId, json]);
                summary.events++;
            }
        }
        await db.commit();
        return summary;
    } catch (error) {
        await db.rollback();
        throw error;
    }
}
