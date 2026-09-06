import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { handleAiResult } from '../job-core-service/src/libs/aiResultHandler.js';
import { DETAIL_FIELDS } from '../job-core-service/src/libs/jobEdit.js';

// Only runs inside the owned disposable fixture. Calls the real transactional
// legacy writer directly, NEVER its post-commit SMTP/follower notification layer.
export const runManualModerationChecks = async ({ pool, check, core, managed, edit, legacy, moderateLegacyPost, counts, balance, waitForRowWait }) => {
    await pool.query(`CREATE TABLE notes (id INT AUTO_INCREMENT PRIMARY KEY, postId INT, userId INT,
        note VARCHAR(255), createdAt DATETIME, updatedAt DATETIME) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query('UPDATE companies SET allowPost = 100, allowHotPost = 100 WHERE id = 3');
    const make = async () => { const r = await core(0, 8); assert.equal(r.status, 201); return r.id; };
    const read = async id => { const r = await managed(id); assert.equal(r.status, 200); return r.body.data; };
    const post = async id => (await pool.query('SELECT * FROM posts WHERE id = ?', [id]))[0][0];
    const state = async id => (await pool.query('SELECT * FROM job_moderation_state WHERE jobId = ?', [id]))[0][0];
    const notes = async id => (await pool.query('SELECT * FROM notes WHERE postId = ? ORDER BY id', [id]))[0];
    const decide = (job, action, patch = {}, identity = { roleCode: 'ADMIN' }) => moderateLegacyPost({
        id: job.id, postId: job.id, userId: 88, note: 'Synthetic moderator decision', expectedRevision: job.editRevision, ...patch
    }, action, identity);
    const ai = (id, requestId, approved = true) => handleAiResult({ type: 'moderate_job', jobId: id, moderationRequestId: requestId,
        ok: true, result: { approved, reason: 'Synthetic AI result' } }, { eventId: randomUUID(), aggregateId: String(id) });
    const legacyEdit = (job, patch) => legacy.handleUpdatePost({ ...Object.fromEntries(DETAIL_FIELDS.map(field => [field, job[field]])),
        id: job.id, userId: 7, timeEnd: job.timeEnd, expectedRevision: job.editRevision, ...patch }, { roleCode: 'COMPANY', companyId: 3 });
    const untouched = async (id, original, request, before, quota, oldNotes = []) => {
        assert.deepEqual(await post(id), original); assert.deepEqual(await state(id), request);
        assert.deepEqual(await counts(), before); assert.deepEqual(await balance(), quota); assert.deepEqual(await notes(id), oldNotes);
    };

    for (const [action, target] of [['approve', 'PS1'], ['reject', 'PS2'], ['ban', 'PS4'], ['reopen', 'PS3']]) {
        await check(`manual ${action} commits status/note/AI fence atomically without quota/detail/event changes`, async () => {
            const id = await make();
            if (action === 'reopen') assert.equal((await decide(await read(id), 'ban')).errCode, 0);
            const baseline = await read(id), original = await post(id), before = await counts(), quota = await balance(), oldNotes = await notes(id);
            const result = await decide(baseline, action);
            assert.equal(result.errCode, 0, JSON.stringify(result)); assert.equal(result.changed, true);
            const current = await read(id);
            assert.equal(current.statusCode, target); assert.equal(current.editRevision, result.editRevision);
            assert.equal((await state(id)).state, 'cancelled');
            for (const field of ['detailPostId', 'userId', 'timeEnd', 'isHot', 'createdAt']) assert.deepEqual((await post(id))[field], original[field]);
            assert.equal((await notes(id)).length, oldNotes.length + 1);
            assert.equal((await notes(id)).at(-1).userId, 88);
            assert.deepEqual(await counts(), before); assert.deepEqual(await balance(), quota);
            assert.equal((await decide(baseline, action)).httpStatus, 409);
            const noop = await decide(current, action);
            assert.equal(noop.changed, false); assert.equal(noop.notification, undefined);
            assert.equal((await notes(id)).length, oldNotes.length + 1);
        });
    }
    await check('banning then reopening to manual PS3 cannot resurrect an old matching AI request', async () => {
        const id = await make(), request = await state(id);
        await decide(await read(id), 'ban'); await decide(await read(id), 'reopen');
        const before = await counts();
        assert.equal((await ai(id, request.requestId)).outcome, 'stale');
        assert.equal((await read(id)).statusCode, 'PS3'); assert.deepEqual(await counts(), before);
        assert.equal((await notes(id)).length, 2);
    });
    for (const decision of ['approve', 'reject']) {
        await check(`${decision} then a metadata-only legacy edit stays manual PS3 despite a late AI result`, async () => {
            const id = await make(), request = await state(id);
            await decide(await read(id), decision);
            assert.equal((await legacyEdit(await read(id), { amount: 4 })).errCode, 0);
            const before = await counts();
            assert.equal((await ai(id, request.requestId)).outcome, 'stale');
            assert.equal((await read(id)).statusCode, 'PS3'); assert.deepEqual(await counts(), before);
        });
    }
    await check('a legacy metadata edit alone cancels a pending AI request, while a true no-op leaves it pending', async () => {
        const id = await make(), request = await state(id), baseline = await read(id);
        assert.equal((await legacyEdit(baseline, {})).changed, false);
        assert.deepEqual(await state(id), request);
        assert.equal((await legacyEdit(baseline, { amount: 3 })).changed, true);
        assert.equal((await state(id)).state, 'cancelled');
        assert.equal((await ai(id, request.requestId)).outcome, 'stale');
    });
    await check('new content edited through Job Core starts a new request after manual moderation; only the new AI result applies', async () => {
        const id = await make(), old = await state(id);
        await decide(await read(id), 'reject');
        const current = await read(id);
        assert.equal((await edit(id, { name: 'New reviewed content', expectedRevision: current.editRevision })).status, 200);
        const fresh = await state(id); assert.notEqual(fresh.requestId, old.requestId); assert.equal(fresh.state, 'pending');
        assert.equal((await ai(id, old.requestId)).outcome, 'stale');
        assert.equal((await ai(id, fresh.requestId)).outcome, 'applied'); assert.equal((await read(id)).statusCode, 'PS1');
    });
    for (const writer of ['core', 'legacy']) {
        await check(`${writer} edits invalidate manual decisions from an old list, and manual decisions invalidate old edit forms`, async () => {
            const id = await make(), baseline = await read(id);
            if (writer === 'core') assert.equal((await edit(id, { name: 'Edited first', expectedRevision: baseline.editRevision })).status, 200);
            else assert.equal((await legacyEdit(baseline, { name: 'Edited first' })).errCode, 0);
            const before = await counts();
            assert.equal((await decide(baseline, 'approve')).httpStatus, 409); assert.deepEqual(await counts(), before);
            const current = await read(id); assert.equal((await decide(current, 'approve')).errCode, 0);
            if (writer === 'core') assert.equal((await edit(id, { amount: 5, expectedRevision: current.editRevision })).status, 409);
            else assert.equal((await legacyEdit(current, { amount: 5 })).conflict, true);
            assert.equal((await read(id)).statusCode, 'PS1'); assert.equal((await notes(id)).length, 1);
        });
    }
    for (const competitor of ['manual', 'core', 'ai']) {
        await check(`concurrent manual rejection versus ${competitor} accepts only one decision on the loaded state`, async () => {
            const id = await make(), baseline = await read(id), request = await state(id), quota = await balance();
            const blocker = await pool.getConnection(); let pending = [];
            try {
                await blocker.beginTransaction(); await blocker.query('SELECT id FROM posts WHERE id = ? FOR UPDATE', [id]);
                pending = [decide(baseline, 'reject'), competitor === 'manual' ? decide(baseline, 'approve', { userId: 9 })
                    : competitor === 'core' ? edit(id, { name: 'Concurrent edit', expectedRevision: baseline.editRevision }) : ai(id, request.requestId)];
                await waitForRowWait(); await blocker.commit();
                const [manual, other] = await Promise.all(pending);
                const otherWon = competitor === 'manual' ? other.errCode === 0 : competitor === 'core' ? other.status === 200 : other.outcome === 'applied';
                assert.equal(Number(manual.errCode === 0) + Number(otherWon), 1, JSON.stringify([manual, other]));
                if (manual.errCode !== 0) assert.equal(manual.httpStatus, 409);
                if (!otherWon) assert.equal(competitor === 'manual' ? other.httpStatus : competitor === 'core' ? other.status : other.outcome,
                    competitor === 'ai' ? 'stale' : 409);
                assert.equal((await notes(id)).length, competitor === 'manual' ? 1 : manual.errCode === 0 ? 1 : 0);
                assert.deepEqual(await balance(), quota);
            } finally { await blocker.rollback(); blocker.release(); await Promise.allSettled(pending); }
        });
    }
    for (const table of ['notes', 'posts', 'job_moderation_state']) {
        await check(`a real ${table} write failure rolls back manual status, note and AI cancellation`, async () => {
            const id = await make(), baseline = await read(id), original = await post(id), request = await state(id), before = await counts(), quota = await balance();
            await pool.query(`CREATE TRIGGER fail_manual_write BEFORE ${table === 'notes' ? 'INSERT' : 'UPDATE'} ON ${table}
                FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic manual rollback'`);
            try {
                await assert.rejects(decide(baseline, 'approve'), /synthetic manual rollback/);
                await untouched(id, original, request, before, quota);
            } finally { await pool.query('DROP TRIGGER fail_manual_write'); }
            assert.equal((await decide(baseline, 'approve')).errCode, 0);
        });
    }
    await check('unsafe notes/fence engines fail closed without changing post or request; legacy edits also cannot skip the fence', async () => {
        const id = await make(), baseline = await read(id), original = await post(id), request = await state(id), before = await counts(), quota = await balance();
        for (const table of ['notes', 'job_moderation_state']) {
            await pool.query(`ALTER TABLE ${table} ENGINE=MyISAM`);
            try {
                assert.equal((await decide(baseline, 'approve')).httpStatus, 503);
                if (table === 'job_moderation_state') assert.equal((await legacyEdit(baseline, { amount: 4 })).errCode, 2);
                await untouched(id, original, request, before, quota);
            } finally { await pool.query(`ALTER TABLE ${table} ENGINE=InnoDB`); }
        }
    });
    await check('missing/bad versions, spoofed roles, missing actors and illegal transitions cannot mutate or write notes', async () => {
        const id = await make(), baseline = await read(id), original = await post(id), request = await state(id), before = await counts(), quota = await balance();
        for (const [patch, identity, status] of [[{ expectedRevision: undefined }, { roleCode: 'ADMIN' }, 428],
            [{ expectedRevision: null }, { roleCode: 'ADMIN' }, 400], [{ note: ' ' }, { roleCode: 'ADMIN' }, 400],
            [{ note: 'a'.repeat(256) }, { roleCode: 'ADMIN' }, 400], [{ roleCode: 'ADMIN' }, { roleCode: 'EMPLOYER' }, 403],
            [{ userId: 99999 }, { roleCode: 'ADMIN' }, 403]]) {
            assert.equal((await decide(baseline, 'reject', patch, identity)).httpStatus, status);
        }
        assert.equal((await decide(baseline, 'invalid')).httpStatus, 400);
        await untouched(id, original, request, before, quota);
        await decide(baseline, 'ban');
        assert.equal((await decide(await read(id), 'approve')).httpStatus, 409);
        assert.equal((await decide(await read(id), 'reject')).httpStatus, 409);
        assert.equal((await read(id)).statusCode, 'PS4'); assert.equal((await notes(id)).length, 1);
    });
};
