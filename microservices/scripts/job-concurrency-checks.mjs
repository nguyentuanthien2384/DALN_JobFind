import assert from 'node:assert/strict';
import { jobRevision } from '../shared/jobRevision.js';
import { DETAIL_FIELDS } from '../job-core-service/src/libs/jobEdit.js';

// Called only by the owned disposable MySQL fixture; never a live-database runner.
export const runJobConcurrencyChecks = async ({ pool, check, core, managed, edit, legacy, counts, balance, waitForRowWait }) => {
    await pool.query('UPDATE companies SET allowPost = 100, allowHotPost = 100 WHERE id = 3');
    const make = async () => {
        const result = await core(0, 8);
        assert.equal(result.status, 201, JSON.stringify(result));
        return result.id;
    };
    const read = async id => {
        const response = await managed(id);
        assert.equal(response.status, 200, JSON.stringify(response));
        assert.match(response.body.data.editRevision, /^jv1-[a-f0-9]{64}$/);
        return response.body.data;
    };
    const raw = async id => (await pool.query('SELECT * FROM posts WHERE id = ?', [id]))[0][0];
    const write = async (kind, baseline, patch = {}, userId = 7) => {
        if (kind === 'core') {
            const result = await edit(baseline.id, { ...patch, expectedRevision: baseline.editRevision }, userId);
            return { ok: result.status === 200, conflict: result.status === 409 && result.body.conflict === true,
                revision: result.body.data?.editRevision, body: result.body };
        }
        const result = await legacy.handleUpdatePost({ ...Object.fromEntries(DETAIL_FIELDS.map(field => [field, baseline[field]])),
            timeEnd: baseline.timeEnd, ...patch, id: baseline.id, userId, expectedRevision: baseline.editRevision },
        { roleCode: 'COMPANY', companyId: 3 });
        return { ok: result.errCode === 0, conflict: result.errCode === 4 && result.conflict === true,
            revision: result.editRevision, body: result };
    };
    const unchanged = async (before, quota) => { assert.deepEqual(await counts(), before); assert.deepEqual(await balance(), quota); };

    await check('managed revision is canonical with raw SQL and round-trips through both writers', async () => {
        const id = await make(), first = await read(id), post = await raw(id);
        const [[detail]] = await pool.query('SELECT * FROM detailposts WHERE id = ?', [post.detailPostId]);
        assert.equal(first.editRevision, jobRevision(post, detail));
        for (const kind of ['legacy', 'core']) {
            const baseline = await read(id);
            const result = await write(kind, baseline, { name: `Changed via ${kind}` });
            assert.equal(result.ok, true, JSON.stringify(result));
            assert.notEqual(result.revision, baseline.editRevision);
            assert.equal((await read(id)).editRevision, result.revision);
        }
    });

    for (const kind of ['legacy', 'core']) {
        await check(`${kind} matching no-op retains revision, timestamps, balances and event counts`, async () => {
            const id = await make(), baseline = await read(id), post = await raw(id), before = await counts(), quota = await balance();
            const result = await write(kind, baseline, { name: baseline.name });
            assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.revision, baseline.editRevision);
            assert.deepEqual(await raw(id), post); await unchanged(before, quota);
        });
        await check(`${kind} rejects stale full forms and stale no-ops after another writer without a new snapshot/event`, async () => {
            const id = await make(), baseline = await read(id);
            assert.equal((await write(kind === 'core' ? 'legacy' : 'core', baseline, { name: 'Accepted other edit' })).ok, true);
            const current = await read(id), before = await counts(), quota = await balance();
            for (const name of [baseline.name, current.name]) {
                assert.equal((await write(kind, { ...current, editRevision: baseline.editRevision }, { name })).conflict, true);
            }
            assert.deepEqual(await read(id), current); await unchanged(before, quota);
        });
        await check(`${kind} checks revision after waiting for an actual row lock and sees a committed status change`, async () => {
            const id = await make(), baseline = await read(id), before = await counts(), quota = await balance();
            const blocker = await pool.getConnection(); let pending;
            try {
                await blocker.beginTransaction();
                await blocker.query("UPDATE posts SET statusCode = 'PS2' WHERE id = ?", [id]);
                pending = write(kind, baseline, { name: 'Must not overwrite moderation' });
                await waitForRowWait(); await blocker.commit();
                assert.equal((await pending).conflict, true);
                assert.equal((await read(id)).statusCode, 'PS2'); await unchanged(before, quota);
            } finally { await blocker.rollback(); blocker.release(); await pending; }
        });
    }

    for (const kinds of [['core', 'core'], ['core', 'legacy'], ['legacy', 'core'], ['legacy', 'legacy']]) {
        await check(`${kinds.join('/')} concurrent guarded writes from company colleagues accept exactly one intent`, async () => {
            const id = await make(), baseline = await read(id), before = await counts(), quota = await balance();
            const blocker = await pool.getConnection(); let pending = [];
            try {
                await blocker.beginTransaction(); await blocker.query('SELECT id FROM companies WHERE id = 3 FOR UPDATE');
                pending = kinds.map((kind, index) => write(kind, baseline, { name: `Concurrent intent ${index}` }, 7 + index));
                await waitForRowWait(); await blocker.commit();
                const results = await Promise.all(pending);
                assert.equal(results.filter(result => result.ok).length, 1, JSON.stringify(results));
                assert.equal(results.filter(result => result.conflict).length, 1, JSON.stringify(results));
                const accepted = results.findIndex(result => result.ok), after = await read(id);
                assert.equal(after.name, `Concurrent intent ${accepted}`); assert.equal(after.editRevision, results[accepted].revision);
                assert.equal(after.userId, 8);
                assert.deepEqual((await counts()).map((n, i) => n - before[i]), [0, 1, kinds[accepted] === 'core' ? 2 : 0, 0]);
                assert.deepEqual(await balance(), quota);
            } finally { await blocker.rollback(); blocker.release(); await Promise.allSettled(pending); }
        });
    }

    await check('content A-to-B-to-A still invalidates the initial token through immutable detail identity', async () => {
        const id = await make(), first = await read(id);
        assert.equal((await write('core', first, { name: 'B' })).ok, true);
        assert.equal((await write('legacy', await read(id), { name: first.name })).ok, true);
        assert.notEqual((await read(id)).editRevision, first.editRevision);
        assert.equal((await write('core', first, { amount: 4 })).conflict, true);
    });

    await check('outbox failure rolls back the snapshot and revision so the original precondition remains valid', async () => {
        const id = await make(), baseline = await read(id), post = await raw(id), before = await counts(), quota = await balance();
        await pool.query("CREATE TRIGGER fail_revision_outbox BEFORE INSERT ON outbox_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic revision rollback'");
        try {
            const result = await edit(id, { name: 'Rolled back', expectedRevision: baseline.editRevision });
            assert.equal(result.status, 500); assert.deepEqual(await raw(id), post);
            assert.equal((await read(id)).editRevision, baseline.editRevision); await unchanged(before, quota);
        } finally { await pool.query('DROP TRIGGER fail_revision_outbox'); }
        assert.equal((await write('legacy', baseline, { name: 'Allowed after rollback' })).ok, true);
    });

    await check('lost success response does not make retry safe: stale retry conflicts and GET reconciles the committed state', async () => {
        const id = await make(), baseline = await read(id);
        const patch = { name: 'Committed before connection loss', expectedRevision: baseline.editRevision };
        await assert.rejects(edit(id, patch, 7, { 'x-test-drop-response': '1' }));
        const before = await counts(), quota = await balance();
        const retry = await edit(id, patch);
        assert.equal(retry.status, 409); assert.equal(retry.body.conflict, true);
        const current = await read(id); assert.equal(current.name, patch.name);
        assert.notEqual(current.editRevision, baseline.editRevision); await unchanged(before, quota);
    });

    await check('correct or forged revisions cannot bypass company ownership and malformed tokens cannot write', async () => {
        const id = await make(), baseline = await read(id), before = await counts(), quota = await balance();
        for (const expectedRevision of [baseline.editRevision, 'jv1-' + '0'.repeat(64)]) {
            const result = await edit(id, { name: 'Foreign', expectedRevision }, 99, { 'x-company-id': '4' });
            assert.equal(result.status, 403); assert.equal(result.body.conflict, undefined);
        }
        for (const expectedRevision of [null, '', {}, 'jv2-' + 'a'.repeat(64)]) {
            assert.equal((await edit(id, { name: 'Bad token', expectedRevision })).status, 400);
        }
        await unchanged(before, quota);
    });

    await check('old API compatibility is explicit: an unconditional writer can still edit, but invalidates guarded old forms', async () => {
        const id = await make(), baseline = await read(id);
        assert.equal((await edit(id, { name: 'Old client without a token' })).status, 200);
        assert.equal((await write('legacy', baseline, { name: 'Stale draft' })).conflict, true);
    });
};
