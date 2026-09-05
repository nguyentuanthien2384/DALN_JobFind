import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const runJobRequestChecks = async ({ pool, check, core, repost, edit, counts, balance, waitForRowWait }) => {
    const key = () => randomUUID();
    const deadline = String(Date.now() + 86400000);
    const create = (k, overrides = {}, userId = 7, headers = {}) => core(0, userId, { 'idempotency-key': k, ...headers }, { timeEnd: deadline, ...overrides });
    const quota = (normal = 20, hot = 20) => pool.query('UPDATE companies SET allowPost = ?, allowHotPost = ? WHERE id = 3', [normal, hot]);
    const keyCount = async () => (await pool.query('SELECT COUNT(*) AS n FROM job_request_keys'))[0][0].n;
    const delta = async before => (await counts()).map((n, i) => n - before[i]);
    const source = async (hot = 0, userId = 8) => {
        await quota();
        const created = await core(hot, userId);
        assert.equal(created.status, 201, JSON.stringify(created.body));
        await pool.query("UPDATE posts SET timeEnd = '1700000000000', statusCode = 'PS1' WHERE id = ?", [created.id]);
        return created.id;
    };

    for (const hot of [0, 1]) {
        await check(`20 identical create requests spend the last ${hot ? 'featured' : 'normal'} slot exactly once`, async () => {
            await quota(1, 1);
            const before = await counts(), keys = await keyCount(), k = key();
            const results = await Promise.all(Array.from({ length: 20 }, () => create(k, { isHot: hot })));
            assert.ok(results.every(r => r.status === 201), JSON.stringify(results));
            assert.ok(results.every(r => JSON.stringify(r.body) === JSON.stringify(results[0].body)));
            assert.deepEqual(await delta(before), [1, 1, 2, 1]);
            assert.deepEqual(await balance(), hot ? [1, 0] : [0, 1]);
            assert.equal(await keyCount(), keys + 1);
        });
    }
    await check('canonical create replay preserves defaults and omitted deadline; changed intent conflicts', async () => {
        await quota();
        const k = key(), initial = await create(k, { timeEnd: undefined });
        assert.equal(initial.status, 201);
        const before = await counts(), balances = await balance();
        const replay = await create(k, { timeEnd: undefined, amount: '1', isHot: false });
        assert.deepEqual(replay.body, initial.body);
        for (const change of [{ name: 'Changed' }, { isHot: 1 }, { timeEnd: deadline }]) {
            assert.equal((await create(k, { timeEnd: undefined, ...change })).status, 409);
        }
        assert.deepEqual(await counts(), before);
        assert.deepEqual(await balance(), balances);
    });
    await check('actual socket loss after commit can be retried without a second charge/post', async () => {
        await quota(1, 1);
        const before = await counts(), k = key();
        await assert.rejects(create(k, {}, 7, { 'x-test-drop-response': '1' }), /fetch failed/);
        const replay = await create(k);
        assert.equal(replay.status, 201, JSON.stringify(replay));
        assert.deepEqual(await delta(before), [1, 1, 2, 1]);
        assert.deepEqual(await balance(), [0, 1]);
    });
    await check('an accepted create can be replayed after its deadline; a new expired intent is rejected without claiming', async () => {
        await quota();
        const k = key(), timeEnd = String(Date.now() + 1500), initial = await create(k, { timeEnd });
        assert.equal(initial.status, 201);
        await delay(Math.max(0, Number(timeEnd) - Date.now() + 10));
        const before = await counts(), keys = await keyCount(), balances = await balance();
        assert.deepEqual((await create(k, { timeEnd })).body, initial.body);
        assert.equal((await create(key(), { timeEnd })).status, 400);
        assert.deepEqual(await counts(), before); assert.equal(await keyCount(), keys);
        assert.deepEqual(await balance(), balances);
    });
    await check('create namespace is user-scoped and case-sensitive; distinct keys mean distinct paid work', async () => {
        await quota();
        const k = key(), before = await counts();
        const results = await Promise.all([create(`a-${k}`), create(`A-${k}`), create(`a-${k}`, {}, 8)]);
        assert.ok(results.every(r => r.status === 201), JSON.stringify(results));
        assert.equal(new Set(results.map(r => r.id)).size, 3);
        assert.deepEqual(await delta(before), [3, 3, 6, 3]);
        assert.deepEqual(await balance(), [17, 20]);
    });
    await check('replay returns original PS3 snapshot after editing, moderation and soft deletion; never restores it', async () => {
        await quota();
        const k = key(), initial = await create(k);
        assert.equal((await edit(initial.id, { name: 'Later edit' })).status, 200);
        for (const status of ['PS1', 'PS2', 'PS4']) {
            await pool.query('UPDATE posts SET statusCode = ? WHERE id = ?', [status, initial.id]);
            const before = await counts(), balances = await balance();
            assert.deepEqual((await create(k)).body, initial.body);
            assert.equal((await pool.query('SELECT statusCode FROM posts WHERE id = ?', [initial.id]))[0][0].statusCode, status);
            assert.deepEqual(await counts(), before);
            assert.deepEqual(await balance(), balances);
        }
    });
    await check('current company ban/membership and stored tenant binding deny replay even with stale trusted headers', async () => {
        await quota();
        const k = key(), initial = await create(k), before = await counts(), balances = await balance();
        assert.equal(initial.status, 201);
        try {
            await pool.query("UPDATE companies SET statusCode = 'S2' WHERE id = 3");
            assert.equal((await create(k)).status, 403);
            await pool.query("UPDATE companies SET statusCode = 'S1', censorCode = 'CS2' WHERE id = 3");
            assert.equal((await create(k)).status, 403);
            await pool.query("UPDATE companies SET censorCode = 'CS1' WHERE id = 3");
            await pool.query('UPDATE users SET companyId = 4 WHERE id = 7');
            assert.equal((await create(k)).status, 403);
            assert.equal((await create(k, {}, 7, { 'x-company-id': '4' })).status, 403);
        } finally {
            await pool.query("UPDATE companies SET statusCode = 'S1', censorCode = 'CS1' WHERE id = 3");
            await pool.query('UPDATE users SET companyId = 3 WHERE id = 7');
        }
        assert.deepEqual(await counts(), before);
        assert.deepEqual(await balance(), balances);
    });
    for (const table of ['detailposts', 'posts', 'outbox_events', 'job_moderation_state', 'job_request_keys']) {
        await check(`keyed create rolls back claim, quota, job and outbox when ${table} fails; same key then succeeds`, async () => {
            await quota();
            const k = key(), before = await counts(), keys = await keyCount();
            await pool.query(`CREATE TRIGGER fail_request AFTER ${table === 'job_request_keys' ? 'UPDATE' : 'INSERT'} ON ${table}
                FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic request failure'`);
            try {
                assert.equal((await create(k)).status, 500);
                assert.deepEqual(await counts(), before);
                assert.equal(await keyCount(), keys);
                assert.deepEqual(await balance(), [20, 20]);
            } finally { await pool.query('DROP TRIGGER fail_request'); }
            assert.equal((await create(k)).status, 201);
            assert.deepEqual(await delta(before), [1, 1, 2, 1]);
        });
    }
    await check('nontransactional ledger fails closed before claim/debit; corrupted/missing accepted job is never recreated', async () => {
        await quota();
        const before = await counts(), keys = await keyCount(), k = key();
        await pool.query('ALTER TABLE job_request_keys ENGINE=MyISAM');
        try {
            assert.equal((await create(k)).status, 503);
            assert.deepEqual(await counts(), before);
            assert.equal(await keyCount(), keys);
        } finally { await pool.query('ALTER TABLE job_request_keys ENGINE=InnoDB'); }
        const initial = await create(k);
        await pool.query("UPDATE job_request_keys SET responseJson = 'null' WHERE userId = 7 AND requestKey = ?", [k]);
        assert.equal((await create(k)).status, 409);
        await pool.query('DELETE FROM posts WHERE id = ?', [initial.id]);
        assert.equal((await create(k)).status, 409);
        assert.deepEqual(await balance(), [19, 20]);
    });
    for (const hot of [0, 1]) {
        await check(`20 duplicate reposts clone an expired ${hot ? 'featured' : 'normal'} source once, with fresh moderation`, async () => {
            const id = await source(hot), k = key();
            const [[original]] = await pool.query('SELECT * FROM posts WHERE id = ?', [id]);
            const [[detail]] = await pool.query('SELECT * FROM detailposts WHERE id = ?', [original.detailPostId]);
            await quota(1, 1);
            const before = await counts(), keys = await keyCount();
            const results = await Promise.all(Array.from({ length: 20 }, () => repost(id, k, deadline)));
            assert.ok(results.every(r => r.status === 201), JSON.stringify(results));
            assert.ok(results.every(r => JSON.stringify(r.body) === JSON.stringify(results[0].body)));
            const [[copy]] = await pool.query('SELECT * FROM posts WHERE id = ?', [results[0].id]);
            assert.notEqual(copy.id, id); assert.notEqual(copy.detailPostId, original.detailPostId);
            assert.equal(copy.userId, 7); assert.equal(copy.isHot, hot); assert.equal(copy.statusCode, 'PS3');
            const [[copyDetail]] = await pool.query('SELECT * FROM detailposts WHERE id = ?', [copy.detailPostId]);
            assert.deepEqual({ ...copyDetail, id: detail.id }, detail);
            assert.deepEqual((await pool.query('SELECT * FROM posts WHERE id = ?', [id]))[0][0], original);
            assert.deepEqual(await delta(before), [1, 1, 2, 1]);
            assert.equal(await keyCount(), keys + 1);
            assert.deepEqual(await balance(), hot ? [1, 0] : [0, 1]);
            const [events] = await pool.query('SELECT eventType FROM outbox_events WHERE aggregateId = ?', [String(copy.id)]);
            assert.deepEqual(events.map(e => e.eventType).sort(), ['ai.moderate_job', 'job.created']);
        });
    }
    await check('repost validates source eligibility/ownership and body/key before spending or saving a claim', async () => {
        const id = await source(), keys = await keyCount(), before = await counts(), balances = await balance();
        assert.equal((await repost(id, undefined)).status, 400);
        assert.equal((await repost(id, 'bad key')).status, 400);
        assert.equal((await repost(id, key(), '1700000000000')).status, 400);
        assert.equal((await repost(id, key(), deadline, 7, {}, { isHot: 1 })).status, 400);
        assert.equal((await repost(999999, key())).status, 404);
        assert.equal((await repost(id, key(), deadline, 99, { 'x-company-id': '4', 'x-user-role': 'ADMIN' })).status, 403);
        assert.equal((await repost(id, key(), deadline, 88, { 'x-user-role': 'ADMIN' })).status, 403);
        await pool.query('UPDATE posts SET timeEnd = ? WHERE id = ?', [deadline, id]);
        assert.equal((await repost(id, key())).status, 409);
        await pool.query("UPDATE posts SET timeEnd = '1700000000000', statusCode = 'PS4' WHERE id = ?", [id]);
        assert.equal((await repost(id, key())).status, 409);
        assert.deepEqual(await counts(), before);
        assert.deepEqual(await balance(), balances);
        assert.equal(await keyCount(), keys);
    });
    await check('accepted repost is stable after source edit/removal; changed source/deadline/operation conflicts', async () => {
        const id = await source(), k = key(), initial = await repost(id, k, deadline);
        assert.equal(initial.status, 201);
        assert.equal((await edit(id, { name: 'Source changed after repost' })).status, 200);
        assert.deepEqual((await repost(id, k, Number(deadline))).body, initial.body);
        await pool.query('DELETE FROM posts WHERE id = ?', [id]);
        const before = await counts(), balances = await balance();
        assert.deepEqual((await repost(id, k, deadline)).body, initial.body);
        assert.equal((await repost(id + 1, k, deadline)).status, 409);
        assert.equal((await repost(id, k, String(Number(deadline) + 1))).status, 409);
        assert.equal((await create(k)).status, 409);
        assert.deepEqual(await counts(), before);
        assert.deepEqual(await balance(), balances);
    });
    await check('repost failure after all writes rolls back the entire operation and leaves source untouched', async () => {
        const id = await source(), k = key(), before = await counts(), balances = await balance(), keys = await keyCount();
        await pool.query(`CREATE TRIGGER fail_repost AFTER UPDATE ON job_request_keys
            FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic repost failure'`);
        try {
            assert.equal((await repost(id, k, deadline)).status, 500);
            assert.deepEqual(await counts(), before); assert.deepEqual(await balance(), balances);
            assert.equal(await keyCount(), keys);
        } finally { await pool.query('DROP TRIGGER fail_repost'); }
        assert.equal((await repost(id, k, deadline)).status, 201);
    });
    await check('repost waiting on author lock copies the latest committed immutable detail, not an old snapshot', async () => {
        const id = await source(), k = key(), blocker = await pool.getConnection();
        let pending;
        try {
            await blocker.beginTransaction();
            await blocker.query('SELECT id FROM users WHERE id = 8 FOR UPDATE');
            pending = repost(id, k, deadline);
            await waitForRowWait();
            const [[post]] = await blocker.query('SELECT detailPostId FROM posts WHERE id = ? FOR UPDATE', [id]);
            await blocker.query('UPDATE detailposts SET name = ? WHERE id = ?', ['Latest committed source', post.detailPostId]);
            await blocker.commit();
            const result = await pending;
            assert.equal(result.status, 201, JSON.stringify(result));
            assert.equal(result.body.data.name, 'Latest committed source');
        } finally { await blocker.rollback(); blocker.release(); await pending; }
    });
    for (const change of ['author', 'company', 'deleted']) {
        await check(`repost rechecks concurrent ${change} changes after lock wait and rolls back the key`, async () => {
            const id = await source(), k = key(), before = await counts(), keys = await keyCount(), balances = await balance();
            const blocker = await pool.getConnection();
            let pending;
            try {
                await blocker.beginTransaction();
                await blocker.query('SELECT id FROM users WHERE id = 8 FOR UPDATE');
                pending = repost(id, k, deadline);
                await waitForRowWait();
                if (change === 'author') await blocker.query('UPDATE posts SET userId = 99 WHERE id = ?', [id]);
                if (change === 'company') await blocker.query('UPDATE users SET companyId = 4 WHERE id = 8');
                if (change === 'deleted') await blocker.query("UPDATE posts SET statusCode = 'PS4' WHERE id = ?", [id]);
                await blocker.commit();
                assert.equal((await pending).status, change === 'company' ? 403 : 409);
                assert.deepEqual(await counts(), before); assert.equal(await keyCount(), keys);
                assert.deepEqual(await balance(), balances);
            } finally {
                await blocker.rollback(); blocker.release(); await pending;
                await pool.query('UPDATE users SET companyId = 3 WHERE id = 8');
            }
        });
    }
};
