import assert from 'node:assert/strict';
import { DETAIL_FIELDS } from '../job-core-service/src/libs/jobEdit.js';
import { assertEventPayload } from '../shared/eventContract.js';

// Real legacy HTTP/controller/Sequelize, only the caller's owned disposable DB.
// No providers, relay, live project credentials, or changes outside this fixture.
export const runLegacyCreateOutboxChecks = async ({ pool, check, legacyCreateHttp: create, counts, balance, waitForRowWait }) => {
    const quota = () => pool.query('UPDATE companies SET allowPost = 50, allowHotPost = 50 WHERE id = 3');
    const before = async () => ({ counts: await counts(), balance: await balance() });
    const created = async (id, baseline, hot) => {
        const [[post]] = await pool.query('SELECT * FROM posts WHERE id = ?', [id]);
        const [[detail]] = await pool.query('SELECT * FROM detailposts WHERE id = ?', [post.detailPostId]);
        const [events] = await pool.query('SELECT * FROM outbox_events WHERE aggregateId = ?', [String(id)]);
        assert.equal(events.length, 1); const [event] = events;
        assert.equal(event.aggregateType, 'legacy-job'); assert.equal(event.eventType, 'job.created');
        assert.equal(event.publishedAt, null); assert.equal(event.attempts, 0); assert.equal(event.lockToken, null);
        const payload = JSON.parse(event.payload);
        assert.equal(assertEventPayload('job.created', payload, { aggregateId: event.aggregateId }), String(id));
        assert.equal(post.userId, 7); assert.equal(post.statusCode, 'PS3'); assert.equal(post.timePost, null); assert.equal(post.isHot, hot);
        for (const field of ['id', 'userId', 'timePost', 'timeEnd', 'statusCode', 'isHot']) assert.deepEqual(payload.job[field], post[field], field);
        for (const field of DETAIL_FIELDS) assert.deepEqual(payload.job[field], detail[field], field);
        assert.equal(payload.job.companyId, 3); assert.equal(payload.job.companyStatusCode, 'S1');
        assert.deepEqual(await counts(), baseline.counts.map((n, i) => n + (i < 3 ? 1 : 0)));
        assert.deepEqual(await balance(), baseline.balance.map((n, i) => n - (i === hot ? 1 : 0)));
        return { post, detail, event, payload };
    };
    await quota();
    for (const [flag, hot] of [[0, 0], ['0', 0], [1, 1], ['1', 1]]) {
        await check(`legacy create HTTP ${JSON.stringify(flag)} atomically charges once and saves one PS3 event from persisted rows`, async () => {
            const baseline = await before(), r = await create({ isHot: flag });
            assert.equal(r.status, 200); assert.equal(r.body.errCode, 0, JSON.stringify(r));
            await created(r.body.postId, baseline, hot);
        });
    }
    await check('lost legacy create response leaves the new post, one charge and stable pending event without AI work', async () => {
        const baseline = await before();
        await assert.rejects(create({ drop: true, name: 'Lost creation response' }), /fetch failed|socket|other side closed/i);
        const [[{ id }]] = await pool.query('SELECT MAX(id) AS id FROM posts');
        const saved = await created(id, baseline, 0); assert.equal(saved.detail.name, 'Lost creation response');
        // No HTTP idempotency claim: do NOT repeat this POST. Relay retry reuses
        // event.id; a separate HTTP POST would create and charge another post.
    });
    for (const table of ['companies', 'detailposts', 'posts', 'outbox_events']) {
        await check(`real ${table} failure in legacy create rolls back post/detail/quota/event and returns no successful ID`, async () => {
            const baseline = await before();
            await pool.query(`CREATE TRIGGER fail_legacy_create AFTER ${table === 'companies' ? 'UPDATE' : 'INSERT'} ON ${table}
                FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic create rollback'`);
            try {
                const r = await create(); assert.equal(r.status, 200); assert.equal(r.body.errCode, -1);
                assert.equal(r.body.postId, undefined); assert.equal(JSON.stringify(r.body).includes('synthetic'), false);
                assert.deepEqual(await before(), baseline);
            } finally { await pool.query('DROP TRIGGER fail_legacy_create'); }
        });
    }
    for (const problem of ['missing', 'MyISAM']) {
        await check(`legacy create with ${problem} outbox fails closed without consuming a slot or retaining a snapshot`, async () => {
            const baseline = await before();
            await pool.query(problem === 'missing' ? 'RENAME TABLE outbox_events TO held_create_outbox' : 'ALTER TABLE outbox_events ENGINE=MyISAM');
            try { const r = await create(); assert.equal(r.body.errCode, 2); assert.equal(r.body.postId, undefined); }
            finally { await pool.query(problem === 'missing' ? 'RENAME TABLE held_create_outbox TO outbox_events' : 'ALTER TABLE outbox_events ENGINE=InnoDB'); }
            assert.deepEqual(await before(), baseline);
        });
    }
    await check('created event uses DB-normalized detail, then remains immutable after future edits', async () => {
        const baseline = await before();
        await pool.query("CREATE TRIGGER normalize_create_detail BEFORE INSERT ON detailposts FOR EACH ROW SET NEW.name = 'DB normalized creation'");
        try {
            const r = await create(), saved = await created(r.body.postId, baseline, 0);
            assert.equal(saved.payload.job.name, 'DB normalized creation');
            await pool.query("UPDATE detailposts SET name = 'Later content' WHERE id = ?", [saved.detail.id]);
            const [[event]] = await pool.query('SELECT * FROM outbox_events WHERE id = ?', [saved.event.id]);
            assert.deepEqual(event, saved.event);
        } finally { await pool.query('DROP TRIGGER normalize_create_detail'); }
    });
    await check('invalid persisted contract field aborts the creation and refunds its slot in the same transaction', async () => {
        const baseline = await before();
        await pool.query('CREATE TRIGGER invalid_create_post BEFORE INSERT ON posts FOR EACH ROW SET NEW.isHot = 2');
        try { const r = await create(); assert.equal(r.body.errCode, -1); assert.deepEqual(await before(), baseline); }
        finally { await pool.query('DROP TRIGGER invalid_create_post'); }
    });
    for (const banned of [false, true]) {
        await check(`legacy create after company lock wait ${banned ? 'rejects revoked approval' : 'captures fresh company name/logo'}`, async () => {
            const baseline = await before(), [[company]] = await pool.query('SELECT * FROM companies WHERE id = 3');
            const blocker = await pool.getConnection(); let pending;
            try {
                await blocker.beginTransaction(); await blocker.query('SELECT id FROM companies WHERE id = 3 FOR UPDATE');
                pending = create(); await waitForRowWait(); assert.deepEqual(await before(), baseline);
                await blocker.query('UPDATE companies SET name = ?, thumbnail = ?, statusCode = ? WHERE id = 3', ['Fresh create company', 'fresh-logo', banned ? 'S2' : 'S1']);
                await blocker.commit(); const r = await pending;
                if (banned) { assert.equal(r.body.errCode, 2); assert.deepEqual(await before(), baseline); }
                else {
                    const saved = await created(r.body.postId, baseline, 0);
                    assert.equal(saved.payload.job.companyName, 'Fresh create company'); assert.equal(saved.payload.job.companyLogo, 'fresh-logo');
                }
            } finally {
                await blocker.rollback(); blocker.release(); await pending;
                await pool.query('UPDATE companies SET name = ?, thumbnail = ?, statusCode = ? WHERE id = 3', [company.name, company.thumbnail, company.statusCode]);
            }
        });
    }
    await check('20 concurrent legacy HTTP creations cannot exceed three slots and save exactly one event per successful post', async () => {
        await pool.query('UPDATE companies SET allowPost = 3 WHERE id = 3');
        const baseline = await before(), results = await Promise.all(Array.from({ length: 20 }, () => create()));
        const success = results.filter(r => r.body.errCode === 0);
        assert.equal(success.length, 3); assert.equal(results.filter(r => r.body.errCode === 2).length, 17);
        assert.equal(new Set(success.map(r => r.body.postId)).size, 3);
        assert.deepEqual(await counts(), baseline.counts.map((n, i) => n + (i < 3 ? 3 : 0)));
        assert.deepEqual(await balance(), [0, baseline.balance[1]]);
        for (const r of success) {
            const [events] = await pool.query('SELECT * FROM outbox_events WHERE aggregateId = ?', [String(r.body.postId)]);
            assert.equal(events.length, 1); assert.equal(events[0].eventType, 'job.created'); assert.equal(events[0].publishedAt, null);
        }
    });
};
