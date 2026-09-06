import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Receives ONLY the owned synthetic MySQL/HTTP fixture; no real DB or providers.
export const runLegacyCreateRequestChecks = async ({ pool, check, core, legacyCreateHttp, counts, balance, waitForRowWait }) => {
    const deadline = String(Date.now() + 86400000);
    const create = (key, patch = {}) => legacyCreateHttp({ key, timeEnd: deadline, ...patch });
    const quota = (n = 30) => pool.query('UPDATE companies SET allowPost = ?, allowHotPost = ? WHERE id = 3', [n, n]);
    const keyCount = async () => (await pool.query('SELECT COUNT(*) AS n FROM job_request_keys'))[0][0].n;
    const snapshot = async () => ({ counts: await counts(), quota: await balance(), keys: await keyCount() });
    const replay = (r, first) => {
        assert.equal(r.status, 200); assert.deepEqual(r.body, { ...first.body, replayed: true });
    };
    for (const hot of [0, 1]) await check(`legacy keyed create: 20 concurrent requests spend the last ${hot ? 'hot' : 'normal'} slot once`, async () => {
        await quota(1); const before = await snapshot(), key = randomUUID();
        const results = await Promise.all(Array.from({ length: 20 }, () => create(key, { isHot: hot })));
        assert.ok(results.every(r => r.status === 200 && r.body.errCode === 0), JSON.stringify(results));
        assert.equal(new Set(results.map(r => r.body.postId)).size, 1);
        assert.equal(results.filter(r => r.body.replayed === false).length, 1);
        assert.equal(results.filter(r => r.body.replayed === true).length, 19);
        assert.ok(results.every(r => r.body.idempotencyKey === key));
        assert.deepEqual(await counts(), before.counts.map((n, i) => n + (i < 3 ? 1 : 0)));
        assert.deepEqual(await balance(), hot ? [1, 0] : [0, 1]); assert.equal(await keyCount(), before.keys + 1);
        const [[row]] = await pool.query('SELECT * FROM job_request_keys WHERE userId = 7 AND requestKey = ?', [key]);
        assert.equal(row.operation, 'legacy-create'); assert.equal(row.companyId, 3);
        assert.deepEqual(JSON.parse(row.responseJson), results.find(r => !r.body.replayed).body);
    });
    await check('legacy keyed create recovers a lost HTTP response with the same charged post and stable event', async () => {
        await quota(1); const key = randomUUID(), before = await snapshot();
        await assert.rejects(create(key, { drop: true }), /fetch failed|socket|other side closed/i);
        const committed = await snapshot(), r = await create(key);
        assert.equal(r.body.errCode, 0); assert.equal(r.body.replayed, true); assert.deepEqual(await snapshot(), committed);
        assert.deepEqual(committed.counts, before.counts.map((n, i) => n + (i < 3 ? 1 : 0)));
        const [events] = await pool.query('SELECT * FROM outbox_events WHERE aggregateId = ?', [String(r.body.postId)]);
        assert.equal(events.length, 1); await create(key);
        assert.deepEqual((await pool.query('SELECT * FROM outbox_events WHERE aggregateId = ?', [String(r.body.postId)]))[0], events);
    });
    await check('legacy create canonicalizes number/string intent and ignores spoofed identity; changed fields conflict', async () => {
        await quota(); const key = randomUUID(), first = await create(key), before = await snapshot();
        replay(await create(key, { amount: '1', isHot: false, timeEnd: Number(deadline), userId: 123, companyId: 999, statusCode: 'PS4' }), first);
        for (const patch of [{ name: 'Different' }, { amount: 2 }, { timeEnd: String(Number(deadline) + 1) },
            { descriptionMarkdown: 'Other' }, { isHot: 1 }, { categoryJobCode: 'X' }]) {
            const r = await create(key, patch); assert.equal(r.status, 409); assert.equal(r.body.conflict, true);
        }
        assert.deepEqual(await snapshot(), before);
    });
    await check('legacy/Core operation collision rejects both directions without a second charge', async () => {
        await quota(); const legacyKey = randomUUID(), coreKey = randomUUID();
        assert.equal((await create(legacyKey)).body.errCode, 0);
        assert.equal((await core(0, 7, { 'idempotency-key': coreKey }, { timeEnd: deadline })).status, 201);
        const before = await snapshot();
        assert.equal((await create(coreKey)).status, 409);
        assert.equal((await core(0, 7, { 'idempotency-key': legacyKey }, { timeEnd: deadline })).status, 409);
        assert.deepEqual(await snapshot(), before);
    });
    await check('legacy accepted receipt replays after deadline but new expired request rolls back its claim', async () => {
        await quota(); const key = randomUUID(), timeEnd = String(Date.now() + 1200), first = await create(key, { timeEnd });
        assert.equal(first.body.errCode, 0); await delay(Math.max(0, Number(timeEnd) - Date.now() + 10));
        const before = await snapshot(); replay(await create(key, { timeEnd }), first);
        assert.equal((await create(randomUUID(), { timeEnd })).status, 400); assert.deepEqual(await snapshot(), before);
    });
    for (const problem of ['missing', 'MyISAM']) await check(`legacy keyed create fails closed for ${problem} ledger`, async () => {
        await quota(); const before = await snapshot();
        await pool.query(problem === 'missing' ? 'RENAME TABLE job_request_keys TO held_legacy_keys' : 'ALTER TABLE job_request_keys ENGINE=MyISAM');
        try { const r = await create(randomUUID()); assert.equal(r.status, 503); assert.equal(r.body.postId, undefined); }
        finally { await pool.query(problem === 'missing' ? 'RENAME TABLE held_legacy_keys TO job_request_keys' : 'ALTER TABLE job_request_keys ENGINE=InnoDB'); }
        assert.deepEqual(await snapshot(), before);
    });
    for (const table of ['companies', 'detailposts', 'posts', 'outbox_events', 'job_request_keys']) await check(`legacy request rolls back ledger/quota/job/event on ${table} failure, then accepts same key`, async () => {
        await quota(); const before = await snapshot(), key = randomUUID();
        await pool.query(`CREATE TRIGGER fail_legacy_request AFTER ${['companies', 'job_request_keys'].includes(table) ? 'UPDATE' : 'INSERT'} ON ${table}
            FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic keyed rollback'`);
        try { const r = await create(key); assert.equal(r.body.errCode, -1); assert.deepEqual(await snapshot(), before); }
        finally { await pool.query('DROP TRIGGER fail_legacy_request'); }
        const r = await create(key); assert.equal(r.body.errCode, 0); assert.equal(r.body.replayed, false);
    });
    for (const problem of ['missing-primary', 'case-insensitive']) await check(`legacy keyed request rejects ${problem} schema without silently repairing it`, async () => {
        await quota(); const before = await snapshot();
        await pool.query('RENAME TABLE job_request_keys TO held_legacy_schema');
        try {
            await pool.query('CREATE TABLE job_request_keys LIKE held_legacy_schema');
            await pool.query(problem === 'missing-primary' ? 'ALTER TABLE job_request_keys DROP PRIMARY KEY'
                : 'ALTER TABLE job_request_keys MODIFY requestKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL');
            assert.equal((await create(randomUUID())).status, 503);
            assert.equal(await keyCount(), 0);
        } finally {
            await pool.query('DROP TABLE job_request_keys');
            await pool.query('RENAME TABLE held_legacy_schema TO job_request_keys');
        }
        assert.deepEqual(await snapshot(), before);
    });
    for (const patch of [{ statusCode: 'S2' }, { censorCode: 'CS2' }]) await check(`legacy replay rechecks company ${Object.keys(patch)[0]} without another charge`, async () => {
        await quota(); const key = randomUUID(), first = await create(key), before = await snapshot();
        const field = Object.keys(patch)[0]; await pool.query(`UPDATE companies SET ${field} = ? WHERE id = 3`, [patch[field]]);
        try { assert.equal((await create(key)).body.errCode, 2); assert.deepEqual(await snapshot(), before); }
        finally { await pool.query(`UPDATE companies SET ${field} = ? WHERE id = 3`, [field === 'statusCode' ? 'S1' : 'CS1']); }
        replay(await create(key), first);
    });
    await check('legacy replay rechecks membership after waiting for actor lock and cannot charge the new company', async () => {
        await quota(); const key = randomUUID(); await create(key); const before = await snapshot();
        const conn = await pool.getConnection(); let pending;
        try {
            await conn.beginTransaction(); await conn.query('SELECT id FROM users WHERE id = 7 FOR UPDATE');
            pending = create(key); await waitForRowWait();
            await conn.query('UPDATE users SET companyId = 4 WHERE id = 7'); await conn.commit();
            const r = await pending; assert.equal(r.status, 403); assert.deepEqual(await snapshot(), before);
        } finally { await conn.rollback(); conn.release(); await pending; await pool.query('UPDATE users SET companyId = 3 WHERE id = 7'); }
    });
    for (const statusCode of ['PS1', 'PS2', 'PS4']) await check(`legacy replay returns only original receipt after moderation ${statusCode}`, async () => {
        await quota(); const key = randomUUID(), first = await create(key);
        await pool.query('UPDATE posts SET statusCode = ? WHERE id = ?', [statusCode, first.body.postId]);
        const before = await snapshot(); replay(await create(key), first); assert.deepEqual(await snapshot(), before);
        assert.equal((await pool.query('SELECT statusCode FROM posts WHERE id = ?', [first.body.postId]))[0][0].statusCode, statusCode);
    });
    for (const problem of ['deleted', 'reassigned', 'corrupt-receipt']) await check(`legacy replay fails closed for ${problem} post/receipt without recreation`, async () => {
        await quota(); const key = randomUUID(), first = await create(key);
        if (problem === 'deleted') await pool.query('DELETE FROM posts WHERE id = ?', [first.body.postId]);
        if (problem === 'reassigned') await pool.query('UPDATE posts SET userId = 8 WHERE id = ?', [first.body.postId]);
        if (problem === 'corrupt-receipt') await pool.query("UPDATE job_request_keys SET responseJson = '{}' WHERE userId = 7 AND requestKey = ?", [key]);
        const before = await snapshot(); assert.equal((await create(key)).status, 409); assert.deepEqual(await snapshot(), before);
    });
    await check('legacy malformed key/payload cannot claim quota; distinct case-sensitive keys create distinct intents', async () => {
        await quota(); const before = await snapshot();
        for (const key of ['', 'bad key', 'x'.repeat(129)]) assert.equal((await create(key)).status, 400);
        for (const patch of [{ amount: true }, { amount: -1 }, { name: {} }, { timeEnd: 'not-a-date' }, { timeEnd: '9000000000000000' }]) {
            assert.equal((await create(randomUUID(), patch)).status, 400);
        }
        assert.deepEqual(await snapshot(), before);
        const key = randomUUID(), a = await create('a-' + key), b = await create('A-' + key);
        assert.equal(a.body.errCode, 0); assert.equal(b.body.errCode, 0); assert.notEqual(a.body.postId, b.body.postId);
    });
};
