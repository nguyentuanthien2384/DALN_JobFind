// Explicit opt-in: one real paid parse-resume request using a synthetic PDF.
// Run against the already-running local stack; never sends email or creates jobs.
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
const prefixedPdf = process.env.AI_DEMO_PDF_PREFIX === 'true';
const output = path.join(root, prefixedPdf ? '.local/ai-demo-browser-prefixed' : '.local/ai-demo-browser');
const web = process.env.AI_DEMO_WEB_URL || 'http://localhost:3001';
const api = process.env.AI_DEMO_API_URL || 'http://localhost:4000';
const mongoUrl = process.env.AI_DEMO_MONGO_URL || 'mongodb://127.0.0.1:27019';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { startedAt: new Date().toISOString(), status: 'running', syntheticDataOnly: true, prefixedPdf, checks: [] };
const pass = name => { report.checks.push(name); console.log('PASS: ' + name); };

async function main() {
  if (process.env.AI_DEMO_LIVE !== 'true') {
    console.log('SKIP: set AI_DEMO_LIVE=true to authorize one real AI request with synthetic data.');
    return;
  }
  for (const address of [web, api]) {
    const url = new URL(address);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'This test is restricted to the local demo stack');
  }
  await fs.mkdir(output, { recursive: true });
  const fixture = path.join(root, 'microservices/tests/fixtures/ai-synthetic-resume.pdf');
  const pdf = await fs.readFile(fixture);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME });
  const mongo = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000 });
  let userId, browser, page;
  const phone = '09' + String(Date.now()).slice(-8);
  const email = 'ai-demo-' + randomBytes(7).toString('hex') + '@example.invalid';
  const password = randomBytes(24).toString('base64url');
  const firstName = 'AI Demo', lastName = 'Synthetic QA';
  const profiles = mongo.db('identity_db').collection('profiles');
  const ledger = mongo.db('ai_worker_db').collection('task_executions');
  const aiPosts = [], faults = [];
  try {
    await mongo.connect();
    assert.equal((await fetch(api + '/api/auth/providers')).status, 200, 'Gateway and backend must already be running');
    const [user] = await connection.query('INSERT INTO users (firstName,lastName,email) VALUES (?,?,?)', [firstName, lastName, email]);
    userId = user.insertId;
    await connection.query('INSERT INTO accounts (userId,phonenumber,password,roleCode,statusCode,createdAt,updatedAt) VALUES (?,?,?,?,?,NOW(),NOW())',
      [userId, phone, await bcrypt.hash(password, 10), 'CANDIDATE', 'S1']);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
    page = await context.newPage();
    page.on('pageerror', error => faults.push(error.name));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/ai/') && request.method() === 'POST') aiPosts.push(url.pathname);
    });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(web + '/login');
    await page.getByPlaceholder('Email hoặc số điện thoại').fill(email);
    await page.getByPlaceholder('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.waitForURL(web + '/');
    await page.goto(web + '/candidate/ai-cv');
    await page.getByRole('heading', { name: 'CV và trợ lý AI', exact: true }).waitFor();
    const send = page.getByRole('button', { name: 'Gửi yêu cầu AI', exact: true });
    await expect(send).toBeEnabled();
    await page.getByLabel('Tệp CV PDF (tối đa 5 MiB)').setInputFiles(prefixedPdf ? {
      name: 'synthetic-cv-bom.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('\ufeff \r\n'), pdf]),
    } : fixture);
    await page.getByRole('button', { name: 'Xem trước PDF đã chọn', exact: true }).click();
    await expect(page.locator('.chat-pdf-modal canvas')).toBeVisible({ timeout: 30000 });
    await page.locator('.chat-pdf-modal .ant-modal-close').click();
    pass('Candidate login and synthetic PDF preview through the real UI');

    const accepted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ai/parse-resume'
      && response.request().method() === 'POST');
    await send.click();
    const response = await accepted;
    assert.equal(response.status(), 202, 'Real Gateway must accept the AI task');
    const { taskId } = await response.json();
    assert.match(taskId, /^[a-f0-9-]{36}$/);
    const started = Date.now();
    await page.getByRole('heading', { name: 'Kết quả', exact: true }).waitFor({ timeout: 180000 });
    report.parseElapsedMs = Date.now() - started;
    const [[task]] = await connection.query('SELECT id,type,status,userId FROM ai_tasks WHERE id = ? AND userId = ?', [taskId, userId]);
    assert.equal(task?.status, 'done');
    assert.equal(task.type, 'parse_resume');
    const [[outbox]] = await connection.query('SELECT publishedAt FROM outbox_events WHERE id = ? AND aggregateType = ? AND aggregateId = ?', [taskId, 'ai_task', taskId]);
    assert.ok(outbox?.publishedAt, 'Core must publish the durable request');
    const [[inbox]] = await connection.query('SELECT outcome FROM ai_result_inbox WHERE aggregateId = ?', [taskId]);
    assert.equal(inbox?.outcome, 'applied', 'Core must consume the real worker result');
    let execution;
    for (let i = 0; i < 20; i++) {
      execution = await ledger.findOne({ eventId: taskId, aggregateId: taskId });
      if (execution?.state === 'published') break;
      await pause(250);
    }
    assert.equal(execution?.state, 'published');
    const intentKey = `jobfind.ai.intent.v1.${userId}`;
    const originalIntent = await page.evaluate(key => sessionStorage.getItem(key), intentKey);
    assert.equal(JSON.parse(originalIntent).taskId, taskId);
    assert.equal(originalIntent.includes('fileBase64'), false);
    await page.screenshot({ path: path.join(output, 'ai-result-desktop.png'), fullPage: true });
    pass('One live parse-resume: UI, Gateway, MySQL outbox, queue worker ledger, result inbox and rendered result');

    await page.reload();
    await page.getByRole('button', { name: 'Xem / tiếp tục chờ kết quả', exact: true }).click();
    await page.getByRole('heading', { name: 'Kết quả', exact: true }).waitFor();
    assert.deepEqual(aiPosts, ['/api/ai/parse-resume'], 'Reload/result recovery must not submit another paid request');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), intentKey), originalIntent);
    const [[count]] = await connection.query('SELECT COUNT(*) AS total FROM ai_tasks WHERE userId = ?', [userId]);
    assert.equal(count.total, 1);
    assert.equal(await ledger.countDocuments({ eventId: taskId, aggregateId: taskId }), 1);
    pass('Reload recovers the saved task using GET only, with one task and one worker execution');

    await page.getByRole('button', { name: 'Xem và chỉnh sửa toàn bộ CV', exact: true }).click();
    await page.getByRole('button', { name: 'Tải danh sách CV', exact: true }).click();
    await page.getByText('Bạn chưa có CV trong danh sách này.', { exact: true }).waitFor();
    const title = 'Synthetic AI Demo CV';
    await page.getByLabel('Tên CV', { exact: true }).fill(title);
    await page.getByLabel('Giới thiệu', { exact: true }).fill('Synthetic QA candidate. Edited and approved in the browser before saving.');
    await page.getByRole('button', { name: 'Lưu CV', exact: true }).click();
    await page.getByText('Đã lưu CV.', { exact: true }).waitFor();
    await page.getByRole('button', { name: title, exact: true }).waitFor();
    let profile = await profiles.findOne({ legacyUserId: userId });
    assert.equal(profile.cvs.length, 1);
    assert.equal(profile.cvs[0].title, title);
    const cvId = profile.cvs[0]._id.toString();
    const editedTitle = title + ' Updated';
    await page.getByLabel('Tên CV', { exact: true }).fill(editedTitle);
    await page.getByRole('button', { name: 'Lưu CV', exact: true }).click();
    await page.getByRole('button', { name: editedTitle, exact: true }).waitFor();
    profile = await profiles.findOne({ legacyUserId: userId });
    assert.equal(profile.cvs.length, 1);
    assert.equal(profile.cvs[0]._id.toString(), cvId);
    assert.equal(profile.cvs[0].title, editedTitle);
    pass('Parsed CV can be edited, created and updated in MongoDB through the UI');

    const preview = page.getByRole('button', { name: 'Xem trước / tải PDF bản nháp', exact: true });
    if (await preview.count()) {
      await preview.click();
      await expect(page.locator('.chat-pdf-modal canvas')).toBeVisible({ timeout: 45000 });
      await page.screenshot({ path: path.join(output, 'prepared-cv-preview.png'), fullPage: true });
      const downloaded = page.waitForEvent('download');
      await page.getByRole('link', { name: 'Tải PDF', exact: true }).click();
      const file = await downloaded;
      const destination = path.join(output, 'synthetic-prepared-cv.pdf');
      await file.saveAs(destination);
      assert.equal((await fs.readFile(destination)).subarray(0, 5).toString(), '%PDF-');
      await page.locator('.chat-pdf-modal .ant-modal-close').click();
      pass('Edited CV renders in PDF preview and downloads as a real PDF');
    } else report.pdfPreview = 'skipped-feature-disabled';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'ai-cv-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Xóa CV', exact: true }).click();
    await page.getByText('Đã xóa CV.', { exact: true }).waitFor();
    assert.equal((await profiles.findOne({ legacyUserId: userId })).cvs.length, 0);
    assert.deepEqual(aiPosts, ['/api/ai/parse-resume']);
    assert.deepEqual(faults, []);
    pass('Mobile layout fits and CV deletion removes only the synthetic CV');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    // Screenshots contain synthetic input only; do not log network bodies, tokens or credentials.
    report.failure = error.message;
    if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    report.aiRequests = aiPosts.length;
    if (userId) {
      const [[owned]] = await connection.query('SELECT id FROM users WHERE id = ? AND email = ? AND firstName = ? AND lastName = ?', [userId, email, firstName, lastName]);
      assert.ok(owned, 'Cleanup ownership check failed');
      let tasks = [];
      // Do not remove an execution while its paid request is still in flight.
      for (let i = 0; i < 120; i++) {
        [tasks] = await connection.query('SELECT id,status FROM ai_tasks WHERE userId = ?', [userId]);
        if (!tasks.some(task => task.status === 'pending')) break;
        await pause(1000);
      }
      assert.ok(!tasks.some(task => task.status === 'pending'), 'Synthetic task still running; preserve its claim for manual reconciliation');
      for (const task of tasks) {
        await ledger.deleteMany({ eventId: task.id, aggregateId: task.id });
        await connection.query('DELETE FROM ai_result_inbox WHERE aggregateId = ?', [task.id]);
        await connection.query('DELETE FROM outbox_events WHERE id = ? AND aggregateType = ? AND aggregateId = ?', [task.id, 'ai_task', task.id]);
      }
      await connection.query('DELETE FROM ai_request_keys WHERE userId = ?', [userId]);
      await connection.query('DELETE FROM ai_tasks WHERE userId = ?', [userId]);
      await profiles.deleteOne({ legacyUserId: userId });
      for (const table of ['AuthSecurityEvents', 'AuthSessions', 'AuthIdentities']) await connection.query(`DELETE FROM ${table} WHERE userId = ?`, [userId]);
      await connection.query('DELETE FROM accounts WHERE userId = ? AND phonenumber = ?', [userId, phone]);
      await connection.query('DELETE FROM users WHERE id = ? AND email = ?', [userId, email]);
      const [[remaining]] = await connection.query('SELECT COUNT(*) AS total FROM users WHERE id = ?', [userId]);
      assert.equal(remaining.total, 0);
      report.cleaned = true;
    }
    await mongo.close();
    await connection.end();
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
main().catch(error => { console.error('AI demo browser failed:', error.message); process.exitCode = 1; });
