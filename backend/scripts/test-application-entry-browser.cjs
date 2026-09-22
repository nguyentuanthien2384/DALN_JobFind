// Real frontend pages and navigation, with API fixtures. Never sends a real CV
// or creates an account. Run against the development server on port 3001.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../../microservices/node_modules/playwright');

const base = process.env.JOB_TEST_WEB_URL || 'http://localhost:3001';
const output = path.join(__dirname, '../../.local/application-entry');
const title = 'Chuyên viên phát triển sản phẩm';
const intentKey = 'jobfind:application-intent';

(async () => {
    await fs.mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
        for (const scenario of [
            { name: 'desktop', width: 1440, height: 1000, roleCode: 'CANDIDATE' },
            { name: 'mobile', width: 390, height: 844, roleCode: 'CANDIDATE' },
            { name: 'employer', width: 1440, height: 1000, roleCode: 'EMPLOYER' },
            { name: 'expired', width: 1440, height: 1000, roleCode: 'CANDIDATE', expiresDuringLogin: true },
        ]) {
            const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height } });
            const page = await context.newPage();
            // Keep fixture credentials out of the real Socket.IO server too.
            await page.routeWebSocket(url => url.pathname.startsWith('/socket.io'), socket => socket.close());
            await page.route('**/socket.io/**', route => route.abort());
            const faults = [];
            page.on('pageerror', error => faults.push(error.message));
            let loggedIn = false, submissions = 0;
            const user = { id: 98765, userId: 98765, firstName: 'Ứng viên', lastName: 'Kiểm thử', roleCode: scenario.roleCode };
            const token = 'browser-fixture.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.fixture';
            await page.route('**/api/**', async route => {
                const pathname = new URL(route.request().url()).pathname;
                let result = { errCode: 0, data: [], count: 0 };
                if (pathname === '/api/get-detail-post-by-id') result = { errCode: 0, data: {
                    id: 42, userId: 99, statusCode: 'PS1', timePost: Date.now() - 86400000,
                    timeEnd: Date.now() + (loggedIn && scenario.expiresDuringLogin ? -1000 : 86400000),
                    companyData: { id: 9, name: 'Công ty kiểm thử JobFind', address: 'Hà Nội', amountEmployer: 100 },
                    postDetailData: { name: title, descriptionHTML: '<p>Phát triển sản phẩm và phối hợp với đội ngũ kỹ thuật.</p>',
                        requirementsHTML: '<p>Có kinh nghiệm làm việc nhóm.</p>', provincePostData: { value: 'Hà Nội' },
                        salaryTypePostData: { value: 'Thỏa thuận' }, workTypePostData: { value: 'Toàn thời gian' }, amount: 2 },
                } };
                if (pathname === '/api/login') { loggedIn = true; result = { errCode: 0, token, user }; }
                if (pathname === '/api/auth/refresh') result = { errCode: 0, token, user };
                if (pathname === '/api/auth/me') result = { errCode: 0, data: user };
                if (pathname === '/api/auth/providers') result = { google: false, github: false, auth0: false };
                if (pathname === '/api/check-favorite-post') result = { errCode: 0, isFavorite: false };
                if (pathname === '/api/get-detail-user-by-id') result = { errCode: 0, data: { userAccountData: {} } };
                if (pathname === '/api/create-new-cv') { submissions++; result = { errCode: 0 }; }
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
            });
            await page.goto(base + '/detail-job/42');
            await page.getByRole('heading', { name: title, exact: true }).waitFor();
            assert.equal(await page.evaluate(() => localStorage.getItem('token_user')), null);
            await page.getByText('Bạn có thể xem đầy đủ thông tin công việc.', { exact: false }).waitFor();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            await page.screenshot({ path: path.join(output, scenario.name + '-public.png'), fullPage: true });

            await page.getByRole('button', { name: 'Nộp CV ngay', exact: true }).first().click();
            await page.waitForURL(base + '/login');
            await page.locator('.jf-login__notice').filter({ hasText: title }).waitFor();
            if (scenario.name === 'mobile') {
                await page.getByRole('link', { name: /Tạo tài khoản ngay/ }).click();
                await page.waitForURL(base + '/register');
                await page.locator('.jf-login__notice').filter({ hasText: title }).waitFor();
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                await page.screenshot({ path: path.join(output, 'mobile-register.png'), fullPage: true });
                await page.getByRole('link', { name: 'Đăng nhập ngay', exact: true }).click();
                await page.waitForURL(base + '/login');
            }
            if (scenario.name === 'desktop') {
                await page.getByRole('link', { name: 'Quay lại xem công việc' }).click();
                await page.waitForURL(base + '/detail-job/42');
                assert.equal(await page.evaluate(key => sessionStorage.getItem(key), intentKey), null);
                await page.getByRole('button', { name: 'Nộp CV ngay', exact: true }).first().click();
                await page.waitForURL(base + '/login');
            }
            await page.getByRole('heading', { name: 'Đăng nhập', exact: true }).waitFor();
            await page.screenshot({ path: path.join(output, scenario.name + '-login.png'), fullPage: true });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            await page.getByPlaceholder('Email hoặc số điện thoại').fill('fixture@example.test');
            await page.getByPlaceholder('Mật khẩu', { exact: true }).fill('BrowserFixture!123');
            await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
            await page.waitForURL(base + '/detail-job/42');
            if (scenario.expiresDuringLogin) {
                await page.getByText('Tin tuyển dụng đã hết hạn hoặc ngừng nhận hồ sơ.', { exact: false }).waitFor();
                assert.equal(await page.getByRole('dialog').count(), 0);
            } else if (scenario.roleCode !== 'CANDIDATE') {
                await page.getByText('Ứng tuyển dành cho tài khoản ứng viên.', { exact: false }).waitFor();
                assert.equal(await page.getByRole('dialog').count(), 0);
                assert.equal(await page.getByRole('button', { name: 'Nộp CV ngay', exact: true }).count(), 0);
            } else {
                await page.getByRole('dialog').waitFor();
                await page.getByRole('dialog').getByText(title, { exact: true }).waitFor();
                await page.waitForFunction(() => getComputedStyle(document.querySelector('.modal')).opacity === '1');
                await page.screenshot({ path: path.join(output, scenario.name + '-resume.png'), fullPage: true });
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                await page.getByRole('button', { name: 'Hủy', exact: true }).click();
                await page.getByRole('dialog').waitFor({ state: 'hidden' });
                await page.reload();
                await page.getByRole('heading', { name: title, exact: true }).waitFor();
                assert.equal(await page.getByRole('dialog').count(), 0, 'Reload must not reopen a dismissed application');
            }
            assert.equal(await page.evaluate(key => sessionStorage.getItem(key), intentKey), null);
            assert.equal(submissions, 0, 'Authentication must never submit a CV');
            assert.deepEqual(faults, []);
            console.log('PASS ' + scenario.name + ': public details, contextual authentication, safe application continuation');
            await context.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
