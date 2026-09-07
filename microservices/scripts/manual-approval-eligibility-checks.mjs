import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { handleAiResult } from '../job-core-service/src/libs/aiResultHandler.js';
import { assertEventPayload } from '../shared/eventContract.js';

// Uses only test-posting-quota's owned disposable DB and trusted test HTTP.
// The real notification consumer writes its inbox/delivery ledger, but no relay,
// delivery worker, Socket.IO server, SMTP or AI provider is started.
export const runManualApprovalEligibilityChecks = async ({ pool, check, make, read, decide, state, post,
    manualHttp, receive, deliveryCounts, counts, balance, waitForRowWait }) => {
    const manualType = 'notification.manual_moderation_requested', coreType = 'notification.job_approved_requested';
    const events = async id => (await pool.query('SELECT * FROM outbox_events WHERE aggregateId = ? ORDER BY id', [String(id)]))[0];
    const notes = async id => (await pool.query('SELECT * FROM notes WHERE postId = ? ORDER BY id', [id]))[0];
    const snapshot = async id => ({ post: await post(id), state: await state(id), events: await events(id), notes: await notes(id),
        counts: await counts(), quota: await balance() });
    const followers = async (rows = [[3, 8], [3, 8], [3, 9], [4, 99]]) => {
        await pool.query('DELETE FROM followcompanies');
        if (rows.length) await pool.query('INSERT INTO followcompanies (companyId,userId) VALUES ?', [rows]);
    };
    const fresh = async () => {
        await pool.query('UPDATE companies SET allowPost = 100, allowHotPost = 100 WHERE id = 3');
        return make();
    };
    const aiData = async id => ({ type: 'moderate_job', jobId: id, moderationRequestId: (await state(id)).requestId,
        ok: true, result: { approved: true, reason: 'Synthetic approval only' } });
    const ai = (payload, eventId = randomUUID()) => handleAiResult(payload, { eventId, aggregateId: String(payload.jobId) });
    const noticeRows = async (id, audience) => (await events(id)).filter(row => row.eventType === manualType
        ? JSON.parse(row.payload).audience === audience : row.eventType === (audience === 'author' ? 'job.moderated' : coreType));
    const verify = async (id, before, recipientIds, mode = 'manual') => {
        const current = await post(id); assert.equal(current.statusCode, 'PS1');
        for (const field of ['id', 'detailPostId', 'userId', 'isHot', 'timeEnd']) assert.deepEqual(current[field], before.post[field], field);
        assert.deepEqual(await balance(), before.quota);
        assert.equal((await state(id)).state, mode === 'manual' ? 'cancelled' : 'applied');
        assert.equal((await notes(id)).length, before.notes.length + Number(mode === 'manual'));
        assert.equal((await noticeRows(id, 'author')).length, 1);
        const saved = await noticeRows(id, 'follower');
        assert.deepEqual(saved.map(row => JSON.parse(row.payload).recipientId).sort((a, b) => a - b), recipientIds);
        for (const row of [...saved, ...await noticeRows(id, 'author')]) {
            const payload = JSON.parse(row.payload);
            assertEventPayload(row.eventType, payload, { aggregateId: row.aggregateId });
            for (const field of ['timeEnd', 'companyStatusCode', 'companyCensorCode', 'companyId']) assert.equal(Object.hasOwn(payload, field), false);
        }
    };
    await followers();
    const invalidDates = [null, '', 'bad', '0', '1700000000000', '2e12', ' 2000000000000 ', '2000000000000.0', '8640000000000001'];
    for (const timeEnd of invalidDates) await check(`Manual eligibility: both decision paths suppress invalid/expired deadline ${JSON.stringify(timeEnd)} but keep author and approval`, async () => {
        for (const mode of ['manual', 'core']) {
            const id = await fresh(); await pool.query('UPDATE posts SET timeEnd = ? WHERE id = ?', [timeEnd, id]);
            const job = await read(id), before = await snapshot(id);
            if (mode === 'manual') {
                // Fake eligibility fields must not override current locked rows.
                const r = await manualHttp(job, 'approve', { timeEnd: '9000000000000', companyId: 4,
                    companyStatusCode: 'S1', companyCensorCode: 'CS1', eligible: true });
                assert.equal(r.status, 200); assert.equal(r.body.changed, true);
            } else assert.equal((await ai(await aiData(id))).outcome, 'applied');
            await verify(id, before, [], mode);
        }
    });
    for (const problem of ['banned', 'unapproved', 'unknown-status', 'missing-censor', 'missing-company', 'missing-membership', 'missing-owner']) {
        await check(`Manual eligibility: both paths keep the author without advertising ${problem}`, async () => {
            for (const mode of ['manual', 'core']) {
                const id = await fresh(), job = await read(id), before = await snapshot(id);
                const [[company]] = await pool.query('SELECT * FROM companies WHERE id = 3');
                const [[owner]] = await pool.query('SELECT * FROM users WHERE id = 8');
                if (problem === 'banned') await pool.query("UPDATE companies SET statusCode = 'S2' WHERE id = 3");
                if (problem === 'unapproved') await pool.query("UPDATE companies SET censorCode = 'CS2' WHERE id = 3");
                if (problem === 'unknown-status') await pool.query("UPDATE companies SET statusCode = 'S0' WHERE id = 3");
                if (problem === 'missing-censor') await pool.query('UPDATE companies SET censorCode = NULL WHERE id = 3');
                if (problem === 'missing-company') await pool.query('DELETE FROM companies WHERE id = 3');
                if (problem === 'missing-membership') await pool.query('UPDATE users SET companyId = NULL WHERE id = 8');
                if (problem === 'missing-owner') await pool.query('DELETE FROM users WHERE id = 8');
                try {
                    if (mode === 'manual') assert.equal((await manualHttp(job, 'approve', { companyStatusCode: 'S1', companyCensorCode: 'CS1' })).body.changed, true);
                    else assert.equal((await ai(await aiData(id))).outcome, 'applied');
                    // Restore company only for reading the quota baseline. No event
                    // is recomputed when the company becomes eligible again.
                } finally {
                    if (problem === 'missing-company') await pool.query('INSERT INTO companies SET ?', [company]);
                    else await pool.query('UPDATE companies SET ? WHERE id = 3', [company]);
                    if (problem === 'missing-owner') await pool.query('INSERT INTO users SET ?', [owner]);
                    else await pool.query('UPDATE users SET ? WHERE id = 8', [owner]);
                }
                await verify(id, before, [], mode);
                const saved = await events(id);
                if (mode === 'manual') assert.equal((await decide(await read(id), 'approve')).changed, false);
                else assert.equal((await ai(await aiData(id))).outcome, 'stale');
                assert.deepEqual(await events(id), saved);
            }
        });
    }
    await check('Manual eligibility: PS2/PS3 approvals freeze distinct followers once, preserving author/follower audiences and channels', async () => {
        for (const status of ['PS2', 'PS3']) {
            const id = await fresh(); await pool.query('UPDATE posts SET statusCode = ? WHERE id = ?', [status, id]);
            const job = await read(id), before = await snapshot(id), delivered = await deliveryCounts();
            assert.equal((await manualHttp(job, 'approve')).body.changed, true); await verify(id, before, [8, 9]);
            const saved = [...await noticeRows(id, 'author'), ...await noticeRows(id, 'follower')];
            assert.equal(new Set(saved.map(r => JSON.parse(r.payload).decisionId)).size, 1);
            for (const row of saved) { await receive(row); await receive(row); }
            assert.deepEqual(await deliveryCounts(), delivered.map((n, i) => n + (i === 2 ? 4 : 3)));
            for (const row of await noticeRows(id, 'follower')) {
                assert.equal(JSON.parse(row.payload).note, null);
                assert.deepEqual((await pool.query('SELECT channel FROM notification_deliveries WHERE eventId = ?', [row.id]))[0].map(r => r.channel), ['realtime']);
            }
            assert.equal((await manualHttp(job, 'approve')).status, 409);
            assert.equal((await manualHttp(await read(id), 'approve')).body.changed, false);
            assert.deepEqual(await deliveryCounts(), delivered.map((n, i) => n + (i === 2 ? 4 : 3)));
        }
    });
    for (const field of ['statusCode', 'censorCode']) await check(`Manual eligibility: company ${field} is reread after waiting for its lock`, async () => {
        const id = await fresh(), job = await read(id), before = await snapshot(id), conn = await pool.getConnection(); let pending;
        try {
            await conn.beginTransaction(); await conn.query('SELECT id FROM companies WHERE id = 3 FOR UPDATE');
            pending = manualHttp(job, 'approve'); await waitForRowWait();
            await conn.query(`UPDATE companies SET ${field} = ? WHERE id = 3`, [field === 'statusCode' ? 'S2' : 'CS2']); await conn.commit();
            assert.equal((await pending).body.changed, true); await verify(id, before, []);
        } finally {
            await conn.rollback(); conn.release(); await pending;
            await pool.query(`UPDATE companies SET ${field} = ? WHERE id = 3`, [field === 'statusCode' ? 'S1' : 'CS1']);
        }
    });
    await check('Manual eligibility: current author membership selects the new company and follower set after lock wait', async () => {
        const id = await fresh(), job = await read(id), before = await snapshot(id), conn = await pool.getConnection(); let pending;
        try {
            await conn.beginTransaction(); await conn.query('SELECT id FROM users WHERE id = 8 FOR UPDATE');
            pending = manualHttp(job, 'approve'); await waitForRowWait();
            await conn.query('UPDATE users SET companyId = 4 WHERE id = 8'); await conn.commit();
            assert.equal((await pending).body.changed, true); await verify(id, before, [99]);
            assert.equal(JSON.parse((await noticeRows(id, 'follower'))[0].payload).companyName, 'Other company');
        } finally { await conn.rollback(); conn.release(); await pending; await pool.query('UPDATE users SET companyId = 3 WHERE id = 8'); }
    });
    for (const mode of ['manual', 'core']) await check(`Manual eligibility: ${mode} clock is checked after detail lock wait, without discarding author decision`, async () => {
        const id = await fresh(), conn = await pool.getConnection(); let pending;
        try {
            const timeEnd = String(Date.now() + 1500); await pool.query('UPDATE posts SET timeEnd = ? WHERE id = ?', [timeEnd, id]);
            const job = await read(id), before = await snapshot(id);
            await conn.beginTransaction();
            const [[locked]] = await conn.query('SELECT id FROM detailposts WHERE id = ? FOR UPDATE', [before.post.detailPostId]);
            assert.equal(locked.id, before.post.detailPostId);
            pending = mode === 'manual' ? manualHttp(job, 'approve') : ai(await aiData(id));
            await waitForRowWait(); await delay(Math.max(0, Number(timeEnd) - Date.now() + 10)); await conn.commit();
            const r = await pending; if (mode === 'manual') assert.equal(r.body.changed, true); else assert.equal(r.outcome, 'applied');
            await verify(id, before, [], mode);
        } finally { await conn.rollback(); conn.release(); await pending; }
    });
    await check('Manual eligibility: changed stored deadline still conflicts with an old moderator revision before any notification', async () => {
        const id = await fresh(), job = await read(id), conn = await pool.getConnection(); let pending;
        try {
            await conn.beginTransaction(); await conn.query('SELECT id FROM posts WHERE id = ? FOR UPDATE', [id]);
            pending = manualHttp(job, 'approve'); await waitForRowWait();
            await conn.query("UPDATE posts SET timeEnd = '1700000000000' WHERE id = ?", [id]); await conn.commit();
            assert.equal((await pending).status, 409);
            assert.equal((await post(id)).statusCode, 'PS3'); assert.equal((await noticeRows(id, 'author')).length, 0);
            assert.equal((await state(id)).state, 'pending'); assert.equal((await notes(id)).length, 0);
            const before = await snapshot(id); assert.equal((await manualHttp(await read(id), 'approve')).body.changed, true);
            await verify(id, before, []);
        } finally { await conn.rollback(); conn.release(); await pending; }
    });
    await check('Manual eligibility: an eligible follower-read failure rolls back the complete decision, then retry freezes recipients once', async () => {
        const id = await fresh(), job = await read(id), before = await snapshot(id);
        await pool.query('RENAME TABLE followcompanies TO held_manual_eligibility_followers');
        try { assert.equal((await manualHttp(job, 'approve')).status, 500); assert.deepEqual(await snapshot(id), before); }
        finally { await pool.query('RENAME TABLE held_manual_eligibility_followers TO followcompanies'); }
        assert.equal((await manualHttp(job, 'approve')).body.changed, true); await verify(id, before, [8, 9]);
    });
    await check('Manual eligibility: expired approval does not need follower storage but still saves author/search/note/fence', async () => {
        const id = await fresh(); await pool.query("UPDATE posts SET timeEnd = '1700000000000' WHERE id = ?", [id]);
        const job = await read(id), before = await snapshot(id);
        await pool.query('RENAME TABLE followcompanies TO held_manual_eligibility_followers');
        try { assert.equal((await manualHttp(job, 'approve')).body.changed, true); await verify(id, before, []); }
        finally { await pool.query('RENAME TABLE held_manual_eligibility_followers TO followcompanies'); }
    });
    for (const type of ['job.updated', manualType]) await check(`Manual eligibility: expired approval still rolls back on ${type} write failure`, async () => {
        const id = await fresh(); await pool.query("UPDATE posts SET timeEnd = '1700000000000' WHERE id = ?", [id]);
        const job = await read(id), before = await snapshot(id);
        // Event type is one of the two constants above, never external SQL text.
        await pool.query(`CREATE TRIGGER fail_manual_eligibility BEFORE INSERT ON outbox_events FOR EACH ROW
            BEGIN IF NEW.eventType = '${type}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic eligibility rollback'; END IF; END`);
        try { assert.equal((await manualHttp(job, 'approve')).status, 500); assert.deepEqual(await snapshot(id), before); }
        finally { await pool.query('DROP TRIGGER fail_manual_eligibility'); }
        assert.equal((await manualHttp(job, 'approve')).body.changed, true); await verify(id, before, []);
    });
    await check('Manual eligibility: lost approval HTTP reply cannot duplicate author or followers through stale retry/no-op', async () => {
        const id = await fresh(), job = await read(id);
        await assert.rejects(manualHttp(job, 'approve', { drop: true }), /fetch failed|socket|other side closed/i);
        const before = await snapshot(id); assert.equal((await manualHttp(job, 'approve')).status, 409);
        assert.equal((await manualHttp(await read(id), 'approve')).body.changed, false); assert.deepEqual(await snapshot(id), before);
    });
    await check('Manual eligibility: committed notices retain snapshot after expiry/company ban/unfollow; concurrent delivery only stores each once', async () => {
        const id = await fresh(); await manualHttp(await read(id), 'approve');
        const saved = [...await noticeRows(id, 'author'), ...await noticeRows(id, 'follower')], all = await events(id), before = await deliveryCounts();
        await pool.query("UPDATE posts SET timeEnd = '1700000000000' WHERE id = ?", [id]);
        await pool.query("UPDATE companies SET statusCode = 'S2', name = 'Changed after decision' WHERE id = 3"); await followers([[3, 999]]);
        try {
            for (const row of saved) await Promise.all(Array.from({ length: 8 }, () => receive(row)));
            assert.deepEqual(await events(id), all); assert.deepEqual(await deliveryCounts(), before.map((n, i) => n + (i === 2 ? 4 : 3)));
            for (const row of saved) {
                const [[n]] = await pool.query('SELECT n.content FROM notifications n JOIN notification_inbox i ON i.notificationId = n.id WHERE i.eventId = ?', [row.id]);
                assert.ok(!n.content.includes('Changed after decision')); assert.equal(JSON.parse(row.payload).companyName, 'Synthetic company');
            }
        } finally { await pool.query("UPDATE companies SET statusCode = 'S1', name = 'Synthetic company' WHERE id = 3"); await followers(); }
    });
    await check('Manual eligibility: no retroactive fanout on no-op after company recovery, but a genuinely new approval gets new recipients', async () => {
        const id = await fresh(), job = await read(id);
        await pool.query("UPDATE companies SET censorCode = 'CS2' WHERE id = 3");
        try { assert.equal((await manualHttp(job, 'approve')).body.changed, true); }
        finally { await pool.query("UPDATE companies SET censorCode = 'CS1' WHERE id = 3"); }
        const before = await events(id); assert.equal((await manualHttp(await read(id), 'approve')).body.changed, false);
        assert.deepEqual(await events(id), before); assert.equal((await noticeRows(id, 'follower')).length, 0);
        await manualHttp(await read(id), 'ban'); await manualHttp(await read(id), 'reopen'); await manualHttp(await read(id), 'approve');
        const saved = await noticeRows(id, 'follower'); assert.equal(saved.length, 2);
        assert.equal(new Set((await noticeRows(id, 'author')).map(r => JSON.parse(r.payload).decisionId)).size, 4);
    });
    await check('Manual eligibility: concurrent manual/AI approval of an expired job keeps one author decision and no follower intent', async () => {
        const id = await fresh(); await pool.query("UPDATE posts SET timeEnd = '1700000000000' WHERE id = ?", [id]);
        const [manual, core] = await Promise.all([manualHttp(await read(id), 'approve'), ai(await aiData(id))]);
        assert.equal(Number(manual.body.changed === true) + Number(core.outcome === 'applied'), 1);
        assert.equal((await noticeRows(id, 'author')).length, 1); assert.equal((await noticeRows(id, 'follower')).length, 0);
    });
    await check('Manual eligibility: pre-upgrade follower intent without date/company flags remains deliverable and deduplicated', async () => {
        const id = await fresh(); await pool.query("UPDATE posts SET timeEnd = '1700000000000' WHERE id = ?", [id]);
        // Synthetic saved pre-2p event; no live backlog is read or rewritten.
        const payload = { decisionId: randomUUID(), jobId: id, action: 'approve', jobTitle: 'Historical job', companyName: 'Historical company',
            audience: 'follower', recipientId: 9, note: null }, eventId = randomUUID();
        assertEventPayload(manualType, payload);
        await pool.query('INSERT INTO outbox_events (id, aggregateType, aggregateId, eventType, payload, createdAt) VALUES (?,?,?,?,?,?)',
            [eventId, 'manual-moderation-notification', String(id), manualType, JSON.stringify(payload), new Date()]);
        const row = (await events(id)).find(r => r.id === eventId), before = await deliveryCounts();
        await receive(row); await receive(row); assert.deepEqual(await deliveryCounts(), before.map(n => n + 1));
        assert.deepEqual((await events(id)).find(r => r.id === eventId), row);
    });
    await followers([[3, 999]]);
};
