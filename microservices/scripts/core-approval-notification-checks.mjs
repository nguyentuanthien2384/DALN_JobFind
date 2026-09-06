import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { handleAiResult, createAiResultHandler } from '../job-core-service/src/libs/aiResultHandler.js';
import { withTransaction } from '../job-core-service/src/libs/db.js';

// Runs ONLY in test-posting-quota's owned MySQL fixture. Never starts a relay,
// delivery worker or external provider. Uses actual Core/manual writers + inbox.
export const runCoreApprovalNotificationChecks = async ({ pool, check, make, read, decide, state, post, repost, edit,
    handleNotificationEvent, receive, deliveryCounts, waitForRowWait }) => {
    const type = 'notification.job_approved_requested';
    const events = async (id, eventType = type) => (await pool.query(
        'SELECT * FROM outbox_events WHERE aggregateId = ? AND eventType = ? ORDER BY id', [String(id), eventType]))[0];
    const data = async id => ({ type: 'moderate_job', jobId: id, moderationRequestId: (await state(id)).requestId,
        ok: true, result: { approved: true, reason: 'Synthetic approval' } });
    const receiveAi = (value, eventId = randomUUID()) => handleAiResult(value, { eventId, aggregateId: String(value.jobId) });
    const followers = async rows => {
        await pool.query('DELETE FROM followcompanies');
        if (rows.length) await pool.query('INSERT INTO followcompanies (companyId,userId) VALUES ?', [rows]);
    };
    const snapshot = async id => ({ post: await post(id), state: await state(id), events: await events(id), moderated: await events(id, 'job.moderated') });
    await pool.query('UPDATE companies SET allowPost = 100, allowHotPost = 100 WHERE id = 3');
    await followers([[3, 8], [3, 8], [3, 9], [3, 0], [4, 99]]);

    await check('Core approval: creation stays silent; 20 duplicate results freeze one distinct follower set and one author decision', async () => {
        const id = await make(), value = await data(id), eventId = randomUUID();
        const [created] = await events(id, 'job.created');
        assert.equal(JSON.parse(created.payload).notificationPolicy, 'approval-v1');
        const before = await deliveryCounts();
        await receive(created); await receive(created);
        assert.deepEqual(await deliveryCounts(), before);
        const outcomes = await Promise.all(Array.from({ length: 20 }, () => receiveAi(value, eventId)));
        assert.equal(outcomes.filter(r => r.outcome === 'applied').length, 1);
        assert.equal(outcomes.filter(r => r.outcome === 'duplicate').length, 19);
        const saved = await events(id), [author] = await events(id, 'job.moderated');
        assert.deepEqual(saved.map(r => JSON.parse(r.payload).recipientId).sort(), [8, 9]);
        assert.equal(new Set([...saved, author].map(r => r.id)).size, 3);
        for (const row of saved) assert.equal(JSON.parse(row.payload).decisionId, value.moderationRequestId);
        // The author may also follow the company: two audiences need distinct IDs.
        await followers([[3, 999], [4, 99]]);
        await Promise.all(Array.from({ length: 10 }, () => receive(saved[0])));
        for (const row of saved) { await receive(row); await receive(row); }
        await receive(author); await receive(author); await receive(created);
        assert.deepEqual(await deliveryCounts(), before.map((n, i) => n + (i === 2 ? 4 : 3)));
        for (const row of saved) {
            const [channels] = await pool.query('SELECT channel FROM notification_deliveries WHERE eventId = ?', [row.id]);
            assert.deepEqual(channels.map(c => c.channel), ['realtime']);
        }
        assert.deepEqual(await events(id), saved);
        assert.equal((await receiveAi(value)).outcome, 'stale');
        assert.deepEqual(await events(id), saved);
    });

    await check('Core approval: lost commit reply replays without another approval or follower intent', async () => {
        const id = await make(), value = await data(id), eventId = randomUUID();
        const ambiguous = createAiResultHandler({ transaction: async work => {
            await withTransaction(work); throw new Error('synthetic lost commit response');
        } });
        await assert.rejects(ambiguous(value, { eventId }), /lost commit/);
        const before = await snapshot(id);
        assert.equal(before.events.length, 1);
        assert.equal((await receiveAi(value, eventId)).outcome, 'duplicate');
        assert.deepEqual(await snapshot(id), before);
    });

    await check('Core approval: different result IDs for one request still produce only one accepted decision', async () => {
        const id = await make(), value = await data(id);
        const results = await Promise.all(Array.from({ length: 20 }, () => receiveAi(value)));
        assert.equal(results.filter(r => r.outcome === 'applied').length, 1);
        assert.equal(results.filter(r => r.outcome === 'stale').length, 19);
        assert.equal((await events(id)).length, 1);
        assert.equal((await events(id, 'job.moderated')).length, 1);
    });

    await check('Core approval: competing manual and AI approval notify followers through exactly one decision path', async () => {
        const id = await make(), job = await read(id), value = await data(id);
        const [manual, ai] = await Promise.all([decide(job, 'approve'), receiveAi(value)]);
        assert.equal(Number(manual.errCode === 0) + Number(ai.outcome === 'applied'), 1);
        const manualEvents = await events(id, 'notification.manual_moderation_requested');
        assert.equal((await events(id)).length + manualEvents.filter(r => JSON.parse(r.payload).audience === 'follower').length, 1);
    });

    await check('Core approval: a genuinely new content review gets new intents while replay of its predecessor stays stale', async () => {
        const id = await make(), old = await data(id);
        await receiveAi(old);
        const first = await events(id);
        assert.equal((await edit(id, { name: 'A new reviewed version' })).status, 200);
        const next = await data(id);
        assert.notEqual(next.moderationRequestId, old.moderationRequestId);
        await receiveAi(next);
        assert.equal((await events(id)).length, 2);
        assert.equal((await receiveAi(old)).outcome, 'stale');
        assert.equal((await events(id)).find(r => r.id === first[0].id).payload, first[0].payload);
    });

    await check('Core approval: delayed Unicode author/follower notices remain bounded historical snapshots after ban', async () => {
        const id = await make(), title = '🧑'.repeat(255);
        assert.equal((await edit(id, { name: title })).status, 200);
        await receiveAi(await data(id));
        const saved = [...await events(id), ...await events(id, 'job.moderated')];
        assert.equal((await decide(await read(id), 'ban')).errCode, 0);
        const before = await post(id);
        for (const row of saved) {
            await receive(row); await receive(row);
            const [[notification]] = await pool.query('SELECT n.content FROM notifications n JOIN notification_inbox i ON n.id = i.notificationId WHERE i.eventId = ?', [row.id]);
            assert.equal(Array.from(notification.content).length, 255);
            if (row.eventType === 'job.moderated') {
                const [[email]] = await pool.query("SELECT payload FROM notification_deliveries WHERE eventId = ? AND channel = 'email'", [row.id]);
                assert.ok(JSON.parse(email.payload).text.includes(title));
                assert.ok(JSON.parse(email.payload).text.includes('trạng thái mới nhất'));
                assert.ok(!JSON.parse(email.payload).text.includes('đang hiển thị'));
            }
        }
        assert.deepEqual(await post(id), before); assert.equal(before.statusCode, 'PS4');
    });

    await check('Core approval: missing follower storage rolls back all decision writes rather than silently omitting recipients', async () => {
        const id = await make(), value = await data(id), eventId = randomUUID(), before = await snapshot(id);
        await pool.query('RENAME TABLE followcompanies TO saved_core_followers');
        try {
            await assert.rejects(receiveAi(value, eventId), { code: 'ER_NO_SUCH_TABLE' });
            assert.deepEqual(await snapshot(id), before);
        } finally { await pool.query('RENAME TABLE saved_core_followers TO followcompanies'); }
        await receiveAi(value, eventId); assert.equal((await events(id)).length, 1);
    });

    for (const outcome of ['reject', 'failure', 'manual', 'edit', 'ban']) {
        await check('Core approval: no new follower intent for ' + outcome, async () => {
            const id = await make(), value = await data(id);
            if (outcome === 'reject') value.result.approved = false;
            if (outcome === 'failure') { value.ok = false; delete value.result; value.error = 'Synthetic timeout'; }
            if (outcome === 'manual' || outcome === 'ban') assert.equal((await decide(await read(id), outcome === 'manual' ? 'approve' : 'ban')).errCode, 0);
            if (outcome === 'edit') assert.equal((await edit(id, { name: 'New revision' })).status, 200);
            await receiveAi(value);
            assert.equal((await events(id)).length, 0);
            if (outcome === 'manual') {
                const manual = await events(id, 'notification.manual_moderation_requested');
                assert.equal(manual.filter(r => JSON.parse(r.payload).audience === 'follower').length, 1);
            }
        });
    }

    await check('Core approval: unmarked historical request retains creation policy without a second follower fanout', async () => {
        const id = await make(), value = await data(id);
        // Simulate saved pre-2n data only in this disposable fixture.
        await pool.query("UPDATE outbox_events SET payload = JSON_REMOVE(payload, '$.notificationPolicy') WHERE id = ? OR (aggregateId = ? AND eventType = 'job.created')",
            [value.moderationRequestId, String(id)]);
        const before = await deliveryCounts(), [created] = await events(id, 'job.created');
        await handleNotificationEvent(JSON.parse(created.payload), 'job.created', { eventId: created.id, producer: 'job-core-service' });
        assert.deepEqual(await deliveryCounts(), before.map((n, i) => n + (i === 2 ? 2 : 1)));
        await receiveAi({ ...value, notificationPolicy: 'approval-v1' }); // AI cannot override saved policy.
        assert.equal((await events(id)).length, 0);
    });

    await check('Core approval: a repost has its own pending marker and approval recipients, without advertising its expired source', async () => {
        const source = await make();
        await pool.query('UPDATE posts SET timeEnd = ? WHERE id = ?', [String(Date.now() - 1), source]);
        const copy = await repost(source, randomUUID());
        assert.equal(copy.status, 201);
        const [created] = await events(copy.id, 'job.created');
        assert.equal(JSON.parse(created.payload).notificationPolicy, 'approval-v1');
        await receiveAi(await data(source)); await receiveAi(await data(copy.id));
        assert.equal((await events(source)).length, 0);
        assert.equal((await events(copy.id)).length, 1);
        assert.equal(JSON.parse((await events(copy.id))[0].payload).jobId, copy.id);
    });

    for (const field of ['statusCode', 'censorCode']) {
        await check('Core approval: inactive company ' + field + ' produces no follower advertisement', async () => {
            const id = await make();
            await pool.query('UPDATE companies SET ' + field + ' = ? WHERE id = 3', [field === 'statusCode' ? 'S2' : 'CS2']);
            try { await receiveAi(await data(id)); assert.equal((await events(id)).length, 0); }
            finally { await pool.query('UPDATE companies SET ' + field + ' = ? WHERE id = 3', [field === 'statusCode' ? 'S1' : 'CS1']); }
        });
    }

    await check('Core approval: follower/company snapshot is taken after waiting for the post lock', async () => {
        const id = await make(), value = await data(id), blocker = await pool.getConnection();
        let pending;
        try {
            await blocker.beginTransaction();
            await blocker.query('UPDATE users SET companyId = 4 WHERE id = 8');
            await blocker.query('SELECT id FROM posts WHERE id = ? FOR UPDATE', [id]);
            pending = receiveAi(value);
            await waitForRowWait(); await blocker.commit(); await pending;
            const saved = await events(id);
            assert.deepEqual(saved.map(r => JSON.parse(r.payload).recipientId), [99]);
            assert.equal(JSON.parse(saved[0].payload).companyName, 'Other company');
        } finally {
            await blocker.rollback(); blocker.release(); await pending;
            await pool.query('UPDATE users SET companyId = 3 WHERE id = 8');
        }
    });

    await check('Core approval: later follower batch failure rolls back status, request, inbox, author event and earlier recipients', async () => {
        await followers(Array.from({ length: 205 }, (_, i) => [3, i + 1000]));
        const id = await make(), value = await data(id), eventId = randomUUID(), before = await snapshot(id);
        await pool.query(`CREATE TRIGGER fail_core_approval BEFORE INSERT ON outbox_events FOR EACH ROW
            BEGIN IF NEW.eventType = 'notification.job_approved_requested' AND JSON_EXTRACT(NEW.payload, '$.recipientId') >= 1100
            THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic approval batch failure'; END IF; END`);
        try {
            await assert.rejects(receiveAi(value, eventId), /approval batch failure/);
            assert.deepEqual(await snapshot(id), before);
            assert.equal((await pool.query('SELECT * FROM ai_result_inbox WHERE eventId = ?', [eventId]))[0].length, 0);
        } finally { await pool.query('DROP TRIGGER fail_core_approval'); }
        await receiveAi(value, eventId);
        const saved = await events(id);
        assert.equal(saved.length, 205); assert.equal(new Set(saved.map(r => r.id)).size, 205);
        await receiveAi(value, eventId); assert.deepEqual(await events(id), saved);
    });

    for (const mode of ['missing', 'invalid']) {
        await check('Core approval: ' + mode + ' request evidence fails closed and can retry after exact restoration', async () => {
            const id = await make(), value = await data(id), eventId = randomUUID(), before = await snapshot(id);
            const [[saved]] = await pool.query('SELECT * FROM outbox_events WHERE id = ?', [value.moderationRequestId]);
            if (mode === 'missing') await pool.query('DELETE FROM outbox_events WHERE id = ?', [saved.id]);
            else await pool.query("UPDATE outbox_events SET payload = '{}' WHERE id = ?", [saved.id]);
            try {
                await assert.rejects(receiveAi(value, eventId)); assert.deepEqual(await snapshot(id), before);
            } finally {
                if (mode === 'missing') await pool.query('INSERT INTO outbox_events SET ?', [saved]);
                else await pool.query('UPDATE outbox_events SET payload = ? WHERE id = ?', [saved.payload, saved.id]);
            }
            await receiveAi(value, eventId); assert.equal((await events(id)).length, 205);
        });
    }

    await check('Core approval: delivery failure rolls back notification/inbox and retries the frozen recipient once', async () => {
        const id = await make(); await receiveAi(await data(id));
        const [saved] = await events(id), before = await deliveryCounts();
        await pool.query(`CREATE TRIGGER fail_core_delivery BEFORE INSERT ON notification_deliveries FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic core delivery failure'`);
        try { await assert.rejects(receive(saved), /core delivery failure/); assert.deepEqual(await deliveryCounts(), before); }
        finally { await pool.query('DROP TRIGGER fail_core_delivery'); }
        await receive(saved); await receive(saved);
        assert.deepEqual(await deliveryCounts(), before.map(n => n + 1));
    });
    await followers([[3, 999]]);
};
