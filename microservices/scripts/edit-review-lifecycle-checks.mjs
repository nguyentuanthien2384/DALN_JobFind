import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DETAIL_FIELDS } from '../job-core-service/src/libs/jobEdit.js';
import { handleAiResult } from '../job-core-service/src/libs/aiResultHandler.js';
import { assertEventPayload } from '../shared/eventContract.js';

// Real HTTP/SQL/ORM on test-posting-quota's owned disposable fixture only.
// AI decisions are synthetic; no provider, relay or delivery worker is started.
export const runEditReviewLifecycleChecks = async ({ pool, check, core, managed, edit, legacyEditHttp, legacyCreateHttp,
    manualHttp, counts, balance, waitForRowWait }) => {
    const read = async id => { const r = await managed(id); assert.equal(r.status, 200); return r.body.data; };
    const row = async id => (await pool.query('SELECT * FROM posts WHERE id = ?', [id]))[0][0];
    const state = async id => (await pool.query('SELECT * FROM job_moderation_state WHERE jobId = ?', [id]))[0][0];
    const events = async id => (await pool.query('SELECT * FROM outbox_events WHERE aggregateId = ? ORDER BY id', [String(id)]))[0];
    const snapshot = async id => ({ row: await row(id), state: await state(id), events: await events(id),
        counts: await counts(), quota: await balance(), notes: (await pool.query('SELECT * FROM notes WHERE postId = ? ORDER BY id', [id]))[0] });
    const ai = (id, requestId, approved = true, eventId = randomUUID()) => handleAiResult({ type: 'moderate_job', jobId: id,
        moderationRequestId: requestId, ok: true, result: { approved, reason: 'Synthetic lifecycle decision' } }, { eventId, aggregateId: String(id) });
    const make = async (status = 'PS3') => {
        await pool.query('UPDATE companies SET allowPost = 100, allowHotPost = 100 WHERE id = 3');
        const r = await core(0, 8); assert.equal(r.status, 201);
        if (status !== 'PS3') assert.equal((await ai(r.id, (await state(r.id)).requestId, status === 'PS1')).outcome, 'applied');
        return read(r.id);
    };
    const write = (kind, job, patch = {}) => kind === 'core'
        ? edit(job.id, { expectedRevision: job.editRevision, ...patch }) : legacyEditHttp(job, patch);
    const changed = async (kind, job, patch) => {
        const before = await snapshot(job.id), originalDetail = (await pool.query('SELECT * FROM detailposts WHERE id = ?', [before.row.detailPostId]))[0][0];
        const r = await write(kind, job, patch); assert.equal(r.status, 200); assert.equal(r.body.errCode, 0, JSON.stringify(r));
        const current = await read(job.id), after = await snapshot(job.id);
        assert.equal(current.statusCode, 'PS3'); assert.notEqual(current.editRevision, job.editRevision);
        assert.equal(kind === 'core' ? r.body.data.editRevision : r.body.editRevision, current.editRevision);
        for (const field of ['id', 'userId', 'timeEnd', 'timePost', 'isHot']) assert.deepEqual(after.row[field], before.row[field]);
        assert.notEqual(after.row.detailPostId, before.row.detailPostId);
        assert.deepEqual((await pool.query('SELECT * FROM detailposts WHERE id = ?', [before.row.detailPostId]))[0][0], originalDetail);
        assert.deepEqual(after.quota, before.quota); assert.deepEqual(after.notes, before.notes);
        const fresh = after.events.filter(e => !before.events.some(old => old.id === e.id));
        assert.deepEqual(fresh.map(e => e.eventType).sort(), kind === 'core' ? ['ai.moderate_job', 'job.updated'] : ['job.updated']);
        assert.deepEqual(after.counts, before.counts.map((n, i) => n + (i === 1 ? 1 : i === 2 ? (kind === 'core' ? 2 : 1) : 0)));
        for (const event of fresh) assertEventPayload(event.eventType, JSON.parse(event.payload), { aggregateId: job.id });
        const updated = JSON.parse(fresh.find(e => e.eventType === 'job.updated').payload).job;
        assert.equal(updated.statusCode, 'PS3');
        for (const field of DETAIL_FIELDS) assert.deepEqual(updated[field], current[field], field);
        if (kind === 'core') {
            assert.equal(after.state.state, 'pending'); assert.notEqual(after.state.requestId, before.state.requestId);
            const request = fresh.find(e => e.eventType === 'ai.moderate_job'), payload = JSON.parse(request.payload);
            assert.equal(request.id, after.state.requestId); assert.equal(payload.moderationRequestId, after.state.requestId);
            assert.equal(payload.notificationPolicy, 'approval-v1');
        } else { assert.equal(after.state.state, 'cancelled'); assert.equal(after.state.requestId, before.state.requestId); }
        // An old result with a NEW delivery ID still cannot approve this edit,
        // even when title/HTML and their AI content hash are unchanged.
        assert.equal((await ai(job.id, before.state.requestId)).outcome, 'stale');
        assert.deepEqual(await snapshot(job.id), after);
        return { current, before, after };
    };
    for (const field of DETAIL_FIELDS) await check(`Review lifecycle: changing only ${field} from PS1/PS2/PS3 requires a fresh review in both writers`, async () => {
        for (const status of ['PS1', 'PS2', 'PS3']) for (const kind of ['core', 'legacy']) {
            const job = await make(status), value = field === 'amount' ? 4 : `New ${field}`;
            const { after } = await changed(kind, job, { [field]: value });
            assert.equal((await managed(job.id, 7, {}, true)).status, 404);
            if (kind === 'core') assert.equal((await ai(job.id, after.state.requestId)).outcome, 'applied');
            else assert.equal((await manualHttp(await read(job.id), 'approve')).body.changed, true);
            assert.equal((await read(job.id)).statusCode, 'PS1');
        }
    });
    for (const kind of ['core', 'legacy']) await check(`Review lifecycle: ${kind} normalized no-ops preserve all three states and do not enqueue or cancel AI`, async () => {
        for (const status of ['PS1', 'PS2', 'PS3']) {
            const job = await make(status), before = await snapshot(job.id);
            const r = await write(kind, job, { amount: String(job.amount) }); assert.equal(r.body.errCode, 0);
            assert.equal(kind === 'core' ? r.body.data.editRevision : r.body.editRevision, job.editRevision);
            assert.deepEqual(await snapshot(job.id), before);
        }
    });
    for (const action of ['approve', 'reject', 'reopen']) await check(`Review lifecycle: Core metadata edit after manual ${action} starts its own generation without reviving an older decision`, async () => {
        const job = await make(), firstRequest = (await state(job.id)).requestId;
        if (action === 'reopen') await manualHttp(job, 'ban');
        assert.equal((await manualHttp(await read(job.id), action)).body.changed, true);
        const { after } = await changed('core', await read(job.id), { salaryJobCode: 'SAL2' });
        assert.notEqual(after.state.requestId, firstRequest);
        assert.equal((await ai(job.id, after.state.requestId, false)).outcome, 'applied'); assert.equal((await read(job.id)).statusCode, 'PS2');
    });
    await check('Review lifecycle: a manual ban blocks a metadata edit and late AI, while reopening alone does not start AI', async () => {
        const job = await make(), request = (await state(job.id)).requestId; await manualHttp(job, 'ban');
        const banned = await read(job.id), before = await snapshot(job.id);
        for (const kind of ['core', 'legacy']) assert.notEqual((await write(kind, banned, { amount: 4 })).body.errCode, 0);
        assert.equal((await ai(job.id, request)).outcome, 'stale'); assert.deepEqual(await snapshot(job.id), before);
        await manualHttp(banned, 'reopen'); const reopened = await snapshot(job.id);
        assert.equal(reopened.row.statusCode, 'PS3'); assert.equal(reopened.state.state, 'cancelled');
        assert.equal(reopened.events.filter(e => e.eventType === 'ai.moderate_job').length, 1);
    });
    await check('Review lifecycle: metadata A-to-B-to-A has three different request IDs even though AI title/HTML hashes are equal', async () => {
        const job = await make(), initial = await state(job.id);
        await changed('core', job, { amount: 4 }); const second = await state(job.id);
        const { after } = await changed('core', await read(job.id), { amount: job.amount });
        assert.equal(new Set([initial.requestId, second.requestId, after.state.requestId]).size, 3);
        assert.equal(initial.contentHash, after.state.contentHash);
        assert.equal((await ai(job.id, initial.requestId)).outcome, 'stale');
        assert.equal((await ai(job.id, second.requestId)).outcome, 'stale');
        assert.equal((await ai(job.id, after.state.requestId)).outcome, 'applied');
    });
    for (const kind of ['core', 'legacy']) await check(`Review lifecycle: ${kind} metadata edit and manual approval racing on one revision accept exactly one command`, async () => {
        const job = await make(), before = await snapshot(job.id);
        const results = await Promise.all([write(kind, job, { amount: 4 }), manualHttp(job, 'approve')]);
        assert.equal(results.filter(r => r.body.errCode === 0).length, 1); assert.equal(results.filter(r => r.status === 409).length, 1);
        const current = await read(job.id), request = await state(job.id);
        if (results[0].body.errCode === 0) assert.equal(current.statusCode, 'PS3');
        else { assert.equal(current.statusCode, 'PS1'); assert.equal(request.state, 'cancelled'); }
        assert.equal((await ai(job.id, before.state.requestId)).outcome, 'stale');
    });
    for (const kind of ['core', 'legacy']) await check(`Review lifecycle: ${kind} metadata edit racing with old AI cannot expose unreviewed metadata`, async () => {
        const job = await make(), old = await state(job.id);
        const [written, reviewed] = await Promise.all([write(kind, job, { amount: 4 }), ai(job.id, old.requestId)]);
        if (written.body.errCode === 0) {
            assert.equal(reviewed.outcome, 'stale'); assert.equal((await read(job.id)).statusCode, 'PS3');
            assert.equal((await read(job.id)).amount, 4);
        } else {
            assert.equal(written.status, 409); assert.equal(reviewed.outcome, 'applied');
            assert.equal((await read(job.id)).amount, job.amount);
        }
    });
    await check('Review lifecycle: 20 guarded metadata edits accept one generation; 20 unguarded identical writes collapse to one change', async () => {
        for (const guarded of [true, false]) {
            const job = await make(), before = await snapshot(job.id);
            const results = await Promise.all(Array.from({ length: 20 }, () => edit(job.id, { amount: 4, ...(guarded && { expectedRevision: job.editRevision }) })));
            assert.equal(results.filter(r => r.status === 200).length, guarded ? 1 : 20);
            assert.equal(results.filter(r => r.status === 409).length, guarded ? 19 : 0);
            const after = await snapshot(job.id); assert.notEqual(after.state.requestId, before.state.requestId);
            assert.deepEqual(after.counts, before.counts.map((n, i) => n + [0, 1, 2, 0][i])); assert.deepEqual(after.quota, before.quota);
        }
    });
    await check('Review lifecycle: metadata edit waiting on a post lock cannot overwrite a committed manual decision', async () => {
        const job = await make(), conn = await pool.getConnection(); let pending;
        try {
            await conn.beginTransaction(); await conn.query('SELECT id FROM posts WHERE id = ? FOR UPDATE', [job.id]);
            pending = write('core', job, { amount: 4 }); await waitForRowWait();
            // Synthetic competing state transition; the lock/current read and
            // revision, not a pre-lock snapshot, decide whether the edit can run.
            await conn.query("UPDATE posts SET statusCode = 'PS2' WHERE id = ?", [job.id]); await conn.commit();
            assert.equal((await pending).status, 409); assert.equal((await read(job.id)).amount, job.amount);
        } finally { await conn.rollback(); conn.release(); await pending; }
    });
    for (const stage of ['detail', 'post', 'state', 'update-event', 'ai-event']) await check(`Review lifecycle: metadata ${stage} failure rolls back snapshot/state/events and leaves the old pending request valid`, async () => {
        const job = await make(), before = await snapshot(job.id);
        const table = { detail: 'detailposts', post: 'posts', state: 'job_moderation_state', 'update-event': 'outbox_events', 'ai-event': 'outbox_events' }[stage];
        const operation = ['post', 'state'].includes(stage) ? 'UPDATE' : 'INSERT';
        const condition = stage.endsWith('event') ? `IF NEW.eventType = '${stage === 'ai-event' ? 'ai.moderate_job' : 'job.updated'}' THEN ` : '';
        await pool.query(`CREATE TRIGGER fail_edit_review BEFORE ${operation} ON ${table} FOR EACH ROW
            BEGIN ${condition}SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic review rollback'; ${condition ? 'END IF;' : ''} END`);
        try { assert.equal((await write('core', job, { amount: 4 })).status, 500); assert.deepEqual(await snapshot(job.id), before); }
        finally { await pool.query('DROP TRIGGER fail_edit_review'); }
        assert.equal((await ai(job.id, before.state.requestId)).outcome, 'applied');
        assert.equal((await read(job.id)).amount, job.amount);
    });
    await check('Review lifecycle: lost Core metadata edit response does not cause a second review; stale retry conflicts and a current no-op is silent', async () => {
        const job = await make(), patch = { amount: 4, expectedRevision: job.editRevision };
        await assert.rejects(edit(job.id, patch, 7, { 'x-test-drop-response': '1' }), /fetch failed|socket|other side closed/i);
        const before = await snapshot(job.id); assert.equal((await edit(job.id, patch)).status, 409);
        const current = await read(job.id); assert.equal((await write('core', current, { amount: 4 })).status, 200);
        assert.deepEqual(await snapshot(job.id), before);
    });
    await check('Review lifecycle: legacy-created manual PS3 stays manual on no-op; a real Core edit starts its first AI request', async () => {
        await pool.query('UPDATE companies SET allowPost = 100 WHERE id = 3');
        const r = await legacyCreateHttp(); assert.equal(r.body.errCode, 0);
        const job = await read(r.body.postId); assert.equal(await state(job.id), undefined);
        const before = await snapshot(job.id); assert.equal((await write('core', job, { amount: job.amount })).status, 200);
        assert.deepEqual(await snapshot(job.id), before);
        assert.equal((await write('core', job, { amount: 4 })).status, 200); assert.equal((await state(job.id)).state, 'pending');
        assert.equal((await events(job.id)).filter(e => e.eventType === 'ai.moderate_job').length, 1);
    });
};
