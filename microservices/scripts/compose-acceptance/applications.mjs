import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import mysql from 'mysql2/promise';
import pg from 'pg';

// HTTP acceptance against actual Gateway/legacy routes and eight running services.
// SQL is used only to seed historical records, change account state and inspect
// persisted evidence. No controller, identity, relay or consumer is mocked.
assert.equal(process.env.MYSQL_HOST, 'mysql');
assert.equal(process.env.MYSQL_DATABASE, 'acceptance');
const phase = process.argv[2];
assert.ok(['main', 'restart'].includes(phase));
const sql = mysql.createPool({ host: 'mysql', user: 'root', password: process.env.MYSQL_PASSWORD, database: 'acceptance' });
const postgres = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
const rows = async (query, values = []) => (await sql.query(query, values))[0];
const one = async (query, values = []) => (await rows(query, values))[0];
const eventually = async (name, work) => {
    const deadline = Date.now() + 90000; let last;
    while (Date.now() < deadline) {
        try { const result = await work(); if (result) return result; } catch (error) { last = error; }
        await delay(500);
    }
    throw Error(`Timeout: ${name}${last ? ': ' + last.message : ''}`);
};
const sessions = new Map();
const request = async (user, route, method = 'GET', body, headers = {}) => {
    const response = await fetch(`http://api-gateway:4000/api${route}`, {
        method, signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json',
            ...(sessions.has(user) && { authorization: `Bearer ${sessions.get(user).token}` }), ...headers },
        ...(body !== undefined && { body: JSON.stringify(body) })
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
};
const ok = async (...args) => {
    const result = await request(...args);
    assert.ok(result.status >= 200 && result.status < 300, `HTTP ${result.status}: ${args[1]}`);
    assert.equal(result.body.errCode, 0, `Business error: ${args[1]} ${JSON.stringify(result.body)}`);
    return result.body;
};
const sync = async () => {
    const response = await fetch('http://application-service:4004/internal/sync', {
        method: 'POST', headers: { 'x-internal-secret': process.env.INTERNAL_SECRET }, signal: AbortSignal.timeout(15000)
    });
    assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.errCode, 0); return result.data;
};
const board = async user => (await ok(user, '/applications/board')).data.columns.flatMap(column => column.items);
const history = async user => (await ok(user, '/my-applications')).data;
const legacyHistory = user => ok(user, '/get-all-cv-by-userId?limit=100&offset=0');
const hash = file => createHash('sha256').update(file).digest('hex');
let checks = 0;
const pass = name => { checks++; console.log(`PASS: ${name}`); };

// Small valid PDF transport fixture. Browser generation, layout and reviewed-byte
// selection are covered separately by test-candidate-browser, not simulated here.
const fixturePdf = () => {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    const content = 'BT /F1 16 Tf 48 790 Td (Synthetic reviewed CV - Node developer) Tj ET';
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const start = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    return `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`;
};

