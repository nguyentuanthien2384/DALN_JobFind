const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('@playwright/test');

module.exports = async ({ app, base, providerBase, setMode }) => {
  const build = path.resolve(process.env.AUTH_TEST_FRONTEND_BUILD);
  await fs.access(path.join(build, 'index.html'));
  app.use(express.static(build, { dotfiles: 'allow' }));
  app.get(/^\/(?!api\/|fixture\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(build, 'index.html'), { dotfiles: 'allow' }));
  const browser = await chromium.launch({ headless: true });
  let page;
  const output = path.resolve(__dirname, '../../../.local/auth-oidc-browser');
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    // The browser visits a fixture authorization server over real HTTP. All
    // cryptographic/token validation remains in the real backend OIDC client.
    await context.route(base + '/api/auth/sso/google/start', async route => {
      const response = await route.fetch({ maxRedirects: 0 });
      const address = new URL(response.headers().location);
      assert.equal(address.origin, 'https://accounts.google.com');
      await route.fulfill({ response, headers: { ...response.headers(), location: providerBase + address.pathname + address.search } });
    });
    await context.route('https://accounts.google.com/**', route => route.abort());
    page = await context.newPage();
    await page.goto(base + '/login');
    await page.evaluate(() => localStorage.setItem('lastUrl', '/account/security'));
    await page.getByRole('button', { name: 'Đăng nhập bằng Google' }).click();
    await page.waitForURL(base + '/account/security', { timeout: 30000 });
    await page.getByRole('heading', { name: 'Lịch sử bảo mật' }).waitFor();
    await page.getByText('Đăng nhập thành công', { exact: true }).first().waitFor();
    assert.match(await page.evaluate(() => localStorage.getItem('token_user')), /^jf-session:/);
    assert.equal(await page.evaluate(() => document.cookie.includes('jobfind_rt')), false);
    const stored = await page.evaluate(() => ({ local: Object.assign({}, localStorage), session: Object.assign({}, sessionStorage) }));
    const refreshCookie = (await context.cookies(base)).find(c => c.name === 'jobfind_rt');
    assert.ok(refreshCookie?.httpOnly && refreshCookie.sameSite === 'Lax');
    assert.equal(JSON.stringify(stored).includes(refreshCookie.value), false);
    assert.equal(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(JSON.stringify(stored)), false);
    assert.equal(page.url().includes('token='), false);
    await page.reload();
    await page.getByRole('heading', { name: 'Các phiên đăng nhập' }).waitFor();
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'sso-security.png'), fullPage: true });
    const tab = await context.newPage();
    await tab.goto(base + '/account/security');
    await tab.getByRole('heading', { name: 'Các phiên đăng nhập' }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Đăng xuất tất cả thiết bị' }).click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
    await tab.waitForURL(/\/login/, { timeout: 15000 });
    assert.equal((await context.cookies(base)).some(c => c.name === 'jobfind_rt'), false);
    setMode('cancelled');
    await page.getByRole('button', { name: 'Đăng nhập bằng Google' }).click();
    await page.getByText('Bạn đã hủy đăng nhập Google. Có thể thử lại hoặc đăng nhập bằng mật khẩu.').waitFor();
    setMode('signature');
    await page.getByRole('button', { name: 'Đăng nhập bằng Google' }).click();
    await page.waitForURL(/\/login\/?\?sso=failed/);
    assert.equal(await page.evaluate(() => localStorage.getItem('token_user')), null);
    setMode('valid');
    // The unchanged CANDIDATE role from the local DB cannot render admin tools.
    await page.evaluate(() => localStorage.setItem('lastUrl', '/admin/'));
    await page.getByRole('button', { name: 'Đăng nhập bằng Google' }).click();
    await page.waitForURL(/\/forbidden/, { timeout: 30000 });
    console.log('PASS: real React browser SSO, HttpOnly/memory-only credentials, reload, security history, two-tab logout, IdP cancel/signature error, forbidden route.');
  } catch (error) {
    await fs.mkdir(output, { recursive: true });
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
      console.error('OIDC browser failed on:', page.url());
    }
    throw error;
  } finally {
    setMode('valid');
    await browser.close();
  }
};
