import assert from 'node:assert/strict';

// Runs only in the owned disposable MySQL/loopback HTTP fixture. Does not start
// a relay, broker connection, Search indexer, Socket.IO server or provider worker.
export const runManualSearchOutboxChecks = async ({ pool, check, make, read, post, state, notes, decide,
    legacyEdit, manualHttp, counts, balance, untouched, waitForRowWait }) => {
    const events = async id => (await pool.query('SELECT * FROM outbox_events WHERE aggregateId = ? ORDER BY id', [String(id)]))[0];
    const updates = async id => (await events(id)).filter(row => row.aggregateType === 'legacy-job');
    for (const eventType of ['job.updated', 'notification.manual_moderation_requested']) {
        await check(`failure writing ${eventType} rolls back BOTH search and notification intents with status/note/AI fence`, async () => {
            const id = await make(), baseline = await read(id), original = await post(id), request = await state(id), before = await counts(), quota = await balance();
            await pool.query(`CREATE TRIGGER fail_manual_event BEFORE INSERT ON outbox_events FOR EACH ROW
                BEGIN IF NEW.eventType = '${eventType}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic search rollback'; END IF; END`);
            try {
                await assert.rejects(decide(baseline, 'approve'), /synthetic search rollback/);
                await untouched(id, original, request, before, quota);
                assert.equal((await updates(id)).length, 0);
            } finally { await pool.query('DROP TRIGGER fail_manual_event'); }
        });
    }
    await check('manual event takes company context from the current locked row after waiting, never an old consistent-read snapshot', async () => {
        const id = await make(), baseline = await read(id), before = await counts();
        const [[original]] = await pool.query('SELECT name, thumbnail, statusCode, censorCode FROM companies WHERE id = 3');
        const blocker = await pool.getConnection(); let pending;
        try {
            await blocker.beginTransaction();
            await blocker.query('SELECT id FROM companies WHERE id = 3 FOR UPDATE');
            pending = decide(baseline, 'approve');
            await waitForRowWait();
            assert.deepEqual(await counts(), before); // nothing escapes the uncommitted decision
            await blocker.query("UPDATE companies SET name = 'After lock wait', thumbnail = 'new-logo', statusCode = 'S2', censorCode = 'CS2' WHERE id = 3");
            await blocker.commit();
            assert.equal((await pending).errCode, 0); // ADMIN decision does not approve/unban the company
            const [row] = await updates(id);
            assert.equal(row.eventType, 'job.updated');
            const { job } = JSON.parse(row.payload);
            assert.equal(job.companyName, 'After lock wait'); assert.equal(job.companyLogo, 'new-logo');
            assert.equal(job.companyStatusCode, 'S2'); assert.equal(job.companyCensorCode, 'CS2'); assert.equal(job.statusCode, 'PS1');
        } finally {
            await blocker.rollback(); blocker.release(); await pending;
            await pool.query('UPDATE companies SET name = ?, thumbnail = ?, statusCode = ?, censorCode = ? WHERE id = 3',
                [original.name, original.thumbnail, original.statusCode, original.censorCode]);
        }
    });
    await check('a saved manual update stays immutable after later editing and another decision, each with its own event identity', async () => {
        const id = await make(); await decide(await read(id), 'approve');
        const [approved] = await updates(id); const before = JSON.parse(approved.payload);
        assert.equal((await legacyEdit(await read(id), { name: 'Later edited title', amount: 9 })).changed, true);
        await decide(await read(id), 'ban');
        const rows = await updates(id); assert.equal(rows.length, 2);
        assert.deepEqual(rows.find(row => row.id === approved.id), approved);
        const banned = rows.find(row => row.id !== approved.id);
        assert.equal(JSON.parse(banned.payload).job.name, 'Later edited title');
        assert.equal(JSON.parse(banned.payload).job.statusCode, 'PS4');
        assert.equal(before.job.statusCode, 'PS1'); assert.equal(before.job.name, 'Synthetic developer');
        assert.equal(rows.every(row => row.publishedAt === null && row.attempts === 0 && row.lockToken === null), true);
    });
    for (const action of ['approve', 'reject', 'ban', 'reopen']) {
        await check(`actual manual ${action} HTTP response loss still leaves one search event; stale retry/no-op never duplicate it`, async () => {
            const id = await make(); if (action === 'reopen') await decide(await read(id), 'ban');
            const baseline = await read(id), before = await counts(), oldEvents = await events(id), oldNotes = await notes(id);
            await assert.rejects(manualHttp(baseline, action, { drop: true }), /fetch failed|socket|other side closed/i);
            const rows = await events(id), fresh = rows.filter(row => !oldEvents.some(old => old.id === row.id));
            assert.equal(fresh.length, 2);
            assert.equal(fresh.filter(row => row.eventType === 'job.updated' && row.aggregateType === 'legacy-job').length, 1);
            assert.equal(fresh.filter(row => row.eventType === 'notification.manual_moderation_requested').length, 1);
            assert.equal((await notes(id)).length, oldNotes.length + 1);
            assert.equal((await notes(id)).at(-1).userId, 88); // spoofed body is not the actor
            assert.equal((await manualHttp(baseline, action)).status, 409);
            const noop = await manualHttp(await read(id), action);
            assert.equal(noop.status, 200); assert.equal(noop.body.changed, false);
            assert.deepEqual(await events(id), rows);
            assert.deepEqual(await counts(), before.map((n, index) => n + (index === 2 ? 2 : 0)));
        });
    }
};
