// Real frontend routes with API fixtures; no real notifications are marked read.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../../microservices/node_modules/playwright');
const { normalizeNotificationDestination } = require('../src/utils/notificationDestination');
const base = process.env.JOB_TEST_WEB_URL || 'http://localhost:3001';
const output = path.join(__dirname, '../../.local/notification-navigation');
const user = { id: 5, userId: 5, firstName: 'Ứng viên', lastName: 'Kiểm thử', roleCode: 'CANDIDATE' };
const notices = [
    { id: 1, userId: 5, typeCode: 'NEW_POST', content: 'Công ty bạn theo dõi vừa đăng tin tuyển dụng mới', link: '/job', isChecked: 1 },
    { id: 2, userId: 5, typeCode: 'NEW_POST', content: 'Có 2 việc làm mới phù hợp với kỹ năng của bạn', link: '/job', isChecked: 1 },
    { id: 3, userId: 5, typeCode: 'NEW_POST', content: 'Tin tuyển dụng mới: Kỹ sư phần mềm', link: '/detail-job/42', isChecked: 0 },
].map(normalizeNotificationDestination);
const job = id => ({
    id, userId: 99, statusCode: 'PS1', timePost: String(Date.now() - 86400000), timeEnd: String(Date.now() + 86400000),
    companyData: { id: 6, name: 'Công ty kiểm thử', address: 'Hà Nội' },
    userPostData: { userCompanyData: { id: 6, name: 'Công ty kiểm thử' } },
    postDetailData: { name: id === 42 ? 'Kỹ sư phần mềm' : 'Chuyên viên phân tích dữ liệu', descriptionHTML: '<p>Mô tả công việc kiểm thử.</p>',
        jobLevelPostData: { value: 'Nhân viên' }, provincePostData: { value: 'Hà Nội' },
        salaryTypePostData: { value: 'Thỏa thuận' }, workTypePostData: { value: 'Toàn thời gian' } },
});

(async () => {
    await fs.mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
        for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
            const context = await browser.newContext({ viewport });
            await context.addInitScript(value => {
                localStorage.setItem('userData', JSON.stringify(value));
                localStorage.setItem('token_user', 'notification-browser-fixture');
            }, user);
            const page = await context.newPage();
            const faults = [], sources = [];
            page.on('pageerror', failure => faults.push(failure.message));
            await page.routeWebSocket(url => url.pathname.startsWith('/socket.io'), socket => socket.close());
            await page.route('**/socket.io/**', route => route.abort());
            await page.route('**/api/**', async route => {
                const url = new URL(route.request().url());
                let result = { errCode: 0, data: [], count: 0 };
                if (url.pathname === '/api/auth/me') result = { errCode: 0, data: user };
                if (url.pathname === '/api/get-notification-by-user') result = { errCode: 0, data: notices, count: notices.length, unreadCount: 1 };
                if (url.pathname === '/api/get-notification-jobs') {
                    assert.equal(url.searchParams.has('userId'), false);
                    const source = url.searchParams.get('source'); sources.push(source);
                    result = { errCode: 0, data: [job(source === 'followed' ? 42 : 43)], count: 1, source };
                }
                if (url.pathname === '/api/get-detail-post-by-id') result = { errCode: 0, data: job(Number(url.searchParams.get('id'))) };
                if (url.pathname === '/api/check-favorite-post') result = { errCode: 0, isFavorite: false };
                if (url.pathname === '/api/auth/providers') result = { google: false };
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
            });
            for (let index = 0; index < notices.length; index++) {
                const notice = notices[index];
                await page.goto(base + '/about');
                if (name === 'mobile') {
                    await page.getByRole('button', { name: /^Menu/ }).click();
                    await page.getByRole('navigation', { name: 'Điều hướng di động' }).getByRole('button', { name: /^Thông báo/ }).click();
                } else await page.getByRole('button', { name: 'Thông báo', exact: true }).click();
                await page.getByText(notice.content, { exact: true }).click();
                await page.waitForURL(base + notice.link);
                const expectedJob = index === 1 ? job(43) : job(42);
                if (index < 2) {
                    const card = page.getByRole('link', { name: new RegExp(expectedJob.postDetailData.name) });
                    await card.waitFor();
                    assert.equal(await card.getAttribute('href'), '/detail-job/' + expectedJob.id);
                    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                    await page.screenshot({ path: path.join(output, name + '-' + (index === 0 ? 'followed' : 'recommended') + '.png'), fullPage: true });
                    await card.click();
                    await page.waitForURL(base + '/detail-job/' + expectedJob.id);
                }
                await page.getByRole('heading', { name: expectedJob.postDetailData.name, exact: true }).waitFor();
            }
            assert.ok(sources.includes('followed') && sources.includes('recommended'));
            assert.deepEqual(faults, []);
            console.log('PASS ' + name + ': both legacy collection links and new job notification open their intended destinations');
            await context.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
