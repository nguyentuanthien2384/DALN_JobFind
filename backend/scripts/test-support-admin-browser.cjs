// Live admin layout smoke check. Creates/deletes only a random QA administrator;
// it never claims real tickets, sends messages, or inspects private transcripts.
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { chromium } = require('@playwright/test');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

(async () => {
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME });
  const phone = '09' + String(Date.now()).slice(-8), password = randomBytes(20).toString('base64url');
  const output = path.resolve(__dirname, '../../.local/support-admin-browser');
  let userId, browser, page;
  try {
    const [created] = await connection.query('INSERT INTO Users (firstName,lastName,email) VALUES (?,?,?)', ['Support', 'QA', `support-${randomBytes(6).toString('hex')}@example.invalid`]);
    userId = created.insertId;
    await connection.query('INSERT INTO Accounts (userId,phonenumber,password,roleCode,statusCode,createdAt,updatedAt) VALUES (?,?,?,?,?,NOW(),NOW())', [userId, phone, await bcrypt.hash(password, 10), 'ADMIN', 'S1']);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:3001/login');
    await page.getByPlaceholder('Số điện thoại').fill(phone);
    await page.getByPlaceholder('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.waitForURL(/\/admin\/?$/, { timeout: 30000 });
    await page.getByText('Hỗ trợ chatbot', { exact: true }).waitFor();
    await page.goto('http://localhost:3001/admin/support');
    await page.getByRole('heading', { name: 'Danh sách yêu cầu' }).waitFor();
    const refresh = page.getByRole('button', { name: 'Làm mới', exact: true });
    await refresh.waitFor();
    await page.getByText(/Cập nhật lúc/).waitFor();
    const paint = await refresh.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
    assert.equal(paint.background, 'rgb(8, 127, 140)'); assert.equal(paint.color, 'rgb(255, 255, 255)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'admin-desktop.png'), fullPage: true });
    const response = page.waitForResponse(r => r.url().includes('/api/support/handoffs') && r.request().method() === 'GET');
    await refresh.click(); assert.equal((await response).status(), 200);
    await refresh.waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'admin-mobile.png'), fullPage: true });
    assert.equal(await page.locator('.jf-support-inbox').evaluate(element => element.scrollWidth > element.clientWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS: real admin login, support queue through Gateway, teal/white refresh button, working refresh, desktop/mobile layout. No real tickets or messages modified.');
  } catch (error) {
    await fs.mkdir(output, { recursive: true });
    if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    if (userId) {
      await connection.query('DELETE FROM AuthSecurityEvents WHERE userId=?', [userId]);
      await connection.query('DELETE FROM Accounts WHERE userId=? AND phonenumber=?', [userId, phone]);
      await connection.query('DELETE FROM Users WHERE id=? AND firstName=? AND lastName=?', [userId, 'Support', 'QA']);
    }
    await connection.end();
  }
})().catch(error => { console.error('Admin support browser failed:', error.message); process.exitCode = 1; });
