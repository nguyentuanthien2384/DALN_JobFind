import assert from 'node:assert/strict';

export const runJobManagementChecks = async ({ pool, check, core, managed, edit, counts, balance }) => {
    await pool.query('UPDATE companies SET allowPost = 20, allowHotPost = 20 WHERE id = 3');
    const created = await core(1, 8);
    assert.equal(created.status, 201, JSON.stringify(created));
    const id = created.id;
    const before = await counts(), balances = await balance();
    for (const status of ['PS1', 'PS2', 'PS3', 'PS4']) {
        await check(`private read exposes ${status} only within authorized management scope; public policy is unchanged`, async () => {
            await pool.query('UPDATE posts SET statusCode = ? WHERE id = ?', [status, id]);
            for (const role of ['COMPANY', 'EMPLOYER', 'ADMIN']) {
                const result = await managed(id, 7, { 'x-user-role': role });
                assert.equal(result.status, 200, JSON.stringify(result));
                assert.equal(result.body.data.statusCode, status);
                assert.equal(result.body.data.userId, 8); // company colleagues, not only original author
                assert.equal(result.cacheControl, 'private, no-store');
            }
            assert.equal((await managed(id, 7, {}, true)).status, status === 'PS1' ? 200 : 404);
            assert.deepEqual(await counts(), before); assert.deepEqual(await balance(), balances);
        });
    }
    await check('private reads reject candidate/untrusted/invalid input before exposing content', async () => {
        for (const headers of [{ 'x-user-role': 'CANDIDATE' }, { 'x-internal-secret': '' }, { 'x-user-role': 'EMPLOYER', 'x-company-status': 'S2' }]) {
            const result = await managed(id, 7, headers);
            assert.equal(result.status, 403); assert.equal(result.body.data, undefined);
        }
        assert.equal((await managed('bad-id')).status, 400);
        assert.equal((await managed(id, 88)).status, 404);
        assert.equal((await managed(id, 99999, { 'x-user-role': 'ADMIN' })).status, 404);
    });
    await check('foreign-company and nonexistent jobs have identical uncached not-found envelopes', async () => {
        const foreign = await managed(id, 99, { 'x-company-id': '4' });
        const missing = await managed(999999, 99, { 'x-company-id': '4' });
        assert.deepEqual(foreign, missing); assert.equal(foreign.status, 404);
        assert.equal(foreign.cacheControl, 'private, no-store');
        const admin = await managed(id, 88, { 'x-user-role': 'ADMIN', 'x-company-id': '' });
        assert.equal(admin.status, 200); // admin read is not paid posting
    });
    await check('committed actor/author company changes are rechecked despite stale trusted headers', async () => {
        for (const userId of [7, 8]) {
            try {
                await pool.query('UPDATE users SET companyId = 4 WHERE id = ?', [userId]);
                const result = await managed(id);
                assert.equal(result.status, 404); assert.equal(result.body.data, undefined);
            } finally { await pool.query('UPDATE users SET companyId = 3 WHERE id = ?', [userId]); }
        }
        assert.equal((await managed(id)).status, 200);
    });
    await check('company bans/unapproved status deny employer reads; ADMIN can still inspect for support', async () => {
        for (const [status, censor] of [['S2', 'CS1'], ['S1', 'CS2']]) {
            try {
                await pool.query('UPDATE companies SET statusCode = ?, censorCode = ? WHERE id = 3', [status, censor]);
                assert.equal((await managed(id)).status, 404);
                assert.equal((await managed(id, 88, { 'x-user-role': 'ADMIN', 'x-company-id': '' })).status, 200);
            } finally { await pool.query("UPDATE companies SET statusCode = 'S1', censorCode = 'CS1' WHERE id = 3"); }
        }
    });
    await check('raw unknown/null classification codes survive without Allcode joins and no internal fields escape', async () => {
        const [[post]] = await pool.query('SELECT detailPostId FROM posts WHERE id = ?', [id]);
        await pool.query("UPDATE detailposts SET genderPostCode = NULL, addressCode = 'REMOVED-PROVINCE' WHERE id = ?", [post.detailPostId]);
        const result = await managed(id);
        assert.equal(result.status, 200);
        assert.equal(result.body.data.genderPostCode, null);
        assert.equal(result.body.data.addressCode, 'REMOVED-PROVINCE');
        for (const field of ['file', 'password', 'allowPost', 'allowHotPost', 'companyStatusCode', 'companyCensorCode',
            'requestId', 'contentHash', 'result', 'detailPostId']) assert.equal(Object.hasOwn(result.body.data, field), false);
        assert.deepEqual(await counts(), before); assert.deepEqual(await balance(), balances);
    });
    await check('management reads are current, not accepted-request replays, and do not create additional events', async () => {
        await pool.query("UPDATE posts SET statusCode = 'PS1' WHERE id = ?", [id]);
        assert.equal((await managed(id)).body.data.statusCode, 'PS1');
        assert.equal((await edit(id, { name: 'Current edited content' })).status, 200);
        const afterEdit = await counts();
        const result = await managed(id);
        assert.equal(result.body.data.name, 'Current edited content');
        assert.equal(result.body.data.statusCode, 'PS3');
        assert.deepEqual(await counts(), afterEdit); assert.deepEqual(await balance(), balances);
    });
    await check('orphan-company posts are hidden from employers and inspectable by ADMIN without private identity data', async () => {
        try {
            await pool.query('UPDATE users SET companyId = NULL WHERE id = 8');
            assert.equal((await managed(id)).status, 404);
            const admin = await managed(id, 88, { 'x-user-role': 'ADMIN', 'x-company-id': '' });
            assert.equal(admin.status, 200); assert.equal(admin.body.data.companyId, null);
            assert.equal(admin.body.data.companyName, null);
        } finally { await pool.query('UPDATE users SET companyId = 3 WHERE id = 8'); }
    });
};