try {
    for (const [service, port] of [['legacy',4011], ['api-gateway',4000], ['identity-service',4001], ['application-service',4004]]) {
        await eventually(`${service} ready`, async () => (await fetch(`http://${service}:${port}/readyz`, { signal: AbortSignal.timeout(3000) })).ok);
    }
    for (const user of [7,8,9,10,11,12]) {
        const login = await ok(null, '/login', 'POST', { phonenumber: String(user).padStart(4, '0'), password: process.env.FIXTURE_PASSWORD });
        assert.equal(login.user.id, user); assert.ok(login.token); sessions.set(user, login);
    }
    pass('six real password logins through Gateway and legacy router; no fabricated identity headers');

    if (phase === 'restart') {
        const stored = (await one("SELECT data FROM acceptance_state WHERE name='applications'")).data;
        const expected = typeof stored === 'string' ? JSON.parse(stored) : stored;
        const mine = (await history(8)).find(row => row.legacy_cv_id === expected.cvId);
        assert.equal(mine.stage, 'phong_van'); assert.equal(mine.id, expected.applicationId);
        assert.equal((await board(7)).filter(row => row.legacy_cv_id === expected.cvId).length, 1);
        const cv = (await ok(8, `/get-detail-cv-by-id?cvId=${expected.cvId}`)).data;
        assert.equal(hash(cv.file), expected.pdfHash);
        assert.equal((await ok(8, '/profile/cvs')).count, 0);
        assert.equal((await sync()).imported, 0);
        const detail = (await ok(7, `/applications/${expected.applicationId}`)).data;
        assert.equal(detail.notes.length, 1); assert.equal(detail.timeline.length, 1);
        assert.equal(detail.cv_snapshot.email, 'follower@example.invalid');
        pass('Identity/Application/legacy restart and historical resync preserve PDF, snapshot, stage, note and timeline');
    } else {
        assert.equal((await request(null, '/profile/cvs')).status, 401);
        assert.equal((await request(null, '/create-new-cv', 'POST', {})).status, 401);
        const job = await one("SELECT id,detailPostId FROM posts WHERE statusCode='PS1' ORDER BY id LIMIT 1"); assert.ok(job);
        // Historical read/unread, missing dictionary rows, missing detail/post and
        // deleted candidate, with explicit old IDs distinct from PostgreSQL IDs.
        await sql.query("INSERT INTO posts(id,userId,detailPostId,statusCode,timeEnd,createdAt,updatedAt) VALUES (9002,7,?,'PS1','1',NOW(),NOW()),(9004,7,990004,'PS1','1',NOW(),NOW())", [job.detailPostId]);
        await sql.query("INSERT INTO cvs(id,userId,postId,isChecked,description,createdAt,updatedAt) VALUES (9101,9,?,1,'Historical read',NOW(),NOW()),(9102,8,9002,0,'Historical unread',NOW(),NOW()),(9103,8,990003,0,'Missing post',NOW(),NOW()),(9104,8,9004,0,'Missing detail',NOW(),NOW()),(9105,77,?,0,'Deleted candidate',NOW(),NOW())", [job.id,job.id]);
        assert.equal((await sync()).imported, 4);
        const oldBoard = await board(7);
        assert.equal(oldBoard.find(row => row.legacy_cv_id === 9101).stage, 'dang_xem_xet');
        assert.equal(oldBoard.find(row => row.legacy_cv_id === 9102).stage, 'moi_ung_tuyen');
        assert.equal(oldBoard.find(row => row.legacy_cv_id === 9104).job_title, null);
        assert.equal(oldBoard.find(row => row.legacy_cv_id === 9105).candidate_name, null);
        assert.ok(!oldBoard.some(row => row.legacy_cv_id === 9103));
        const oldHistory = await legacyHistory(8);
        assert.equal(oldHistory.count, 3); assert.ok(oldHistory.data.every(row => !('file' in row)));
        assert.equal(oldHistory.data.find(row => row.id === 9103).postCvData.id, null);
        assert.equal(oldHistory.data.find(row => row.id === 9104).postCvData.postDetailData.id, null);
        assert.equal((await history(8)).length, 2);
        pass('historical read/unread, missing dictionaries/detail/post and deleted candidate remain readable and correctly scoped');

        const ai = await ok(8, '/ai/parse-resume', 'POST', { fileName: 'synthetic.pdf', fileBase64: Buffer.from('%PDF-1.4\nSynthetic CV').toString('base64') }, { 'idempotency-key': randomUUID() });
        const parsed = await eventually('resume parsed by actual worker with synthetic AI', async () => {
            const task = (await ok(8, `/ai/tasks/${ai.taskId}`)).data;
            assert.notEqual(task.status, 'failed'); return task.status === 'done' && task.result;
        });
        const prepared = (await ok(8, '/profile/cvs', 'POST', { title: 'Reviewed application CV', fullName: parsed.fullName,
            email: parsed.email, skills: parsed.skills, summary: 'Synthetic reviewed CV - Node developer' })).data;
        assert.ok((await ok(8, '/profile/cvs')).data.some(cv => cv._id === prepared._id));
        assert.equal((await ok(9, '/profile/cvs')).count, 0);
        assert.equal((await request(9, `/profile/cvs/${prepared._id}`, 'PUT', { title: 'Stolen' })).status, 404);
        assert.equal((await request(9, `/profile/cvs/${prepared._id}`, 'DELETE')).status, 404);
        assert.equal((await request(7, '/profile/cvs')).status, 403);
        pass('AI task -> reviewed structured CV saved in Mongo; other candidate/employer cannot alter or read it');

        const file = fixturePdf();
        const submission = { postId: job.id, userId: 9, file, description: 'Reviewed application letter' };
        const receipt = await ok(8, '/create-new-cv', 'POST', submission, { 'x-user-id': '9', 'x-user-role': 'ADMIN', 'x-company-id': '4' });
        const cvId = receipt.cvId;
        assert.equal((await one('SELECT userId FROM cvs WHERE id=?', [cvId])).userId, 8);
        const application = await eventually('durable submission delivered to candidate history', async () => (await history(8)).find(row => row.legacy_cv_id === cvId));
        assert.notEqual(Number(application.id), cvId); assert.equal(application.stage, 'moi_ung_tuyen');
        await eventually('submission relay confirmed', async () => (await one("SELECT publishedAt FROM outbox_events WHERE aggregateType='legacy-application' AND aggregateId=?", [String(cvId)]))?.publishedAt);
        const pdf = (await ok(8, `/get-detail-cv-by-id?cvId=${cvId}&roleCode=EMPLOYER`)).data;
        assert.equal(pdf.file, file); assert.equal(pdf.isChecked, 0);
        assert.ok(!(await history(9)).some(row => row.legacy_cv_id === cvId));
        pass('legacy HTTP submission -> transactional outbox -> confirmed Rabbit -> Application history; forged identity ignored and exact PDF retained');

        await ok(8, `/profile/cvs/${prepared._id}`, 'PUT', { fullName: 'Changed prepared name', summary: 'New version' });
        await ok(8, `/profile/cvs/${prepared._id}`, 'DELETE');
        await sql.query("UPDATE users SET firstName='Changed',email='changed@example.invalid' WHERE id=8");
        const stored = (await postgres.query('SELECT * FROM applications WHERE legacy_cv_id=$1', [cvId])).rows[0];
        assert.equal(stored.cv_snapshot.email, 'follower@example.invalid'); assert.equal(stored.candidate_name, 'Synthetic Follower');
        assert.equal((await ok(8, `/get-detail-cv-by-id?cvId=${cvId}`)).data.file, file);
        assert.equal((await request(8, '/create-new-cv', 'POST', { ...submission, description: 'Changed retry', file: 'changed' })).status, 409);
        assert.equal((await one("SELECT COUNT(*) n FROM outbox_events WHERE aggregateType='legacy-application' AND aggregateId=?", [String(cvId)])).n, 1);
        pass('editing/deleting source CV and changing profile cannot rewrite submitted PDF/contact snapshot; repeat submit is a conflict');

        assert.ok((await board(10)).some(row => row.legacy_cv_id === cvId));
        assert.equal((await board(11)).length, 0);
        for (const user of [9,11]) assert.equal((await request(user, `/get-detail-cv-by-id?cvId=${cvId}`)).status, 403);
        assert.equal((await request(8, `/applications/${application.id}`)).status, 403);
        assert.equal((await request(11, `/applications/${application.id}`)).status, 403);
        assert.equal((await request(11, `/applications/${application.id}/stage`, 'PATCH', { stage: 'tu_choi' })).status, 403);
        assert.equal((await request(9, '/get-all-cv-by-userId?userId=8&limit=100&offset=0')).status, 403);
        for (const user of [7,10,12]) assert.equal((await request(user, '/create-new-cv', 'POST', submission)).status, 403);
        assert.equal((await request(8, '/internal/sync', 'POST')).status, 404);
        pass('candidate/recruiter/admin permissions and company boundaries hold across legacy PDF, board, history and mutation routes');

        await ok(10, `/applications/${application.id}/notes`, 'POST', { body: 'Internal interview note' });
        await ok(10, `/applications/${application.id}/stage`, 'PATCH', { stage: 'phong_van', reason: 'Invite to interview' });
        const progress = await request(8, '/my-applications');
        assert.equal(progress.headers.get('cache-control'), 'private, no-store');
        const current = progress.body.data.find(row => row.legacy_cv_id === cvId);
        assert.equal(current.stage, 'phong_van'); assert.equal(current.stageLabel, 'Phỏng vấn');
        assert.deepEqual(Object.keys(current).sort(), ['id','legacy_cv_id','job_id','job_title','stage','applied_at','stage_changed_at','stageLabel'].sort());
        const read = (await ok(10, `/get-detail-cv-by-id?cvId=${cvId}`)).data;
        assert.equal(read.isChecked, 1); assert.equal(read.file, file);
        assert.equal((await sync()).imported, 0);
        assert.equal((await history(8)).find(row => row.legacy_cv_id === cvId).stage, 'phong_van');
        pass('same-company employee moves Kanban; candidate sees interview stage without internal notes and legacy read flag stays independent');

        await sql.query("UPDATE accounts SET statusCode='S2' WHERE userId=8");
        assert.equal((await request(8, '/profile/cvs')).status, 403);
        assert.equal((await request(8, `/get-detail-cv-by-id?cvId=${cvId}`)).status, 403);
        await sql.query("UPDATE accounts SET statusCode='S1',roleCode='EMPLOYER' WHERE userId=8");
        assert.equal((await request(8, '/my-applications')).status, 403);
        assert.equal((await request(8, '/create-new-cv', 'POST', submission)).status, 403);
        await sql.query("UPDATE accounts SET roleCode='CANDIDATE' WHERE userId=8");
        await sql.query('UPDATE users SET companyId=4 WHERE id=10');
        assert.equal((await request(10, `/applications/${application.id}/stage`, 'PATCH', { stage: 'tu_choi' })).status, 403);
        assert.equal((await request(10, `/get-detail-cv-by-id?cvId=${cvId}`)).status, 403);
        await sql.query('UPDATE users SET companyId=3 WHERE id=10');
        await sql.query("UPDATE companies SET censorCode='CS2' WHERE id=3");
        assert.equal((await request(7, '/applications/board')).status, 403);
        assert.equal((await request(7, `/get-detail-cv-by-id?cvId=${cvId}`)).status, 403);
        await sql.query("UPDATE companies SET censorCode='CS1' WHERE id=3");
        assert.equal((await history(8)).find(row => row.legacy_cv_id === cvId).stage, 'phong_van');
        pass('existing login tokens lose access immediately after account lock, role/company change or company approval removal');

        await sql.query('INSERT INTO acceptance_state VALUES (?,?)', ['applications', JSON.stringify({ cvId, applicationId: application.id, pdfHash: hash(file) })]);
    }
    console.log(`Compose application ${phase}: ${checks} checks passed`);
} finally { await sql.end(); await postgres.end(); }
