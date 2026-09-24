// One opt-in real AI request against the running local stack, synthetic data only.
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { chromium, expect } = require('../../microservices/node_modules/playwright/test');
const { MongoClient } = require('../../microservices/node_modules/mongodb');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.local/ai-screening-browser');
const web = process.env.AI_DEMO_WEB_URL || 'http://localhost:3001';
const api = process.env.AI_DEMO_API_URL || 'http://localhost:4000';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    if (process.env.AI_DEMO_LIVE !== 'true') {
        console.log('SKIP: set AI_DEMO_LIVE=true for one real AI PDF screening request with synthetic data.');
        return;
    }
    for (const address of [web, api]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(address).hostname));
    await fs.mkdir(output, { recursive: true });
    const report = { startedAt: new Date().toISOString(), syntheticOnly: true, checks: [] };
    const pass = name => { report.checks.push(name); console.log('PASS: ' + name); };
    const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME });
    const mongo = new MongoClient(process.env.AI_DEMO_MONGO_URL || 'mongodb://127.0.0.1:27019', { serverSelectionTimeoutMS: 5000 });
    const tag = randomBytes(8).toString('hex');
    const password = randomBytes(24).toString('base64url');
    const users = [], aiPosts = [], faults = [], authResponses = [];
    let companyId, detailId, postId, browser, page;
    const ledger = mongo.db('ai_worker_db').collection('task_executions');
    try {
        await mongo.connect();
        const pdf = await fs.readFile(path.join(root, 'microservices/tests/fixtures/ai-synthetic-resume.pdf'));
        const hash = await bcrypt.hash(password, 10);
        for (const [index, role] of ['EMPLOYER', 'CANDIDATE'].entries()) {
            const email = `ai-screen-${role.toLowerCase()}-${tag}@example.invalid`;
            const [row] = await connection.query('INSERT INTO users (firstName,lastName,email) VALUES (?,?,?)', ['Synthetic AI', role, email]);
            users.push({ id: row.insertId, email, role });
            await connection.query('INSERT INTO accounts (userId,phonenumber,password,roleCode,statusCode,createdAt,updatedAt) VALUES (?,?,?,?,?,NOW(),NOW())',
                [row.insertId, '09' + String(Date.now() + index).slice(-8), hash, role, 'S1']);
        }
        const [employer, candidate] = users;
        const [company] = await connection.query('INSERT INTO companies (name,userId,statusCode,censorCode,allowCvFree,allowCv,createdAt,updatedAt) VALUES (?,?,?,?,?,?,NOW(),NOW())',
            [`Synthetic AI Screening ${tag}`, employer.id, 'S1', 'CS1', 2, 0]);
        companyId = company.insertId;
        await connection.query('UPDATE users SET companyId = ? WHERE id = ?', [companyId, employer.id]);
        await connection.query('INSERT INTO usersettings (userId,isFindJob,file) VALUES (?,?,?)',
            [candidate.id, 1, `data:application/pdf;base64,${pdf.toString('base64')}`]);
        const [detail] = await connection.query('INSERT INTO detailposts (name,descriptionHTML,descriptionMarkdown) VALUES (?,?,?)',
            [`Synthetic Frontend Developer ${tag}`, '<p>Build accessible React and TypeScript applications. Required: React, TypeScript, HTML, CSS, Git, automated testing and two years of frontend experience.</p>', 'React, TypeScript, HTML, CSS, Git and automated testing.']);
        detailId = detail.insertId;
        const [post] = await connection.query('INSERT INTO posts (userId,detailPostId,statusCode,timeEnd,createdAt,updatedAt) VALUES (?,?,?,?,NOW(),NOW())',
            [employer.id, detailId, 'PS1', String(Date.now() + 86400000)]);
        postId = post.insertId;
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        page = await context.newPage();
        page.on('pageerror', error => faults.push(error.name));
        page.on('response', response => {
            const pathname = new URL(response.url()).pathname;
            if (pathname.startsWith('/api/auth/') || pathname.includes('authorization')) authResponses.push({ path: pathname, status: response.status() });
        });
        page.on('request', request => {
            const pathname = new URL(request.url()).pathname;
            if (request.method() === 'POST' && pathname.startsWith('/api/ai/')) aiPosts.push(pathname);
        });
        page.on('dialog', dialog => dialog.accept());
        await page.goto(web + '/login');
        await page.getByPlaceholder('Email hoặc số điện thoại').fill(employer.email);
        await page.getByPlaceholder('Mật khẩu', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
        await page.waitForURL(web + '/admin/');
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('userData') || '{}').roleCode)).toBe('EMPLOYER');
        await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
        await page.goto(`${web}/admin/candiate/${candidate.id}/?jobId=${postId}`);
        await expect(page.getByRole('heading', { name: 'Thông tin chi tiết ứng viên', exact: true })).toBeVisible();
        const send = page.getByRole('button', { name: 'Phân tích CV bằng AI', exact: true });
        await expect(send).toBeEnabled();
        pass('Employer login and entitled synthetic candidate PDF loaded with owned job');
        const accepted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ai/match-cv' && response.request().method() === 'POST');
        await send.click();
        const response = await accepted;
        assert.equal(response.status(), 202);
        const { taskId } = await response.json();
        await expect(page.locator('.recruiter-ai-result')).toBeVisible({ timeout: 180000 });
        const [[task]] = await connection.query('SELECT type,status,userId,result FROM ai_tasks WHERE id = ?', [taskId]);
        assert.equal(task.type, 'match_cv'); assert.equal(task.status, 'done'); assert.equal(task.userId, employer.id);
        const result = JSON.parse(task.result);
        assert.ok(Number.isInteger(result.score) && result.score >= 0 && result.score <= 100);
        assert.ok(result.matchedSkills.some(skill => /react/i.test(skill)));
        assert.ok(result.summary.length > 0);
        pass('Real PDF screening traverses authenticated Gateway, worker, model and renders explained score');
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
        await page.reload();
        const resume = page.getByRole('button', { name: 'Kiểm tra kết quả AI', exact: true });
        await resume.click();
        await expect(page.locator('.recruiter-ai-result')).toBeVisible({ timeout: 30000 });
        assert.deepEqual(aiPosts, ['/api/ai/match-cv']);
        const [[allowance]] = await connection.query('SELECT allowCvFree FROM companies WHERE id = ?', [companyId]);
        assert.equal(allowance.allowCvFree, 1);
        pass('Refresh restores analysis without another model call or another CV view charge');
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
        assert.deepEqual(faults, []);
        pass('Mobile layout and browser runtime have no errors');
        const sentHeaders = response.request().headers();
        assert.ok(sentHeaders.authorization, 'Screening must use authenticated access');
        const headers = { Authorization: sentHeaders.authorization, 'Idempotency-Key': sentHeaders['idempotency-key'] };
        const repeated = await context.request.post(api + '/api/ai/match-cv', { headers, data: { fileBase64: pdf.toString('base64'), jobId: postId } });
        assert.equal(repeated.status(), 202); assert.equal((await repeated.json()).taskId, taskId);
        await connection.query("UPDATE companies SET censorCode = 'CS2' WHERE id = ?", [companyId]);
        const deniedRead = await context.request.get(`${api}/api/ai/tasks/${taskId}`, { headers });
        assert.equal(deniedRead.status(), 403);
        const deniedReplay = await context.request.post(api + '/api/ai/match-cv', { headers, data: { fileBase64: pdf.toString('base64'), jobId: postId } });
        assert.ok([403, 404].includes(deniedReplay.status()));
        await connection.query("UPDATE companies SET censorCode = 'CS1' WHERE id = ?", [companyId]);
        const [[tasks]] = await connection.query('SELECT COUNT(*) AS total FROM ai_tasks WHERE userId = ?', [employer.id]);
        assert.equal(tasks.total, 1);
        pass('Same-key replay reuses one task; revoked company approval blocks reads and replay');
        report.status = 'passed';
    } catch (error) {
        report.status = 'failed'; report.failure = error.message;
        report.authResponses = authResponses;
        report.failurePath = page ? new URL(page.url()).pathname : null;
        await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
        throw error;
    } finally {
        await browser?.close();
        report.aiRequests = aiPosts.length;
        for (const user of users) {
            const [[owned]] = await connection.query('SELECT id FROM users WHERE id = ? AND email = ?', [user.id, user.email]);
            assert.ok(owned, 'Synthetic cleanup ownership check failed');
            let tasks = [];
            for (let i = 0; i < 180; i++) {
                [tasks] = await connection.query('SELECT id,status FROM ai_tasks WHERE userId = ?', [user.id]);
                if (!tasks.some(task => task.status === 'pending')) break;
                await pause(1000);
            }
            assert.ok(!tasks.some(task => task.status === 'pending'), 'Paid request still running; retain its ledger for reconciliation');
            for (const task of tasks) {
                await ledger.deleteMany({ eventId: task.id, aggregateId: task.id });
                await connection.query('DELETE FROM ai_result_inbox WHERE aggregateId = ?', [task.id]);
                await connection.query('DELETE FROM outbox_events WHERE id = ? AND aggregateType = ? AND aggregateId = ?', [task.id, 'ai_task', task.id]);
            }
            await connection.query('DELETE FROM ai_request_keys WHERE userId = ?', [user.id]);
            await connection.query('DELETE FROM ai_tasks WHERE userId = ?', [user.id]);
            await mongo.db('identity_db').collection('profiles').deleteOne({ legacyUserId: user.id });
            for (const table of ['AuthSecurityEvents', 'AuthSessions', 'AuthIdentities']) await connection.query(`DELETE FROM ${table} WHERE userId = ?`, [user.id]);
        }
        if (postId) await connection.query('DELETE FROM posts WHERE id = ? AND userId = ?', [postId, users[0].id]);
        if (detailId) await connection.query('DELETE FROM detailposts WHERE id = ? AND name = ?', [detailId, `Synthetic Frontend Developer ${tag}`]);
        if (companyId) {
            await connection.query('DELETE FROM CandidateViews WHERE companyId = ?', [companyId]);
            await connection.query('UPDATE users SET companyId = NULL WHERE id = ? AND companyId = ?', [users[0].id, companyId]);
            await connection.query('DELETE FROM companies WHERE id = ? AND name = ?', [companyId, `Synthetic AI Screening ${tag}`]);
        }
        for (const user of users) {
            await connection.query('DELETE FROM usersettings WHERE userId = ?', [user.id]);
            await connection.query('DELETE FROM accounts WHERE userId = ?', [user.id]);
            await connection.query('DELETE FROM users WHERE id = ? AND email = ?', [user.id, user.email]);
        }
        report.cleaned = true; report.finishedAt = new Date().toISOString();
        await mongo.close(); await connection.end();
        await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    }
}
main().catch(error => { console.error('AI screening browser failed:', error.message); process.exitCode = 1; });
