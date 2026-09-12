// Real localhost acceptance, explicitly phased with separate isolated/automatic evidence.
// node microservices/scripts/test-offer-live.mjs --prepare | --browser | --inspect | --cleanup
// Add --automatic to EACH phase to use .local/offer-automatic and the real configured worker.
// --prepare creates ONE synthetic application. --browser sends ONE queued offer.
// No provider settings are changed. Isolated mode leaves SMTP separate; automatic mode only observes delivery.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, access, open, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isValidEmailRecipient } from '../notification-service/src/libs/emailAddress.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const requireMicro = createRequire(path.join(root, 'microservices/package.json'));
const requireBackend = createRequire(path.join(root, 'backend/package.json'));
const pg = requireMicro('pg'), mysql = requireMicro('mysql2/promise');
const jwt = requireBackend('jsonwebtoken'), dotenv = requireBackend('dotenv');
const { chromium, expect } = requireMicro('playwright/test');
const exec = promisify(execFile);
const args = process.argv.slice(2);
const automatic = args.includes('--automatic');
const phases = args.filter(arg => ['--prepare', '--browser', '--inspect', '--cleanup'].includes(arg));
assert.ok(phases.length === 1 && args.length === (automatic ? 2 : 1), 'Choose one explicit phase, optionally with --automatic');
const action = phases[0];
const evidenceFolder = automatic ? '.local/offer-automatic' : '.local/offer-live';
const directory = path.join(root, evidenceFolder);
const fixturePrefix = automatic ? 'offer-automatic-' : 'offer-live-';
const fixtureFile = path.join(directory, 'application-fixture.json');
const lockFile = path.join(directory, 'phase.lock');
const origin = 'http://127.0.0.1:3001';
await mkdir(directory, { recursive: true, mode: 0o700 });
const writePrivate = (file, data) => writeFile(path.join(directory, file), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const save = fixture => writePrivate('application-fixture.json', fixture);
const exists = file => access(file).then(() => true, () => false);
const check = (condition, label) => assert.ok(condition, label);
const docker = async args => {
    try { return (await exec('docker', args, { cwd: root, windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
    catch { throw Error('Docker inspection failed; credentials and container output withheld'); }
};
const envFor = async service => {
    const ids = (await docker(['ps', '-q', '--filter', 'label=com.docker.compose.project=ai-job-portal',
        '--filter', `label=com.docker.compose.service=${service}`])).split(/\s+/).filter(Boolean);
    assert.equal(ids.length, 1, `Expected one running ${service}`);
    const [container] = JSON.parse(await docker(['inspect', ids[0]]));
    return Object.fromEntries(container.Config.Env.map(entry => {
        const index = entry.indexOf('='); return [entry.slice(0, index), entry.slice(index + 1)];
    }));
};
const envs = await Promise.all(['api-gateway', 'application-service', 'notification-service'].map(envFor));
const [gatewayEnv, appEnv, notificationEnv] = envs;
const diskEnv = dotenv.parse(await readFile(path.join(root, 'microservices/.env')));
if (automatic) {
    // Boolean checks deliberately prevent assertion diagnostics from embedding credentials.
    check(Boolean(diskEnv.EMAIL_APP_PASSWORD), 'Automatic mode requires a configured mailbox password');
    check(notificationEnv.EMAIL_APP === diskEnv.EMAIL_APP
        && notificationEnv.EMAIL_APP_PASSWORD === diskEnv.EMAIL_APP_PASSWORD,
    'Automatic mode requires the notification runtime mailbox configuration to match disk privately');
} else {
    // The isolated check must not enable or use the global sender.
    check(!notificationEnv.EMAIL_APP && !notificationEnv.EMAIL_APP_PASSWORD, 'Global SMTP must remain blank for this isolated live check');
}
const selfEmail = String(diskEnv.EMAIL_APP || '').trim().toLowerCase();
check(isValidEmailRecipient(selfEmail) && !selfEmail.includes('youremail'), 'A valid configured self mailbox is required');
const postgresUrl = new URL(appEnv.POSTGRES_URL);
postgresUrl.hostname = '127.0.0.1'; postgresUrl.port = '5435';
const postgres = new pg.Pool({ connectionString: postgresUrl.href, max: 1, connectionTimeoutMillis: 8000 });
const mysqlOptions = env => ({ host: '127.0.0.1', port: Number(env.MYSQL_PORT || 3333), user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD, database: env.MYSQL_DATABASE, dateStrings: true, connectTimeout: 8000 });
const readDb = await mysql.createConnection(mysqlOptions(gatewayEnv));
const notificationDb = await mysql.createConnection(mysqlOptions(notificationEnv));
const token = id => jwt.sign({ sub: String(id) }, gatewayEnv.JWT_SECRET, { algorithm: 'HS256',
    issuer: gatewayEnv.JWT_ISSUER || 'jobfind-auth', audience: gatewayEnv.JWT_AUDIENCE || 'jobfind-api', expiresIn: 600 });
const request = async (id, route, { method = 'GET', body } = {}) => {
    const response = await fetch(origin + route, { method, signal: AbortSignal.timeout(15000),
        headers: { 'content-type': 'application/json', ...(id && { authorization: `Bearer ${token(id)}` }) },
        ...(body && { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
};
const ok = async (...args) => {
    const result = await request(...args); assert.equal(result.status, 200, 'Real HTTP request');
    assert.equal(result.body.errCode, 0, 'Real application response'); return result.body;
};
const count = async fixture => {
    const { rows: [row] } = await postgres.query('SELECT COUNT(*)::int n FROM outbox_events WHERE aggregate_id=$1', [fixture.applicationId]);
    return row.n;
};
const assertFixture = async fixture => {
    assert.match(fixture.marker, automatic ? /^offer-automatic-[a-f0-9-]{36}$/ : /^offer-live-[a-f0-9-]{36}$/);
    assert.equal(fixture.deliveryMode || 'isolated', automatic ? 'automatic' : 'isolated', 'Saved fixture belongs to the selected delivery mode');
    const { rows: [app] } = await postgres.query('SELECT * FROM applications WHERE id=$1', [fixture.applicationId]);
    check(app, 'Saved fixture exists'); assert.equal(app.legacy_cv_id, null);
    assert.equal(app.cover_letter, fixture.marker); assert.equal(app.cv_snapshot?.liveFixtureMarker, fixture.marker);
    assert.equal(app.candidate_email, selfEmail); assert.equal(app.candidate_email, fixture.recipientEmail);
    assert.equal(Number(app.candidate_id), Number(fixture.candidateId));
    assert.equal(Number(app.company_id), Number(fixture.actor.companyId));
    check(app.job_title.startsWith('[KIỂM THỬ]'), 'Synthetic title marker');
    return app;
};
const assertIdentity = async fixture => {
    const actor = (await ok(fixture.actor.id, '/api/auth/me')).data;
    assert.equal(Number(actor.userId), Number(fixture.actor.id));
    assert.equal(actor.roleCode, fixture.actor.roleCode); assert.equal(Number(actor.companyId), Number(fixture.actor.companyId));
    const candidate = (await ok(fixture.candidateId, '/api/auth/me')).data;
    assert.equal(candidate.roleCode, 'CANDIDATE');
};
const collect = async fixture => {
    const app = await assertFixture(fixture);
    const { rows: events } = await postgres.query('SELECT * FROM application_events WHERE application_id=$1 ORDER BY id', [fixture.applicationId]);
    const { rows: outbox } = await postgres.query('SELECT * FROM outbox_events WHERE aggregate_id=$1 ORDER BY sequence', [fixture.applicationId]);
    const deliveries = [], inbox = [];
    for (const event of outbox) {
        assert.equal(event.payload.candidateEmail, fixture.recipientEmail);
        assert.equal(event.payload.applicationId, String(fixture.applicationId));
        const [rows] = await notificationDb.query('SELECT * FROM notification_deliveries WHERE eventId=? AND recipientId=? ORDER BY id', [event.id, fixture.candidateId]);
        deliveries.push(...rows.map(row => ({ ...row, payload: JSON.parse(row.payload) })));
        const [receipts] = await notificationDb.query('SELECT * FROM notification_inbox WHERE eventId=? AND recipientId=?', [event.id, fixture.candidateId]);
        inbox.push(...receipts);
    }
    return { app, events, outbox, deliveries, inbox };
};
const inspect = async fixture => {
    const evidence = await collect(fixture);
    await writePrivate('database-evidence.json', evidence);
    fixture.eventIds = evidence.outbox.map(row => row.id);
    fixture.deliveryIds = evidence.deliveries.map(row => row.id);
    fixture.notificationIds = evidence.inbox.map(row => row.notificationId).filter(Boolean);
    await save(fixture);
    const publicReport = { phase: action, deliveryMode: automatic ? 'automatic' : 'isolated', applicationId: fixture.applicationId, stage: evidence.app.stage,
        events: evidence.events.length, outbox: evidence.outbox.map(row => ({ id: row.id, published: Boolean(row.published_at) })),
        deliveries: evidence.deliveries.map(row => ({ id: row.id, channel: row.channel, status: row.status, attempts: row.attempts })) };
    await writePrivate('inspection-summary.json', publicReport); return evidence;
};

let phaseLock;
try {
    phaseLock = await open(lockFile, 'wx', 0o600);
    await phaseLock.writeFile(JSON.stringify({ pid: process.pid, phase: action, automatic, startedAt: new Date().toISOString() }));
    if (action === '--prepare') {
        check(!await exists(fixtureFile), 'A saved fixture already exists; inspect it before creating another');
        const [[actor]] = await readDb.query("SELECT u.id,a.roleCode,u.companyId FROM users u JOIN accounts a ON a.userId=u.id JOIN companies c ON c.id=u.companyId WHERE a.statusCode='S1' AND a.roleCode IN ('COMPANY','EMPLOYER') AND c.statusCode='S1' AND c.censorCode='CS1' ORDER BY u.id LIMIT 1");
        const [[candidate]] = await readDb.query("SELECT u.id FROM users u JOIN accounts a ON a.userId=u.id WHERE a.statusCode='S1' AND a.roleCode='CANDIDATE' AND (LOWER(u.email)='example@gmail.com' OR LOWER(u.email) REGEXP '@(.*[.])?example[.](com|net|org)$|[.](example|invalid|test|local|localhost)$') ORDER BY u.id LIMIT 1");
        check(actor && candidate, 'A current employer and a demo candidate account are required');
        const [[job]] = await readDb.query('SELECT p.id FROM posts p JOIN users u ON u.id=p.userId WHERE u.companyId=? ORDER BY p.id LIMIT 1', [actor.companyId]);
        check(job, 'Employer must have an existing job');
        const marker = `${fixturePrefix}${randomUUID()}`;
        const fixture = { version: 1, deliveryMode: automatic ? 'automatic' : 'isolated', marker, actor, candidateId: candidate.id, jobId: job.id, recipientEmail: selfEmail,
            candidateName: '[KIỂM THỬ] Ứng viên nhận việc', jobTitle: `[KIỂM THỬ] Chuyên viên thử thư mời ${marker}`,
            createdAt: new Date().toISOString() };
        await assertIdentity(fixture);
        const { rows: [created] } = await postgres.query(`INSERT INTO applications
            (legacy_cv_id,job_id,job_title,candidate_id,candidate_name,candidate_email,company_id,stage,cover_letter,cv_snapshot,is_read)
            VALUES (NULL,$1,$2,$3,$4,$5,$6,'phong_van',$7,$8::jsonb,TRUE) RETURNING id`,
        [job.id, fixture.jobTitle, candidate.id, fixture.candidateName, selfEmail, actor.companyId, marker,
            JSON.stringify({ liveFixtureMarker: marker, fullName: fixture.candidateName })]);
        fixture.applicationId = created.id; await save(fixture); await inspect(fixture);
        console.log('PASS prepare: one marked synthetic application; existing applications and recipient accounts unchanged');
    } else {
        const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'));
        await assertFixture(fixture);
        if (action === '--browser') {
            await assertIdentity(fixture);
            assert.equal(await count(fixture), 0, 'Never resend a possibly accepted offer; inspect the saved fixture');
            const localDate = days => new Date(Date.now() + days * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
            const offer = { companyName: '[KIỂM THỬ] Công ty kiểm tra thư mời', startDate: localDate(14), startTime: '08:30',
                timeZone: 'Asia/Ho_Chi_Minh', workMode: 'hybrid', location: '[KIỂM THỬ] Tầng 3, phòng Nhân sự, 123 Đường Thử Nghiệm, Hà Nội',
                meetingUrl: 'https://example.com/onboarding-test', responseDeadline: `${localDate(7)}T17:00`,
                contactName: '[KIỂM THỬ] Nhân sự phụ trách', contactEmail: selfEmail, contactPhone: '0900000000',
                workSchedule: 'Thứ Hai–Thứ Sáu, 08:30–17:30; nghỉ trưa 12:00–13:00', salary: '[KIỂM THỬ] 20.000.000 VNĐ gross/tháng',
                probation: '[KIỂM THỬ] 2 tháng; 100% lương đề nghị', benefits: 'BHXH theo quy định; 12 ngày phép/năm\nThiết bị làm việc do công ty cung cấp',
                requiredDocuments: 'Bản sao giấy tờ định danh; thông tin tài khoản ngân hàng\nMang bản gốc để đối chiếu khi được HR hướng dẫn',
                onboardingInstructions: 'Có mặt tại quầy lễ tân lúc 08:15, liên hệ HR và nhận thiết bị. Đây chỉ là kiểm thử, không phải lời mời thực tế.' };
            const message = '[KIỂM THỬ] Email tự gửi để kiểm tra luồng thư mời nhận việc. Không phải thông báo tuyển dụng thực tế.';
            const route = `/api/applications/${fixture.applicationId}/decision-notification`;
            const payload = { decision: 'accepted', message, offer };
            const before = await count(fixture);
            for (const invalidOffer of [{ ...offer, location: '' }, { ...offer, responseDeadline: '' }, { ...offer, responseDeadline: `${localDate(15)}T17:00` }]) {
                const rejected = await request(fixture.actor.id, route, { method: 'POST', body: { ...payload, offer: invalidOffer } });
                assert.equal(rejected.status, 400, 'Invalid offer must be rejected by the real API');
                assert.equal(await count(fixture), before, 'Invalid offer must not create an outbox event');
            }
            assert.equal((await request(fixture.candidateId, route, { method: 'POST', body: payload })).status, 403, 'Candidate cannot send employer decisions');
            assert.equal(await count(fixture), before, 'Unauthorized request must not enqueue mail');
            const browser = await chromium.launch({ headless: true, ...(process.env.JOBFIND_TEST_BROWSER_CHANNEL && { channel: process.env.JOBFIND_TEST_BROWSER_CHANNEL }) });
            let successfulWrites = 0; const errors = [], unexpectedWrites = [];
            try {
                const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
                await context.addInitScript(({ user, token }) => {
                    if (window.top !== window) return;
                    localStorage.setItem('userData', JSON.stringify(user)); localStorage.setItem('token_user', token);
                }, { user: { ...fixture.actor, firstName: '[KIỂM THỬ]', lastName: 'HR', email: selfEmail }, token: token(fixture.actor.id) });
                // No mocked API response: only a safety boundary for unrelated writes and external requests.
                await context.route('**/*', intercepted => {
                    const request = intercepted.request(), url = new URL(request.url());
                    if (url.origin !== origin) return intercepted.abort();
                    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
                        if (url.pathname !== route || request.method() !== 'POST' || successfulWrites++) {
                            unexpectedWrites.push(url.pathname); return intercepted.abort();
                        }
                    }
                    return intercepted.continue();
                });
                const page = await context.newPage(); page.on('pageerror', () => errors.push('Browser runtime error'));
                await page.goto(origin + '/admin/pipeline/');
                await page.getByRole('button', { name: `Hồ sơ ${fixture.candidateName}`, exact: true }).click();
                const modal = page.getByRole('dialog');
                await modal.getByPlaceholder('Lời nhắn thêm cho ứng viên (không bắt buộc)').fill(message);
                await modal.getByRole('button', { name: 'Gửi trúng tuyển', exact: true }).click();
                const form = modal.getByRole('region', { name: 'Soạn thư mời nhận việc' });
                await form.locator('select').selectOption(offer.workMode);
                const labels = { companyName: 'Tên công ty *', startDate: 'Ngày nhận việc *', startTime: 'Giờ nhận việc *',
                    location: 'Địa điểm nhận việc cụ thể *', meetingUrl: 'Đường dẫn nhận việc trực tuyến', responseDeadline: 'Hạn phản hồi *',
                    contactName: 'Người liên hệ HR *', contactEmail: 'Email HR nhận phản hồi *', contactPhone: 'Số điện thoại HR',
                    workSchedule: 'Lịch làm việc', salary: 'Lương / thu nhập (ghi rõ gross hoặc net)', probation: 'Thời gian và lương thử việc',
                    benefits: 'Phúc lợi', requiredDocuments: 'Giấy tờ cần chuẩn bị', onboardingInstructions: 'Hướng dẫn ngày đầu nhận việc' };
                for (const [field, label] of Object.entries(labels)) await form.getByLabel(label, { exact: true }).fill(offer[field]);
                await form.getByRole('button', { name: 'Xem trước thư mời', exact: true }).click();
                await expect(form.getByRole('button', { name: 'Xác nhận gửi thư mời', exact: true })).toBeVisible();
                // Capture only the synthetic form, masking the self mailbox in all occurrences.
                const masks = form.getByText(selfEmail, { exact: false });
                await form.screenshot({ path: path.join(directory, 'offer-preview-desktop.png'), mask: [masks] });
                await page.setViewportSize({ width: 390, height: 844 });
                await form.screenshot({ path: path.join(directory, 'offer-preview-mobile.png'), mask: [masks] });
                await page.setViewportSize({ width: 1280, height: 1000 });
                page.once('dialog', dialog => dialog.accept());
                const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === route && response.request().method() === 'POST');
                await form.getByRole('button', { name: 'Xác nhận gửi thư mời', exact: true }).click();
                const response = await responsePromise, body = await response.json();
                assert.equal(response.status(), 200); assert.equal(body.errCode, 0); assert.equal(body.emailQueued, true);
                assert.equal(body.data.stage, 'de_nghi'); assert.equal(successfulWrites, 1);
                assert.equal(unexpectedWrites.length, 0); assert.equal(errors.length, 0);
                fixture.expectedOffer = offer; fixture.expectedMessage = message;
                fixture.httpEvidence = { status: response.status(), errCode: body.errCode, emailQueued: body.emailQueued, stage: body.data.stage, writeCount: successfulWrites };
                await save(fixture);
                await writePrivate('browser-response.json', { request: payload, response: body });
            } finally { await browser.close(); }
            let evidence; const end = Date.now() + (automatic ? 120000 : 55000);
            do {
                evidence = await collect(fixture);
                const email = evidence.deliveries.find(row => row.channel === 'email');
                if (evidence.outbox.length === 1 && evidence.outbox[0].published_at && email
                    && (!automatic || ['sent', 'failed', 'skipped', 'unknown'].includes(email.status))) break;
                await delay(500);
            } while (Date.now() < end);
            assert.equal(evidence.outbox.length, 1); check(evidence.outbox[0].published_at, 'RabbitMQ publication confirmed');
            assert.equal(evidence.events.length, 1); assert.deepEqual(evidence.events[0].decision_snapshot.offer, offer);
            assert.deepEqual(evidence.outbox[0].payload.offer, offer); assert.equal(evidence.app.stage, 'de_nghi');
            const emails = evidence.deliveries.filter(row => row.channel === 'email');
            assert.equal(emails.length, 1, 'Exactly one durable email snapshot exists for the single queued offer');
            const [email] = emails;
            assert.equal(email.eventId, evidence.outbox[0].id, 'Email belongs to the exact saved outbox event');
            assert.equal(email.payload.to, selfEmail); assert.equal(email.payload.replyTo, selfEmail);
            check(email.payload.subject.includes('[KIỂM THỬ]'), 'Clearly marked email subject');
            check(email.payload.subject.includes(fixture.marker) && email.payload.html.includes(fixture.marker)
                && email.payload.text.includes(fixture.marker), 'Exact synthetic fixture marker is retained in the email');
            check(email.payload.html.includes('data-progress-current="4"'), 'Offer waits at step four');
            for (const field of ['location', 'workSchedule', 'salary', 'probation', 'benefits', 'requiredDocuments', 'onboardingInstructions']) {
                check(email.payload.text.includes(offer[field]), `Email contains ${field}`);
            }
            check(!email.payload.text.includes('Vui lòng không trả lời trực tiếp'), 'Reply instructions agree with Reply-To');
            const redact = text => text.replaceAll(selfEmail, '[HỘP THƯ TỰ KIỂM THỬ]');
            await writeFile(path.join(directory, 'offer-email-preview.html'), redact(email.payload.html), { mode: 0o600 });
            await writeFile(path.join(directory, 'offer-email-preview.txt'), redact(email.payload.text), { mode: 0o600 });
            fixture.emailPayloadSha256 = createHash('sha256').update(JSON.stringify(email.payload)).digest('hex');
            await writePrivate('smtp-target.json', { applicationId: fixture.applicationId, candidateId: fixture.candidateId,
                eventId: email.eventId, emailDeliveryId: email.id, marker: fixture.marker, recipientEmail: selfEmail });
            if (automatic) {
                const expectedMessageId = `<${createHash('sha256').update(JSON.stringify([email.eventId, String(fixture.candidateId)])).digest('hex')}@jobfind.local>`;
                assert.equal(email.payload.messageId, expectedMessageId, 'Use the exact durable transport message ID for inbox verification');
                await writeFile(path.join(directory, 'sent-email.html'), email.payload.html, { mode: 0o600 });
                await writeFile(path.join(directory, 'sent-email.txt'), email.payload.text, { mode: 0o600 });
                await writePrivate('smtp-result.json', {
                    checkedAt: new Date().toISOString(), applicationId: fixture.applicationId,
                    eventId: email.eventId, deliveryId: email.id, deliveryMode: 'automatic',
                    verificationSource: 'background-worker-delivery-status', smtpAccepted: email.status === 'sent',
                    status: email.status, attempts: email.attempts,
                    messageId: email.payload.messageId, transportMessageId: email.payload.messageId,
                    htmlSha256: createHash('sha256').update(email.payload.html).digest('hex'),
                    textSha256: createHash('sha256').update(email.payload.text).digest('hex'),
                });
            }
            await inspect(fixture);
            if (automatic) {
                assert.equal(email.status, 'sent', 'The real background worker must confirm this exact email as sent; do not resend the browser phase');
                check(Number(email.attempts) >= 1, 'The background worker recorded an actual delivery attempt');
                console.log('PASS real browser + API + PostgreSQL outbox + RabbitMQ + automatic background SMTP delivery; exact self-mail evidence saved');
            } else {
                console.log('PASS real browser + API + PostgreSQL outbox + RabbitMQ + durable notification; one synthetic offer queued, SMTP remains separate');
            }
        } else if (action === '--inspect') {
            await inspect(fixture); console.log('PASS inspect: exact saved application and delivery evidence updated privately');
        } else {
            const evidence = await inspect(fixture);
            check(evidence.outbox.every(row => row.published_at), 'Cannot clean while publication is pending');
            check(evidence.deliveries.every(row => ['sent', 'skipped', 'failed'].includes(row.status)), 'Only terminal, resolved deliveries may be cleaned');
            for (const event of evidence.outbox) {
                const receipts = evidence.inbox.filter(row => row.eventId === event.id && row.notificationId != null);
                assert.equal(receipts.length, 1, 'Consumer must have durably processed each published event');
                assert.deepEqual(evidence.deliveries.filter(row => row.eventId === event.id).map(row => row.channel).sort(),
                    ['email', 'realtime'], 'Both delivery outcomes must exist before cleanup');
            }
            await notificationDb.beginTransaction();
            try {
                for (const receipt of evidence.inbox) {
                    const [removedDeliveries] = await notificationDb.query('DELETE FROM notification_deliveries WHERE eventId=? AND recipientId=?', [receipt.eventId, fixture.candidateId]);
                    assert.equal(removedDeliveries.affectedRows, evidence.deliveries.filter(row => row.eventId === receipt.eventId).length);
                    const [removedNotification] = await notificationDb.query('DELETE FROM notifications WHERE id=? AND userId=? AND content LIKE ?', [receipt.notificationId, fixture.candidateId, `%${fixture.jobTitle}%`]);
                    assert.equal(removedNotification.affectedRows, 1, 'Only the marked synthetic notification is removed');
                    // Keep the inbox notificationId as a tombstone: a delayed broker redelivery
                    // must remain a duplicate and must never recreate this test email.
                }
                await notificationDb.commit();
            } catch (error) { await notificationDb.rollback(); throw error; }
            const client = await postgres.connect();
            try {
                await client.query('BEGIN');
                await client.query('DELETE FROM outbox_events WHERE aggregate_id=$1 AND id=ANY($2::uuid[])', [fixture.applicationId, evidence.outbox.map(row => row.id)]);
                const removed = await client.query('DELETE FROM applications WHERE id=$1 AND legacy_cv_id IS NULL AND cover_letter=$2 AND candidate_email=$3', [fixture.applicationId, fixture.marker, selfEmail]);
                assert.equal(removed.rowCount, 1); await client.query('COMMIT');
            } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
            fixture.cleanedAt = new Date().toISOString(); await save(fixture);
            console.log('PASS cleanup: saved synthetic application, its events and notification deliveries removed; deduplication receipts and private evidence retained');
        }
    }
} catch (error) {
    // Assertions/DB diagnostics can embed actual values. Keep details private, report only the phase.
    await writePrivate('failure-private.json', { phase: action, message: error.message, stack: error.stack });
    console.error(`FAIL ${action}: inspect ${evidenceFolder}/failure-private.json (private values withheld)`);
    process.exitCode = 1;
} finally {
    await Promise.allSettled([readDb.end(), notificationDb.end(), postgres.end()]);
    if (phaseLock) { await phaseLock.close(); await unlink(lockFile); }
}
