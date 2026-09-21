// Browser acceptance for the public, two-step registration page.
// One random QA candidate is created through the real API, then removed. A
// supplied password prevents registration mail; employer/error cases are mocked.
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { randomBytes, randomInt } = require('node:crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { chromium, expect } = require('@playwright/test');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

(async () => {
  const base = process.env.AUTH_TEST_WEB_URL || 'http://localhost:3001';
  const output = path.resolve(__dirname, '../../.local/register-browser');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME
  });
  const email = `jobfind-register-qa-${randomBytes(10).toString('hex')}@gmail.com`;
  const password = 'Qa' + randomBytes(8).toString('hex');
  let phone, browser, page, fixtureReserved = false;
  try {
    do {
      phone = '09' + randomInt(10000000, 100000000);
      const [existing] = await connection.query('SELECT id FROM Accounts WHERE phonenumber=?', [phone]);
      if (!existing.length) break;
    } while (true);
    const [existingEmails] = await connection.query('SELECT id FROM Users WHERE email=?', [email]);
    assert.equal(existingEmails.length, 0, 'QA email must be unique before the browser creates it');
    fixtureReserved = true;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    page = await context.newPage();
    const faults = [], prechecks = [], submissions = [];
    page.on('pageerror', error => faults.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/api/check-phonenumber-user')) prechecks.push(request.url());
      if (request.url().includes('/api/create-new-user') && request.method() === 'POST') submissions.push(request.postDataJSON());
    });
    const form = () => page.locator('.jf-register');
    const input = name => page.getByPlaceholder(name, { exact: true });
    const next = () => page.getByRole('button', { name: 'Tiếp tục', exact: true });
    const back = () => page.getByRole('button', { name: /Quay lại/ });
    const submit = () => page.getByRole('button', { name: 'Tạo tài khoản', exact: true });
    async function identity() {
      await input('Họ').fill('Register');
      await input('Tên').fill('QA');
      await input('Email').fill(email);
    }
    async function credentials() {
      await input('Số điện thoại').fill(phone);
      await input('Mật khẩu').fill(password);
      await input('Nhập lại mật khẩu').fill(password);
    }
    async function captureFit(filename, width, height) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => document.fonts.ready);
      await expect.poll(() => page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth > innerWidth + 1,
        vertical: document.documentElement.scrollHeight > innerHeight + 1
      }))).toEqual({ horizontal: false, vertical: false });
      await page.screenshot({ path: path.join(output, filename), fullPage: true });
    }
    await fs.mkdir(output, { recursive: true });
    await page.goto(base + '/register');
    await form().waitFor({ state: 'visible' });
    const candidate = page.getByRole('radio', { name: /Ứng viên/ });
    await expect(candidate).toBeChecked();
    await expect(page.getByRole('radio', { name: /Nhà tuyển dụng/ })).not.toBeChecked();
    await captureFit('register-step-1-desktop.png', 1366, 768);
    await captureFit('register-step-1-mobile.png', 375, 667);
    await next().click();
    await expect(input('Họ')).toHaveAttribute('aria-invalid', 'true');
    assert.equal(submissions.length, 0, 'Invalid identity must not create an account');
    await identity();
    await next().click();
    await input('Số điện thoại').waitFor();
    await expect(input('Số điện thoại')).toHaveAttribute('type', 'tel');
    await expect(input('Mật khẩu')).toHaveAttribute('autocomplete', 'new-password');
    await credentials();
    await page.getByRole('button', { name: 'Hiện mật khẩu', exact: true }).click();
    await expect(input('Mật khẩu')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Ẩn mật khẩu', exact: true }).click();
    await expect(input('Mật khẩu')).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Hiện mật khẩu nhập lại', exact: true }).click();
    await expect(input('Nhập lại mật khẩu')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Ẩn mật khẩu nhập lại', exact: true }).click();
    await captureFit('register-step-2-mobile.png', 375, 667);
    await captureFit('register-step-2-desktop.png', 1366, 768);
    await back().click();
    await expect(input('Họ')).toHaveValue('Register');
    await expect(input('Tên')).toHaveValue('QA');
    await expect(input('Email')).toHaveValue(email);
    await page.getByRole('radio', { name: /Nhà tuyển dụng/ }).check();
    await next().click();
    await expect(input('Số điện thoại')).toHaveValue(phone);
    await expect(input('Mật khẩu')).toHaveValue(password);
    await expect(input('Nhập lại mật khẩu')).toHaveValue(password);

    // Public employer selection and inline API errors can be checked without
    // creating a second account or contacting any recipient.
    const duplicateMessage = 'Số điện thoại đã tồn tại !';
    const createRoute = '**/api/create-new-user';
    const mockedDuplicate = route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ errCode: 1, errMessage: duplicateMessage }) });
    await page.route(createRoute, mockedDuplicate);
    await input('Nhập lại mật khẩu').fill(password + 'x');
    await submit().click();
    await expect(input('Nhập lại mật khẩu')).toHaveAttribute('aria-invalid', 'true');
    assert.equal(submissions.length, 0, 'Mismatched passwords must not be submitted');
    await input('Nhập lại mật khẩu').fill(password);
    await submit().click();
    await form().getByText(duplicateMessage, { exact: true }).first().waitFor();
    assert.equal(submissions.length, 1);
    assert.deepEqual(submissions[0], { firstName: 'Register', lastName: 'QA', email, phonenumber: phone, password, roleCode: 'EMPLOYER' });
    await expect(submit()).toBeEnabled();
    await expect(input('Số điện thoại')).toHaveValue(phone);
    await page.unroute(createRoute, mockedDuplicate);

    // The candidate is registered and automatically logged in through the real
    // gateway. The generated password is always supplied; no welcome mail or
    // remote avatar upload is requested.
    await page.goto(base + '/register');
    await identity();
    await expect(page.getByRole('radio', { name: /Ứng viên/ })).toBeChecked();
    await next().click();
    await credentials();
    const created = page.waitForResponse(response => response.url().includes('/api/create-new-user') && response.request().method() === 'POST').then(response => response.status());
    // Successful login navigates away immediately. Check its status, resulting
    // authenticated UI, HttpOnly cookie and DB state instead of reading a body
    // Chromium may discard along with the previous document.
    const loggedIn = page.waitForResponse(response => response.url().endsWith('/api/login') && response.request().method() === 'POST').then(response => ({ url: response.url(), status: response.status() }));
    // Observe early failures too if registration fails before login is started.
    loggedIn.catch(() => {});
    await submit().click();
    const createResponse = await created;
    assert.equal(createResponse, 200, 'Real registration must succeed');
    const loginResponse = await loggedIn;
    assert.equal(loginResponse.status, 200, 'Registration must establish a session');
    await page.waitForURL(base + '/', { timeout: 30000 });
    await page.getByText('Register QA', { exact: true }).first().waitFor();
    assert.match(await page.evaluate(() => localStorage.getItem('token_user')), /^jf-session:/);
    const cookies = await context.cookies(new URL(loginResponse.url).origin);
    assert.ok(cookies.some(cookie => cookie.name === 'jobfind_rt' && cookie.httpOnly), 'Refresh cookie must be HttpOnly');
    const [rows] = await connection.query('SELECT u.firstName,u.lastName,u.email,u.image,u.companyId,a.roleCode,a.password,a.statusCode FROM Users u JOIN Accounts a ON a.userId=u.id WHERE u.email=? AND a.phonenumber=?', [email, phone]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].firstName, 'Register');
    assert.equal(rows[0].lastName, 'QA');
    assert.equal(rows[0].email, email);
    assert.equal(rows[0].roleCode, 'CANDIDATE');
    assert.equal(rows[0].statusCode, 'S1');
    assert.equal(rows[0].companyId, null);
    assert.ok(!rows[0].image, 'Registration must not upload a default remote image');
    assert.notEqual(rows[0].password, password);
    assert.ok(await bcrypt.compare(password, rows[0].password));
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[1], { firstName: 'Register', lastName: 'QA', email, phonenumber: phone, password, roleCode: 'CANDIDATE' });
    assert.deepEqual(prechecks, [], 'Registration must not use the removed phone precheck endpoint');
    assert.deepEqual(faults, []);
    console.log('PASS: two-step registration on desktop/mobile without document scroll; identity and credential validation; both password toggles; Back preserves values; employer payload and inline duplicate error; real candidate registration, persisted fields and hashed password, automatic gateway login and HttpOnly session.');
  } catch (error) {
    await fs.mkdir(output, { recursive: true });
    if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    if (fixtureReserved) {
      // Exact random identity guards cleanup, including a partial registration
      // where the user row was created but account creation failed.
      const [users] = await connection.query('SELECT id FROM Users WHERE email=? AND firstName=? AND lastName=?', [email, 'Register', 'QA']);
      for (const user of users) {
        await connection.query('DELETE FROM AuthSecurityEvents WHERE userId=?', [user.id]);
        await connection.query('DELETE FROM Accounts WHERE userId=? AND phonenumber=?', [user.id, phone]);
        await connection.query('DELETE FROM Users WHERE id=? AND email=? AND NOT EXISTS (SELECT 1 FROM Accounts WHERE userId=?)', [user.id, email, user.id]);
      }
    }
    await connection.end();
  }
})().catch(error => { console.error('Registration browser test failed:', error.message); process.exitCode = 1; });
