import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Reuses the disposable fixture owned/cleaned by test-posting-quota.mjs. No
// standalone DB settings or server entrypoints: these are actual writer checks.
export const runJobEditChecks = async ({ pool, check, core, edit, legacy, oldReup, counts, balance, waitForRowWait }) => {
    const { loadJobForEvent } = await import('../job-core-service/src/controllers/jobController.js');
    const { handleAiResult } = await import('../job-core-service/src/libs/aiResultHandler.js');
    const { DETAIL_FIELDS } = await import('../job-core-service/src/libs/jobEdit.js');
    const read = async id => (await pool.query('SELECT * FROM posts WHERE id = ?', [id]))[0][0];
    const details = async id => (await pool.query('SELECT * FROM detailposts WHERE id = ?', [id]))[0][0];
    const state = async id => (await pool.query('SELECT * FROM job_moderation_state WHERE jobId = ?', [id]))[0][0];
    const snapshot = async id => loadJobForEvent(id, pool);
    const make = async () => {
        const result = await core(0, 8);
        assert.equal(result.status, 201, JSON.stringify(result.body));
        return result.id;
    };
    const legacyEdit = async (id, patch = {}, identity = { roleCode: 'COMPANY', companyId: 3 }) => {
        const job = await snapshot(id);
        return legacy.handleUpdatePost({ ...Object.fromEntries(DETAIL_FIELDS.map(field => [field, job[field]])),
            timeEnd: job.timeEnd, ...patch, id, userId: 7 }, identity);
    };
    const delta = async before => (await counts()).map((value, i) => value - before[i]);
    const sameWrites = async (before, quota) => {
        assert.deepEqual(await counts(), before);
        assert.deepEqual(await balance(), quota);
    };
    await pool.query('UPDATE companies SET allowPost = 100, allowHotPost = 100 WHERE id = 3');

    await check('editing shared content changes only the target, preserves author/paid fields and writes the new snapshot to the outbox', async () => {
        const id = await make();
        await pool.query("UPDATE posts SET timeEnd = '1700000000000' WHERE id = ?", [id]);
        const sibling = (await oldReup(id, 9)).id;
        const original = await read(id);
        const originalDetail = await details(original.detailPostId);
        const siblingBefore = await snapshot(sibling);
        const quota = await balance();
        const before = await counts();
        const result = await edit(id, { name: 'Changed target', descriptionHTML: '<p>New work</p>', genderPostCode: 'G2', timeEnd: Number(original.timeEnd) });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        const after = await read(id);
        assert.notEqual(after.detailPostId, original.detailPostId);
        for (const field of ['id', 'userId', 'isHot', 'timeEnd', 'timePost', 'createdAt']) assert.deepEqual(after[field], original[field]);
        assert.deepEqual(await details(original.detailPostId), originalDetail);
        assert.deepEqual(await snapshot(sibling), siblingBefore);
        assert.equal(result.body.data.genderPostCode, 'G2');
        assert.equal(result.body.data.userId, 8);
        const [[event]] = await pool.query("SELECT payload FROM outbox_events WHERE aggregateId = ? AND eventType = 'job.updated'", [String(id)]);
        const { editRevision, ...eventJob } = result.body.data;
        assert.match(editRevision, /^jv1-[a-f0-9]{64}$/);
        assert.deepEqual(JSON.parse(event.payload).job, eventJob);
        assert.deepEqual(await delta(before), [0, 1, 2, 0]);
        assert.deepEqual(await balance(), quota);
    });

    await check('metadata edits clear nullable fields, preserve omitted fields and do not restart moderation', async () => {
        const id = await make();
        const previousState = await state(id);
        const original = await snapshot(id);
        const before = await counts();
        const result = await edit(id, { amount: '3', genderPostCode: null, addressCode: null, descriptionMarkdown: '' });
        assert.equal(result.status, 200);
        assert.equal(result.body.data.amount, 3);
        assert.equal(result.body.data.genderPostCode, null);
        assert.equal(result.body.data.addressCode, null);
        assert.equal(result.body.data.descriptionMarkdown, '');
        for (const field of ['name', 'descriptionHTML', 'salaryJobCode', 'categoryJobCode']) assert.equal(result.body.data[field], original[field]);
        assert.deepEqual(await state(id), previousState);
        assert.deepEqual(await delta(before), [0, 1, 1, 0]);
    });

    await check('an identical full form including an expired deadline is a true no-op', async () => {
        const id = await make();
        await pool.query("UPDATE posts SET timeEnd = '1700000000000', statusCode = 'PS1' WHERE id = ?", [id]);
        const job = await snapshot(id);
        const post = await read(id);
        const previousState = await state(id);
        const quota = await balance();
        const before = await counts();
        const patch = { ...Object.fromEntries(DETAIL_FIELDS.map(field => [field, job[field]])), amount: String(job.amount), timeEnd: Number(job.timeEnd) };
        assert.equal((await edit(id, patch)).status, 200);
        assert.deepEqual(await read(id), post);
        assert.deepEqual(await state(id), previousState);
        await sameWrites(before, quota);
        const old = await legacyEdit(id);
        assert.equal(old.errCode, 0);
        assert.equal(old.changed, false);
        assert.deepEqual(await read(id), post);
        await sameWrites(before, quota);
    });

    await check('both writers refuse deadline changes before editing content; invalid HTTP fields are rejected', async () => {
        const id = await make();
        const original = await snapshot(id);
        const quota = await balance();
        const before = await counts();
        for (const timeEnd of [Number(original.timeEnd) + 1, Number(original.timeEnd) - 1]) {
            assert.equal((await edit(id, { timeEnd, name: 'Must not persist' })).status, 409);
            assert.equal((await legacyEdit(id, { timeEnd, name: 'Must not persist' })).errCode, 2);
        }
        for (const patch of [{ timeEnd: null }, { timeEnd: '2027-01-01' }, { isHot: 1 }, { userId: 99 }, { statusCode: 'PS1' }, { genderPostCode: {} }]) {
            assert.equal((await edit(id, patch)).status, 400);
        }
        assert.deepEqual(await snapshot(id), original);
        await sameWrites(before, quota);
    });

    await check('legacy edit forks content atomically, preserves the original author and cannot modify a re-post sibling', async () => {
        const id = await make();
        await pool.query("UPDATE posts SET timeEnd = '1700000000000' WHERE id = ?", [id]);
        const sibling = (await oldReup(id, 9)).id;
        const original = await read(id);
        const siblingBefore = await snapshot(sibling);
        const quota = await balance();
        const before = await counts();
        const result = await legacyEdit(id, { name: 'Legacy new title', genderPostCode: 'G2' });
        assert.equal(result.errCode, 0, JSON.stringify(result));
        assert.equal(result.changed, true);
        const post = await read(id);
        assert.notEqual(post.detailPostId, original.detailPostId);
        for (const field of ['userId', 'timeEnd', 'timePost', 'isHot', 'createdAt']) assert.deepEqual(post[field], original[field]);
        assert.equal(post.statusCode, 'PS3');
        assert.deepEqual(await snapshot(sibling), siblingBefore);
        assert.equal((await snapshot(id)).genderPostCode, 'G2');
        assert.deepEqual(await delta(before), [0, 1, 1, 0]);
        assert.deepEqual(await balance(), quota);
    });

    await check('current roles/ownership block cross-company edits while ADMIN can edit without transferring authorship', async () => {
        const id = await make();
        const before = await counts();
        const quota = await balance();
        assert.equal((await edit(id, { name: 'Denied' }, 99)).status, 403);
        assert.equal((await edit(id, { name: 'Denied' }, 7, { 'x-user-role': 'CANDIDATE' })).status, 403);
        assert.equal((await legacyEdit(id, { roleCode: 'ADMIN' }, { roleCode: 'EMPLOYER', companyId: 4 })).errCode, 2);
        await sameWrites(before, quota);
        assert.equal((await edit(id, { name: 'Admin edit' }, 88, { 'x-user-role': 'ADMIN', 'x-company-id': '' })).status, 200);
        assert.equal((await read(id)).userId, 8);
        assert.equal((await legacyEdit(id, { name: 'Legacy admin edit' }, { roleCode: 'ADMIN', companyId: null })).errCode, 0);
        assert.equal((await read(id)).userId, 8);
        assert.deepEqual(await balance(), quota);
    });

    await check('missing, removed and blocked-company jobs are not modified', async () => {
        const id = await make();
        const before = await counts();
        const quota = await balance();
        assert.equal((await edit(999999, { name: 'Denied' })).status, 404);
        await pool.query("UPDATE posts SET statusCode = 'PS4' WHERE id = ?", [id]);
        assert.equal((await edit(id, { name: 'Denied' })).status, 409);
        assert.equal((await legacyEdit(id)).errCode, 2);
        await pool.query("UPDATE posts SET statusCode = 'PS3' WHERE id = ?", [id]);
        await pool.query("UPDATE companies SET censorCode = 'CS2' WHERE id = 3");
        try {
            assert.equal((await edit(id, { name: 'Denied' })).status, 403);
            assert.equal((await legacyEdit(id)).errCode, 2);
        } finally { await pool.query("UPDATE companies SET censorCode = 'CS1' WHERE id = 3"); }
        await sameWrites(before, quota);
    });

    for (const [table, operation] of [['detailposts', 'INSERT'], ['posts', 'UPDATE'], ['outbox_events', 'INSERT'], ['job_moderation_state', 'UPDATE']]) {
        await check(`core edit rollback covers a real ${table} failure including the previous moderation request`, async () => {
            const id = await make();
            const before = await counts();
            const original = await snapshot(id);
            const oldPost = await read(id);
            const oldState = await state(id);
            const quota = await balance();
            await pool.query(`CREATE TRIGGER fail_edit AFTER ${operation} ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic edit failure'`);
            try {
                const result = await edit(id, { name: 'Must roll back' });
                assert.equal(result.status, 500);
                assert.equal(JSON.stringify(result.body).includes('synthetic edit failure'), false);
                assert.deepEqual(await snapshot(id), original);
                assert.deepEqual(await read(id), oldPost);
                assert.deepEqual(await state(id), oldState);
                await sameWrites(before, quota);
                if (['detailposts', 'posts', 'outbox_events', 'job_moderation_state'].includes(table)) {
                    await assert.rejects(legacyEdit(id, { name: 'Must roll back' }), /synthetic edit failure/);
                    assert.deepEqual(await snapshot(id), original);
                    assert.deepEqual(await read(id), oldPost);
                    assert.deepEqual(await state(id), oldState);
                    await sameWrites(before, quota);
                }
            } finally { await pool.query('DROP TRIGGER fail_edit'); }
        });
    }

    await check('20 concurrent identical edits create one detail snapshot and one new moderation request', async () => {
        const id = await make();
        const before = await counts();
        const quota = await balance();
        const results = await Promise.all(Array.from({ length: 20 }, (_, i) => edit(id, { name: 'Same intent', amount: '3' }, 7 + i)));
        assert.ok(results.every(result => result.status === 200), JSON.stringify(results));
        assert.ok(results.every(result => result.body.data.name === 'Same intent' && result.body.data.amount === 3),
            JSON.stringify(results.map(result => ({ name: result.body.data.name, amount: result.body.data.amount }))));
        assert.deepEqual(await delta(before), [0, 1, 2, 0]);
        assert.deepEqual(await balance(), quota);
    });

    await check('concurrent partial edits preserve both changes instead of replacing fields from an old snapshot', async () => {
        const id = await make();
        const results = await Promise.all([edit(id, { amount: 4 }, 7), edit(id, { genderPostCode: 'G2' }, 9)]);
        assert.ok(results.every(result => result.status === 200));
        const job = await snapshot(id);
        assert.equal(job.amount, 4);
        assert.equal(job.genderPostCode, 'G2');
    });

    await check('concurrent re-post/edit sees a whole old or new snapshot, and later edits never change the new sibling', async () => {
        for (const writer of ['core', 'legacy']) {
            const id = await make();
            await pool.query("UPDATE posts SET timeEnd = '1700000000000' WHERE id = ?", [id]);
            const previous = await snapshot(id);
            const patch = { name: 'Phase one', descriptionHTML: '<p>Phase one</p>' };
            const [updated, sibling] = await Promise.all([
                writer === 'core' ? edit(id, patch) : legacyEdit(id, patch), oldReup(id, 9)
            ]);
            assert.equal(writer === 'core' ? updated.status : updated.errCode, writer === 'core' ? 200 : 0);
            assert.ok(sibling.ok);
            const shared = await snapshot(sibling.id);
            assert.ok((shared.name === previous.name && shared.descriptionHTML === previous.descriptionHTML)
                || (shared.name === patch.name && shared.descriptionHTML === patch.descriptionHTML));
            assert.equal((await edit(id, { name: 'Phase two' })).status, 200);
            assert.deepEqual(await snapshot(sibling.id), shared);
        }
    });

    await check('old AI results cannot approve changed content; current result can, metadata edits retain that decision', async () => {
        const id = await make();
        const oldRequest = await state(id);
        assert.equal((await edit(id, { name: 'Needs new review' })).status, 200);
        const current = await state(id);
        assert.notEqual(current.requestId, oldRequest.requestId);
        const apply = requestId => handleAiResult({ type: 'moderate_job', jobId: id, moderationRequestId: requestId, ok: true,
            result: { approved: true, reason: 'Synthetic result; no AI call' } }, { eventId: randomUUID(), aggregateId: String(id) });
        assert.equal((await apply(oldRequest.requestId)).outcome, 'stale');
        assert.equal((await read(id)).statusCode, 'PS3');
        assert.equal((await apply(current.requestId)).outcome, 'applied');
        assert.equal((await read(id)).statusCode, 'PS1');
        const before = await counts();
        const decision = await state(id);
        assert.equal((await edit(id, { genderPostCode: 'G2' })).status, 200);
        assert.equal((await read(id)).statusCode, 'PS1');
        assert.deepEqual(await state(id), decision);
        assert.deepEqual(await delta(before), [0, 1, 1, 0]);
    });

    for (const writer of ['core', 'legacy']) {
        await check(`${writer} edit rereads author membership after a real lock wait`, async () => {
            const id = await make();
            const before = await counts();
            const quota = await balance();
            const originalPost = await read(id);
            const blocker = await pool.getConnection();
            let pending;
            try {
                await blocker.beginTransaction();
                await blocker.query('UPDATE users SET companyId = 4 WHERE id = 8');
                pending = writer === 'core' ? edit(id, { name: 'Denied' }) : legacyEdit(id, { name: 'Denied' });
                await waitForRowWait();
                await blocker.commit();
                const result = await pending;
                assert.equal(writer === 'core' ? result.status : result.errCode, writer === 'core' ? 403 : 2);
                assert.deepEqual(await read(id), originalPost);
                await sameWrites(before, quota);
            } finally {
                await blocker.rollback(); blocker.release();
                await pending;
                await pool.query('UPDATE users SET companyId = 3 WHERE id = 8');
            }
        });
    }

    await check('a post author changed after the preliminary read causes conflict, not cross-tenant modification', async () => {
        const id = await make();
        const before = await counts();
        const blocker = await pool.getConnection();
        let pending;
        try {
            await blocker.beginTransaction();
            await blocker.query('UPDATE posts SET userId = 99 WHERE id = ?', [id]);
            pending = edit(id, { name: 'Denied' });
            await waitForRowWait();
            await blocker.commit();
            assert.equal((await pending).status, 409);
            assert.deepEqual(await counts(), before);
        } finally {
            await blocker.rollback(); blocker.release();
            await pending;
            await pool.query('UPDATE posts SET userId = 8 WHERE id = ?', [id]);
        }
    });

    await check('edit writers fail closed for a nontransactional detail table before any mutation', async () => {
        const id = await make();
        const before = await counts();
        const quota = await balance();
        await pool.query('ALTER TABLE detailposts ENGINE=MyISAM');
        try {
            assert.equal((await edit(id, { name: 'Denied' })).status, 503);
            assert.equal((await legacyEdit(id, { name: 'Denied' })).errCode, 2);
            await sameWrites(before, quota);
        } finally { await pool.query('ALTER TABLE detailposts ENGINE=InnoDB'); }
    });
};
