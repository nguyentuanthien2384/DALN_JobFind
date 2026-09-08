import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { handleAiResult } from '../job-core-service/src/libs/aiResultHandler.js';
import { operationById } from '../shared/contracts/operations.js';
import { responseValidationSchema } from '../shared/contracts/responses.js';
import { createContractValidator } from '../shared/requestContract.js';

// Only invoked at the end of test-posting-quota's owned MySQL fixture. No live
// project DB, provider or relay. Real HTTP controllers/schema/SQL/AI result handler.
export const runJobWorkspaceChecks = async ({ pool, check, core, managed, edit, manualHttp, counts, balance, url, token }) => {
    assert.equal((await pool.query('SELECT DATABASE() AS name'))[0][0].name, 'jobfind_posting_quota_test');
    const validators = Object.fromEntries(['jobManageList', 'jobReviewGet'].map(id => [id, createContractValidator().compile(responseValidationSchema(operationById[id]))]));
    const read = async (path, headers = {}) => {
        const response = await fetch(url + path, { signal: AbortSignal.timeout(10000), headers: {
            'x-internal-secret': token, 'x-user-id': '7', 'x-user-role': 'EMPLOYER', 'x-company-id': '3',
            'x-company-status': 'S1', 'x-company-censor': 'CS1', ...headers
        } });
        const body = await response.json();
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        if (response.status === 200) {
            const validate = validators[path.startsWith('/manage') ? 'jobManageList' : 'jobReviewGet'];
            assert.ok(validate(body), JSON.stringify({ errors: validate.errors, body }));
        }
        return { status: response.status, body };
    };
    await pool.query('UPDATE companies SET allowPost = 100, allowHotPost = 100 WHERE id IN (3,4)');
    const prefix = `Workspace-${randomUUID().slice(0, 8)}`;
    const jobs = [];
    for (let index = 0; index < 7; index += 1) {
        const result = await core(0, index % 2 ? 7 : 8, {}, { name: `${prefix} ${index}` }); assert.equal(result.status, 201); jobs.push(result.id);
    }
    const foreign = await core(0, 99, { 'x-company-id': '4' }, { name: `${prefix} foreign` }); assert.equal(foreign.status, 201);
    await pool.query("UPDATE posts SET updatedAt = '2026-01-01', timeEnd = '1700000000000' WHERE id IN (?)", [jobs]);
    const query = `/manage?search=${prefix}`;
    await check('Workspace: real company list includes teammate/non-public/expired jobs with stable page/count and minimal identity', async () => {
        const before = await counts(), quota = await balance();
        const first = await read(query), second = await read(query + '&offset=5'), end = await read(query + '&offset=20');
        assert.equal(first.status, 200, JSON.stringify(first)); assert.equal(first.body.count, 7);
        assert.deepEqual([...first.body.data, ...second.body.data].map(row => row.id), [...jobs].reverse());
        assert.equal(end.body.count, 7); assert.deepEqual(end.body.data, []);
        assert.ok(first.body.data.every(row => row.companyId === 3 && row.timeEnd === '1700000000000'));
        assert.ok(!JSON.stringify(first.body).match(/password|email|descriptionHTML|requestId|contentHash|editRevision/));
        assert.deepEqual(await counts(), before); assert.deepEqual(await balance(), quota);
    });
    await check('Workspace: title/ID search and literal wildcard text never expand scope', async () => {
        const literal = `${prefix} 10%_!`;
        await pool.query('UPDATE detailposts d JOIN posts p ON p.detailPostId = d.id SET d.name = ? WHERE p.id = ?', [literal, jobs[0]]);
        const result = await read('/manage?search=' + encodeURIComponent('10%_!')); assert.equal(result.body.count, 1); assert.equal(result.body.data[0].id, jobs[0]);
        const exact = await read(`/manage?search=${jobs[6]}`); assert.ok(exact.body.data.some(row => row.id === jobs[6]));
        const escaped = await read('/manage?search=' + encodeURIComponent("' OR 1=1 --")); assert.equal(escaped.body.count, 0);
    });
    for (const status of ['PS1', 'PS2', 'PS3', 'PS4']) await check(`Workspace: scoped ${status} filter includes expired jobs without changing status`, async () => {
        await pool.query('UPDATE posts SET statusCode = ? WHERE id = ?', [status, jobs[1]]);
        const result = await read(query + `&statusCode=${status}&limit=50`); assert.equal(result.status, 200);
        assert.ok(result.body.data.every(row => row.statusCode === status)); assert.ok(result.body.data.some(row => row.id === jobs[1]));
    });
    await check('Workspace: stale membership, unapproved company and missing actor reveal neither notes nor counts', async () => {
        for (const change of [
            ['UPDATE users SET companyId = 4 WHERE id = 7', 'UPDATE users SET companyId = 3 WHERE id = 7'],
            ["UPDATE companies SET statusCode = 'S2' WHERE id = 3", "UPDATE companies SET statusCode = 'S1' WHERE id = 3"],
            ["UPDATE companies SET censorCode = 'CS3' WHERE id = 3", "UPDATE companies SET censorCode = 'CS1' WHERE id = 3"]
        ]) {
            await pool.query(change[0]);
            try {
                const list = await read(query), review = await read(`/${jobs[2]}/review`);
                assert.equal(list.status, 403); assert.ok(!Object.hasOwn(list.body, 'count')); assert.equal(review.status, 404);
            } finally { await pool.query(change[1]); }
        }
        assert.equal((await read(query, { 'x-user-id': '999999' })).status, 403);
        const outside = await read(`/${foreign.id}/review`), absent = await read('/999999/review');
        assert.equal(outside.status, 404); assert.deepEqual(outside.body, absent.body);
    });
    await check('Workspace: paginated manual history retains orphaned author and counts on empty pages without raw user fields', async () => {
        await pool.query('INSERT INTO notes (postId, userId, note, createdAt, updatedAt) VALUES ?',
            [Array.from({ length: 7 }, (_, index) => [jobs[2], index === 6 ? 999999 : 88, `${prefix} note ${index}`, '2026-01-01', '2026-01-01'])]);
        const a = await read(`/${jobs[2]}/review`), b = await read(`/${jobs[2]}/review?offset=5`), end = await read(`/${jobs[2]}/review?offset=20`);
        assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(a.body.data.count, 7);
        assert.deepEqual([...a.body.data.notes, ...b.body.data.notes].map(row => row.note), Array.from({ length: 7 }, (_, i) => `${prefix} note ${6 - i}`));
        assert.equal(a.body.data.notes[0].authorId, 999999); assert.equal(a.body.data.notes[0].authorFirstName, null);
        assert.deepEqual(end.body.data.notes, []); assert.equal(end.body.data.count, 7);
        assert.ok(!JSON.stringify(a.body).match(/password|email|descriptionHTML|requestId|contentHash/));
    });
    await check('Workspace: real Core request, AI application, manual cancellation, edit and failed AI remain distinct and reads never enqueue', async () => {
        const result = await core(0, 8, {}, { name: prefix + ' lifecycle' }); assert.equal(result.status, 201); const id = result.id;
        const state = async () => (await pool.query('SELECT requestId FROM job_moderation_state WHERE jobId = ?', [id]))[0][0].requestId;
        const current = async () => (await managed(id)).body.data;
        const summary = async () => {
            const before = await counts(), quota = await balance(); const r = await read(`/${id}/review`);
            assert.equal(r.status, 200); assert.deepEqual(await counts(), before); assert.deepEqual(await balance(), quota); return r.body.data;
        };
        assert.equal((await summary()).job.reviewState, 'ai_requested');
        const old = await state();
        await handleAiResult({ type: 'moderate_job', jobId: id, moderationRequestId: old, ok: true, result: { approved: false, reason: 'Synthetic private reason' } }, { eventId: randomUUID(), aggregateId: String(id) });
        const applied = await summary(); assert.equal(applied.job.reviewState, 'ai_applied'); assert.equal(applied.job.statusCode, 'PS2'); assert.equal(applied.notes.length, 0);
        assert.ok(!JSON.stringify(applied).includes('Synthetic private reason'));
        assert.equal((await manualHttp(await current(), 'approve')).body.errCode, 0);
        assert.equal((await summary()).job.reviewState, 'no_active_ai'); assert.equal((await summary()).notes.length, 1);
        assert.equal((await edit(id, { expectedRevision: (await current()).editRevision, amount: 2 })).status, 200);
        assert.equal((await summary()).job.reviewState, 'ai_requested');
        await handleAiResult({ type: 'moderate_job', jobId: id, moderationRequestId: old, ok: true, result: { approved: true } }, { eventId: randomUUID(), aggregateId: String(id) });
        assert.equal((await summary()).job.reviewState, 'ai_requested');
        await handleAiResult({ type: 'moderate_job', jobId: id, moderationRequestId: await state(), ok: false, error: 'Synthetic infrastructure failure' }, { eventId: randomUUID(), aggregateId: String(id) });
        const failed = await summary(); assert.equal(failed.job.reviewState, 'ai_failed'); assert.equal(failed.job.statusCode, 'PS3');
    });
    await check('Workspace: changed content and unknown request state do not assert AI processing of the current job', async () => {
        assert.equal((await read(`/${jobs[0]}/review`)).body.data.job.reviewState, 'untracked');
        await pool.query("UPDATE job_moderation_state SET state = 'future-state' WHERE jobId = ?", [jobs[3]]);
        assert.equal((await read(`/${jobs[3]}/review`)).body.data.job.reviewState, 'untracked');
    });
    await check('Workspace: missing optional source detail is shown safely, missing mandatory review table fails closed', async () => {
        await pool.query('UPDATE posts SET detailPostId = 999999 WHERE id = ?', [jobs[4]]);
        const list = await read(`/manage?search=${jobs[4]}`); assert.equal(list.status, 200); assert.equal(list.body.data.find(row => row.id === jobs[4]).name, null);
        const review = await read(`/${jobs[4]}/review`); assert.equal(review.status, 200); assert.equal(review.body.data.job.reviewState, 'untracked');
        await pool.query('RENAME TABLE notes TO workspace_saved_notes');
        try { assert.equal((await read(`/${jobs[2]}/review`)).status, 500); }
        finally { await pool.query('RENAME TABLE workspace_saved_notes TO notes'); }
    });
};
