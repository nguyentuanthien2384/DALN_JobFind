// Uses synthetic API responses and blocks sockets/external requests. No account or provider writes.
// Run against the local frontend: node scripts/check-candidate-layout.cjs
const path = require('node:path');
const { createRequire } = require('node:module');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { chromium } = createRequire(path.join(__dirname, '../microservices/package.json'))('playwright/test');
const assert = require('node:assert/strict');
const origin = new URL(process.env.LAYOUT_BASE_URL || 'http://localhost:3001').origin;
const evidence = mkdtempSync(path.join(tmpdir(), 'jobfind-candidate-layout-'));
const user = { id: 999999, roleCode: 'CANDIDATE', firstName: 'Kiểm thử', lastName: 'Bố cục', email: 'fixture@example.test' };
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect width="600" height="240" fill="#cee0fb"/></svg>');
const company = { id: 999999, name: 'Công ty kiểm thử bố cục với tên dài dành cho màn hình điện thoại', coverimage: image, thumbnail: image,
    website: 'https://example.test/a-long-company-website', amountEmployer: 50, address: 'Địa chỉ mẫu kiểm thử', descriptionHTML: '<p>Nội dung giới thiệu công ty.</p>', censorData: { code: 'CS1', value: 'Đã duyệt' },
    postData: [{ id: 999999, timeEnd: Date.now() + 86400000, createdAt: new Date().toISOString(), postDetailData: { name: 'Lập trình viên có kinh nghiệm phát triển ứng dụng trên thiết bị di động', provincePostData: { value: 'Hồ Chí Minh' }, salaryTypePostData: { value: 'Thỏa thuận' } } }] };
const savedJob = { id: 999999, createdAt: new Date().toISOString(), postFavoriteData: { ...company.postData[0], userPostData: { userCompanyData: company } } };
const endpoints = [];
(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    await context.addInitScript(user => {
        if (window.top !== window) return;
        localStorage.setItem('token_user', `${btoa('{}')}.${btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.fixture`);
        localStorage.setItem('userData', JSON.stringify(user));
    }, user);
    await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.pathname.startsWith('/api/')) {
            endpoints.push(url.pathname);
            let data = { errCode: 0, data: [], count: 0, averageStar: 0, totalUnread: 0, unreadCount: 0, cvs: [], events: [], identities: [], sessions: [] };
            if (url.pathname === '/api/auth/me') data.data = { userId: user.id, roleCode: user.roleCode };
            if (url.pathname === '/api/get-detail-user-by-id') data.data = { ...user, phonenumber: '0900000000', userAccountData: { ...user, genderCode: 'M', dob: 946684800000, address: 'Địa chỉ mẫu', image: image, userSettingData: {} } };
            if (url.pathname === '/api/get-list-company') { data.data = Array.from({ length: 3 }, (_, id) => ({ ...company, id })); data.count = 3; }
            if (url.pathname === '/api/get-detail-company-by-id') data.data = company;
            if (url.pathname === '/api/get-favorite-post-by-user') { data.data = [savedJob]; data.count = 1; }
            if (url.pathname === '/api/auth/security') data.sessions = [{ familyId: 'fixture', current: true, method: 'password', deviceLabel: 'Thiết bị kiểm thử', startedAt: new Date().toISOString() }];
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } });
        }
        if (url.origin !== origin || url.pathname.startsWith('/socket.io')) return route.abort();
        return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const paths = ['/candidate/info', '/candidate/usersetting', '/candidate/changepassword', '/candidate/saved-jobs', '/candidate/followed-jobs', '/candidate/ai-cv', '/company', '/detail-company/999999', '/account/security'];
    const results = [];
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of paths) {
            console.log('Checking', width, path);
            await page.goto(origin + path);
            const selector = path.startsWith('/candidate') ? '.candidate-shell .content-wrapper' : path.startsWith('/detail-company') ? '.company-detail-overview' : path.startsWith('/company') ? '.container-company' : '.security-settings';
            await page.locator(selector).waitFor();
            await page.waitForTimeout(600);
            if (!(await page.locator(selector).count())) { console.log('Page state', await page.locator('body').innerText(), errors); await browser.close(); throw new Error('Page disappeared: ' + path); }
            const metric = await page.evaluate(selector => {
                const node = document.querySelector(selector), rect = node.getBoundingClientRect(), body = document.querySelector('.candidate-shell .page-body-wrapper'), panel = document.querySelector('.candidate-shell .main-panel');
                const overflow = Array.from(document.querySelectorAll('body *')).filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 2 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 8).map(e => ({ tag: e.tagName, cls: e.className, right: Math.round(e.getBoundingClientRect().right) }));
                return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, top: Math.round(rect.top), nodeHeight: Math.round(rect.height), bodyPadding: body && getComputedStyle(body).paddingTop, panelMinHeight: panel && getComputedStyle(panel).minHeight, overflow };
            }, selector);
            results.push({ path, ...metric });
            await page.screenshot({ path: pathModuleSafe(width, path), fullPage: true });
        }
    }
    console.log(JSON.stringify({ evidence, results, errors: [...new Set(errors)], endpoints: [...new Set(endpoints)] }, null, 2));
    assert.equal(errors.length, 0, 'No page errors');
    for (const result of results) assert.ok(result.scrollWidth <= result.width + 1, `${result.path} overflows ${result.width}`);
    for (const result of results.filter(result => result.path.startsWith('/candidate'))) {
        assert.equal(result.bodyPadding, '0px', 'Candidate shell must not reserve space for an admin header');
        assert.equal(result.panelMinHeight, '0px', 'Candidate shell height must follow its content');
    }
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

function pathModuleSafe(width, routePath) {
    return path.join(evidence, `${width}-${routePath.replaceAll('/', '_')}.png`);
}
