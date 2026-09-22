const path = require('path');
const fs = require('fs/promises');
const assert = require('node:assert/strict');
const { randomBytes } = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { chromium } = require('../../microservices/node_modules/playwright');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

(async () => {
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME });
  let userId, browser, lastPage;
  const phone = '09' + String(Date.now()).slice(-8);
  const password = randomBytes(18).toString('base64url');
  const output = path.join(__dirname, '../../.local/auth-browser');
  const email = 'auth-' + randomBytes(6).toString('hex') + '@gmail.com';
  try {
    const [user] = await connection.query('INSERT INTO users (firstName,lastName,email) VALUES (?,?,?)', ['Auth', 'QA', email]);
    userId = user.insertId;
    await connection.query('INSERT INTO accounts (userId,phonenumber,password,roleCode,statusCode,createdAt,updatedAt) VALUES (?,?,?,?,?,NOW(),NOW())', [userId, phone, await bcrypt.hash(password, 10), 'CANDIDATE', 'S1']);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    lastPage = page;
    const faults = [];
    page.on('pageerror', error => faults.push(error.message));
    const base = process.env.AUTH_TEST_WEB_URL || 'http://localhost:3001';
    const providersRoute = '**/api/auth/providers';
    // Exercise the deliberately unconfigured SSO state without contacting Google.
    const disabledGoogle = route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ google: false }) });
    await page.route(providersRoute, disabledGoogle);
    await page.goto(base + '/login');
    const login = page.locator('.jf-login');
    await login.waitFor({ state: 'visible' });
    await page.getByText('Đăng nhập Google chưa được bật. Bạn vẫn có thể dùng email hoặc số điện thoại và mật khẩu.', { exact: true }).waitFor();
    const googleLogin = page.getByRole('button', { name: 'Đăng nhập bằng Google', exact: true });
    assert.equal(await googleLogin.isVisible(), true);
    assert.equal(await googleLogin.isDisabled(), true);
    const phoneInput = page.getByPlaceholder('Email hoặc số điện thoại');
    const passwordInput = page.getByPlaceholder('Mật khẩu', { exact: true });
    assert.equal(await phoneInput.getAttribute('type'), 'text');
    assert.equal(await phoneInput.getAttribute('autocomplete'), 'username');
    assert.equal(await passwordInput.getAttribute('autocomplete'), 'current-password');
    assert.equal(await passwordInput.getAttribute('type'), 'password');
    await page.getByRole('button', { name: 'Hiện mật khẩu', exact: true }).click();
    assert.equal(await passwordInput.getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Ẩn mật khẩu', exact: true }).click();
    assert.equal(await passwordInput.getAttribute('type'), 'password');
    await fs.mkdir(output, { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, 'login-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await login.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= -1 && bounds.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
    }), true, 'Login content must fit the 390px mobile viewport without horizontal overflow');
    await page.screenshot({ path: path.join(output, 'login-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.unroute(providersRoute, disabledGoogle);
    await page.getByPlaceholder('Email hoặc số điện thoại').fill(email);
    await page.getByRole('checkbox', { name: /Ghi nhớ/ }).check();
    await page.getByPlaceholder('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.waitForURL(base + '/', { timeout: 30000 });
    await page.getByText('Auth QA', { exact: true }).first().waitFor();
    await page.goto(base + '/account/security');
    await page.getByRole('heading', { name: 'Các phiên đăng nhập' }).waitFor();
    assert.match(await page.evaluate(() => localStorage.getItem('token_user')), /^jf-session:/);
    const cookies = await context.cookies('http://localhost:4000');
    assert.ok(cookies.some(cookie => cookie.name === 'jobfind_rt' && cookie.httpOnly && cookie.sameSite === 'Lax' && cookie.expires > Date.now() / 1000));
    await page.getByText('Đăng nhập liên kết chưa được quản trị viên cấu hình.').waitFor();
    await page.getByRole('heading', { name: 'Lịch sử bảo mật' }).waitFor();
    await page.getByText('Đăng nhập thành công', { exact: true }).first().waitFor();
    await page.getByText(/Chrome · (Windows|Linux|macOS)/).first().waitFor();
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'security-desktop.png'), fullPage: true });
    await page.reload();
    await page.getByRole('heading', { name: 'Các phiên đăng nhập' }).waitFor();
    const tab = await context.newPage();
    await tab.goto(base + '/account/security');
    await tab.getByRole('heading', { name: 'Các phiên đăng nhập' }).waitFor();
    await Promise.all([page.reload(), tab.reload()]);
    await Promise.all([page.getByRole('heading', { name: 'Các phiên đăng nhập' }).waitFor(), tab.getByRole('heading', { name: 'Các phiên đăng nhập' }).waitFor()]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'security-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Đăng xuất tất cả thiết bị' }).click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
    await tab.waitForURL(/\/login/, { timeout: 15000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('token_user')), null);
    assert.equal((await context.cookies('http://localhost:4000')).some(cookie => cookie.name === 'jobfind_rt'), false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByPlaceholder('Email hoặc số điện thoại').fill(email);
    await page.getByRole('checkbox', { name: /Ghi nhớ/ }).check();
    await page.getByPlaceholder('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.waitForURL(base + '/', { timeout: 30000 });
    await page.getByText('Auth QA', { exact: true }).first().waitFor();
    await page.goto(base + '/candidate/changepassword');
    await page.locator('input[name="oldPassword"]').fill(password);
    const nextPassword = randomBytes(18).toString('base64url');
    await page.locator('input[name="password"]').fill(nextPassword);
    await page.locator('input[name="confirmPassword"]').fill(nextPassword);
    const proof = await page.evaluate(async () => {
      const response = await fetch('http://localhost:4000/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return (await response.json()).token;
    });
    assert.ok(proof);
    await page.getByRole('button', { name: /Lưu/ }).click();
    await page.waitForURL(/\/login\/?\?reason=password-changed/, { timeout: 15000 });
    await page.getByText('Đã đổi mật khẩu và đăng xuất các phiên cũ. Vui lòng đăng nhập bằng mật khẩu mới.').waitFor();
    assert.equal((await context.cookies('http://localhost:4000')).some(cookie => cookie.name === 'jobfind_rt'), false);
    const revoked = await context.request.get('http://localhost:4000/api/my-applications', { headers: { Authorization: 'Bearer ' + proof } });
    assert.equal(revoked.status(), 401);
    await page.getByPlaceholder('Email hoặc số điện thoại').fill(email);
    await page.getByPlaceholder('Mật khẩu', { exact: true }).fill(nextPassword);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.waitForURL(base + '/', { timeout: 30000 });
    assert.deepEqual(faults, []);
    console.log('PASS: desktop/mobile login layout, unavailable Google state, accessible credential inputs, password visibility, browser login through Gateway, HttpOnly cookies, refresh after reload, simultaneous tabs, desktop/mobile security page, logout-all across tabs, password change/re-login and Gateway rejection of revoked tokens.');
  } catch (error) {
    if (lastPage) {
      await fs.mkdir(output, { recursive: true });
      await lastPage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
      console.error('Failed page:', lastPage.url());
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    if (userId) {
      await connection.query('DELETE FROM AuthSecurityEvents WHERE userId = ?', [userId]);
      await connection.query('DELETE FROM accounts WHERE userId = ? AND phonenumber = ?', [userId, phone]);
      await connection.query('DELETE FROM users WHERE id = ? AND firstName = ? AND lastName = ?', [userId, 'Auth', 'QA']);
    }
    await connection.end();
  }
})().catch(error => { console.error('Auth browser test failed:', error.message); process.exitCode = 1; });
