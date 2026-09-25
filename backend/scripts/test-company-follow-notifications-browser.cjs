// Real frontend with isolated API fixtures; never writes to a real account.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../../microservices/node_modules/playwright');
const base = process.env.JOB_TEST_WEB_URL || 'http://localhost:3001';
const output = path.join(__dirname, '../../.local/company-follow-notifications');
const user = { id: 5, userId: 5, firstName: 'Ứng viên', lastName: 'Kiểm thử', roleCode: 'CANDIDATE', image: '/assetsAdmin/images/faces/face1.jpg' };
const title = 'Kỹ sư phần mềm';
const notice = id => ({ id, userId: user.id, typeCode: 'NEW_POST', isChecked: 0,
    content: `Công ty kiểm thử vừa có tin được duyệt: ${title}${id === 42 ? '' : ` ${id}`}`,
    link: `/detail-job/${id}`, createdAt: new Date(Date.now() - (100 - id) * 1000).toISOString() });
const job = { id: 42, userId: 99, statusCode: 'PS1', timePost: String(Date.now()), timeEnd: String(Date.now() + 86400000),
    companyData: { id: 6, name: 'Công ty kiểm thử', address: 'Hà Nội' },
    userPostData: { userCompanyData: { id: 6, name: 'Công ty kiểm thử' } },
    postDetailData: { name: title, descriptionHTML: '<p>Mô tả công việc kiểm thử.</p>',
        jobLevelPostData: { value: 'Nhân viên' }, provincePostData: { value: 'Hà Nội' },
        salaryTypePostData: { value: 'Thỏa thuận' }, workTypePostData: { value: 'Toàn thời gian' } } };

(async () => {
    await fs.mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
        for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
            const context = await browser.newContext({ viewport });
            await context.addInitScript(value => {
                localStorage.setItem('userData', JSON.stringify(value));
                localStorage.setItem('token_user', 'company-follow-browser-fixture');
            }, user);
            const page = await context.newPage();
            let notices = [], failLoad = false;
            const marks = [], faults = [];
            page.on('pageerror', error => faults.push(error.message));
            await page.routeWebSocket(url => url.pathname.startsWith('/socket.io'), socket => socket.close());
            await page.route('**/socket.io/**', route => route.abort());
            await page.route('**/api/**', async route => {
                const url = new URL(route.request().url());
                let result = { errCode: 0, data: [], count: 0 };
                if (url.pathname === '/api/auth/me') result = { errCode: 0, data: user };
                if (url.pathname === '/api/get-notification-by-user') {
                    const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 10);
                    result = failLoad ? { errCode: -1 } : { errCode: 0, data: notices.slice(offset, offset + limit),
                        count: notices.length, unreadCount: notices.filter(item => !item.isChecked).length };
                }
                if (url.pathname === '/api/mark-read-notification') {
                    const body = route.request().postDataJSON(); marks.push(body);
                    notices = notices.map(item => body.id && body.id !== item.id ? item : { ...item, isChecked: 1 });
                }
                if (url.pathname === '/api/get-detail-post-by-id') result = { errCode: 0, data: job };
                if (url.pathname === '/api/check-favorite-post') result = { errCode: 0, isFavorite: false };
                if (url.pathname === '/api/auth/providers') result = { google: false };
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
            });

            await page.goto(base + '/about');
            if (name === 'mobile') {
                await page.getByRole('button', { name: /^Menu/ }).click();
                await page.getByRole('navigation', { name: 'Điều hướng di động' }).getByRole('button', { name: /^Thông báo/ }).click();
            } else await page.getByRole('button', { name: 'Thông báo', exact: true }).click();
            await page.getByRole('link', { name: 'Xem tất cả thông báo', exact: true }).click();
            await page.waitForURL(base + '/candidate/notifications');
            await page.getByRole('heading', { name: 'Chưa có thông báo nào' }).waitFor();

            // A new publication reaches the inbox on reconnect, without reloading the page.
            notices = [notice(42)];
            await page.evaluate(() => window.dispatchEvent(new Event('online')));
            await page.getByText('1 thông báo · 1 chưa đọc', { exact: true }).waitFor();
            const list = page.getByRole('list', { name: 'Danh sách thông báo' });
            await list.getByRole('link', { name: notice(42).content, exact: true }).waitFor();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            await page.screenshot({ path: path.join(output, name + '-inbox.png'), fullPage: true });
            await list.getByRole('link', { name: notice(42).content, exact: true }).click();
            await page.waitForURL(base + '/detail-job/42');
            await page.getByRole('heading', { name: title, exact: true }).waitFor();
            assert.ok(marks.some(body => body.id === 42));
            assert.equal(notices[0].isChecked, 1);

            notices = [notice(42), ...Array.from({ length: 11 }, (_, i) => notice(43 + i))];
            await page.goto(base + '/candidate/notifications');
            await page.getByText('12 thông báo · 12 chưa đọc', { exact: true }).waitFor();
            assert.equal(await list.locator('li').count(), 10);
            await page.getByRole('navigation', { name: 'Phân trang thông báo' }).getByRole('button', { name: 'Trang 2', exact: true }).click();
            await page.waitForURL(base + '/candidate/notifications?page=2');
            await list.getByRole('link', { name: notice(53).content, exact: true }).waitFor();
            assert.equal(await list.locator('li').count(), 2);
            await page.getByRole('button', { name: 'Đọc tất cả', exact: true }).click();
            await page.getByText('12 thông báo · 0 chưa đọc', { exact: true }).waitFor();
            assert.ok(marks.some(body => !Object.hasOwn(body, 'id')));
            assert.ok(notices.every(item => item.isChecked === 1));

            failLoad = true;
            await page.goto(base + '/candidate/notifications');
            await page.getByRole('alert').filter({ hasText: 'Không tải được thông báo' }).waitFor();
            failLoad = false;
            await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
            await page.getByText('12 thông báo · 0 chưa đọc', { exact: true }).waitFor();
            assert.deepEqual(faults, []);
            console.log(`PASS ${name}: bell entry, empty inbox, incoming job, unread/read, exact job navigation, pagination, read-all and retry`);
            await context.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
