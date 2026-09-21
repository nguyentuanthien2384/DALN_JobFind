// Real app regression: HTTP read fixtures keep the checks independent of live job/company data.
// No account, authentication, database records, or application source is changed by this script.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

const baseUrl = process.env.PAGINATION_TEST_URL || 'http://localhost:3001';
const artifacts = path.resolve(__dirname, '../../.local/pagination-browser-checks');
const thumbnail = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="85" height="85"><rect width="85" height="85" rx="10" fill="#e8eef7"/><text x="12" y="49" font-size="18" fill="#315077">TEST</text></svg>');
const codes = {
    JOBTYPE: [['DEV', 'Phát triển phần mềm'], ['OPS', 'Vận hành hệ thống']],
    PROVINCE: [['HN', 'Hà Nội'], ['HCM', 'Hồ Chí Minh']],
    WORKTYPE: [['WT1', 'Toàn thời gian'], ['WT2', 'Bán thời gian']],
    SALARYTYPE: [['SAL1', 'Thỏa thuận']], EXPTYPE: [['EXP1', '1 năm']], JOBLEVEL: [['LV1', 'Nhân viên']],
};
const codeRows = type => (codes[type] || []).map(([code, value]) => ({ code, value, type }));
const json = (route, data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
const paramsOf = page => new URL(page.url()).searchParams;
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
let browser;

(async () => {
    await fs.mkdir(artifacts, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1365, height: 950 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const reads = { companies: [], jobs: [] }, errors = [], gatedReads = new Map(), transitions = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() !== 'GET') return route.continue();
        if (url.pathname === '/api/get-all-code') return json(route, { errCode: 0, data: codeRows(url.searchParams.get('type')) });
        if (url.pathname === '/api/search/suggest') return json(route, { errCode: 0, data: [] });
        if (url.pathname === '/api/get-detail-post-by-id') return json(route, { errCode: 0, data: {
            id: Number(url.searchParams.get('id')), statusCode: 'PS1', timeEnd: Date.now() + 86400000,
            companyData: { id: 1, name: 'Công ty kiểm thử', thumbnail, address: 'Hà Nội' },
            postDetailData: { name: 'Pagination Job detail', descriptionHTML: '<p>Thông tin công việc kiểm thử.</p>',
                provincePostData: { value: 'Hà Nội' }, workTypePostData: { value: 'Toàn thời gian' } },
        } });
        if (url.pathname === '/api/get-related-post') return json(route, { errCode: 0, data: [] });
        const company = url.pathname === '/api/get-list-company';
        const job = ['/api/get-filter-post', '/api/search/jobs'].includes(url.pathname);
        if (!company && !job) return route.continue();
        const query = Object.fromEntries(url.searchParams), offset = Number(query.offset), limit = Number(query.limit);
        (company ? reads.companies : reads.jobs).push(query);
        const gate = gatedReads.get(`${company ? 'companies' : 'jobs'}:${offset}`);
        if (gate) { gatedReads.delete(`${company ? 'companies' : 'jobs'}:${offset}`); gate.started.resolve(); await gate.release.promise; }
        const count = (query.search || query.q) === 'overflow' ? 8 : (query.search || query.q) === 'smooth' ? 26 : 30;
        const data = Array.from({ length: Math.max(0, Math.min(limit, count - offset)) }, (_, index) => {
            const id = offset + index + 1;
            if (company) return { id, name: `Pagination Company ${id}`, thumbnail, coverimage: thumbnail, descriptionHTML: '<p>Công ty kiểm thử phân trang</p>' };
            if (url.pathname === '/api/search/jobs') return { id, name: `Pagination Job ${id}`, statusCode: 'PS1', companyName: 'Công ty kiểm thử',
                companyLogo: thumbnail, categoryJoblevelCode: 'LV1', addressCode: 'HN', salaryJobCode: 'SAL1', categoryWorktypeCode: 'WT1', timePost: Date.now() };
            return { id, timePost: Date.now(), userPostData: { userCompanyData: { name: 'Công ty kiểm thử', thumbnail } },
                postDetailData: { name: `Pagination Job ${id}`, jobLevelPostData: { value: 'Nhân viên' }, provincePostData: { value: 'Hà Nội' },
                    salaryTypePostData: { value: 'Thỏa thuận' }, workTypePostData: { value: 'Toàn thời gian' } } };
        });
        return json(route, { errCode: 0, data, count });
    });
    const activePage = expected => expect(page.locator('.pagination .active')).toHaveText(String(expected));
    const companyAt = async (pageNumber, firstRow) => {
        await expect(page.locator('.company-name').filter({ hasText: new RegExp(`^Pagination Company ${firstRow}$`) })).toBeVisible();
        await activePage(pageNumber);
    };
    const jobAt = async (pageNumber, firstRow) => {
        await expect(page.getByRole('heading', { name: `Pagination Job ${firstRow}`, exact: true })).toBeVisible();
        await activePage(pageNumber);
    };
    const clickPage = number => page.locator('.pagination').getByLabel(`Page ${number}`, { exact: true }).click();
    const last = list => list.at(-1);
    const settleFrames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = () => page.evaluate(() => ({
        scrollY, pagerTop: document.querySelector('.pagination')?.getBoundingClientRect().top ?? null,
        height: document.documentElement.scrollHeight,
    }));
    const waitForGate = async gate => {
        let timeout;
        try { await Promise.race([gate.started.promise, new Promise((_, reject) => {
            timeout = setTimeout(() => reject(Error('Page request did not start')), 10000);
        })]); } finally { clearTimeout(timeout); }
    };
    const smoothPage = async (kind, number, firstRow) => {
        // Start with the pager visible near the bottom; a browser auto-scroll from locator.click must not mask a jump.
        await page.evaluate(() => {
            const top = document.querySelector('.pagination').getBoundingClientRect().top + scrollY;
            window.scrollTo({ top: top - innerHeight * 0.7, behavior: 'instant' });
        });
        await settleFrames();
        const before = await geometry();
        const previousNames = await page.locator(kind === 'jobs' ? '.job-result-link h5' : '.company-name').allTextContents();
        assert.ok(before.scrollY > 100, `${kind} must be scrolled before measuring`);
        const gate = { started: deferred(), release: deferred() };
        gatedReads.set(`${kind}:${(number - 1) * (kind === 'jobs' ? 5 : 6)}`, gate);
        await page.evaluate(() => {
            window.__paginationFrames = [];
            const sample = () => {
                if (!window.__paginationFrames) return;
                window.__paginationFrames.push({ scrollY, pagerTop: document.querySelector('.pagination')?.getBoundingClientRect().top ?? null });
                requestAnimationFrame(sample);
            };
            sample();
        });
        let pending, pendingNames;
        try {
            await clickPage(number);
            await waitForGate(gate);
            await settleFrames();
            pending = await geometry();
            pendingNames = await page.locator(kind === 'jobs' ? '.job-result-link h5' : '.company-name').allTextContents();
        } finally { gate.release.resolve(); }
        await (kind === 'jobs' ? jobAt : companyAt)(number, firstRow);
        await settleFrames();
        const after = await geometry();
        const frames = await page.evaluate(() => { const result = window.__paginationFrames; window.__paginationFrames = null; return result; });
        const result = { kind, number, viewport: page.viewportSize(), before, pending, after,
            rowsRemainVisible: previousNames.length > 0 && JSON.stringify(previousNames) === JSON.stringify(pendingNames),
            missingPagerFrames: frames.filter(frame => frame.pagerTop === null).length,
            maxScrollDelta: Math.max(...frames.map(frame => Math.abs(frame.scrollY - before.scrollY))),
            maxPagerDelta: Math.max(...frames.filter(frame => frame.pagerTop !== null).map(frame => Math.abs(frame.pagerTop - before.pagerTop))),
        };
        transitions.push(result);
        console.log(`Pagination transition: ${JSON.stringify(result)}`);
    };

    await page.goto(`${baseUrl}/company?search=Sao+Viet&source=keep`, { waitUntil: 'domcontentloaded' });
    await companyAt(1, 1);
    await clickPage(3); await companyAt(3, 13);
    assert.equal(last(reads.companies).offset, '12');
    assert.equal(last(reads.companies).search, 'Sao Viet');
    assert.equal(paramsOf(page).get('source'), 'keep');
    reads.companies.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' }); await companyAt(3, 13);
    assert.ok(reads.companies.length > 0 && reads.companies.every(query => query.offset === '12' && query.search === 'Sao Viet'));
    await expect(page.getByPlaceholder('Nhập tên công ty')).toHaveValue('Sao Viet');
    await clickPage(4); await companyAt(4, 19);
    await page.goBack(); await companyAt(3, 13);
    await page.goForward(); await companyAt(4, 19);
    await page.getByPlaceholder('Nhập tên công ty').fill('New company');
    await page.getByPlaceholder('Nhập tên công ty').press('Enter'); await companyAt(1, 1);
    assert.equal(last(reads.companies).offset, '0'); assert.equal(last(reads.companies).search, 'New company');
    await page.goBack(); await companyAt(4, 19);
    await expect(page.getByPlaceholder('Nhập tên công ty')).toHaveValue('Sao Viet');
    reads.companies.length = 0;
    await page.goto(`${baseUrl}/company?page=50&search=overflow`); await companyAt(2, 7);
    assert.equal(reads.companies[0].offset, '294'); assert.equal(last(reads.companies).offset, '6');
    assert.equal(paramsOf(page).get('page'), '2'); assert.equal(paramsOf(page).get('search'), 'overflow');
    await page.screenshot({ path: path.join(artifacts, 'companies.png'), fullPage: true, animations: 'disabled' });

    const jobQuery = new URLSearchParams({ page: '3', search: 'React', categoryJobCode: 'DEV', addressCode: 'HN',
        categoryWorktypeCode: JSON.stringify(['WT1']), salaryJobCode: JSON.stringify(['SAL1']), source: 'keep' });
    await page.goto(`${baseUrl}/job?${jobQuery}`, { waitUntil: 'domcontentloaded' }); await jobAt(3, 11);
    assert.equal(last(reads.jobs).offset, '10');
    await expect(page.getByLabel('Lĩnh vực', { exact: true })).toHaveValue('DEV');
    await expect(page.getByLabel('Địa điểm', { exact: true })).toHaveValue('HN');
    await expect(page.locator('input[type=checkbox][value=WT1]')).toBeChecked();
    await clickPage(4); await jobAt(4, 16);
    reads.jobs.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' }); await jobAt(4, 16);
    assert.ok(reads.jobs.length > 0 && reads.jobs.every(query => query.offset === '15'));
    assert.equal(last(reads.jobs).search || last(reads.jobs).q, 'React');
    assert.equal(last(reads.jobs).categoryJobCode, 'DEV');
    assert.equal(last(reads.jobs).categoryWorktypeCode, 'WT1');
    await expect(page.getByRole('combobox', { name: 'Tìm kiếm việc làm' })).toHaveValue('React');
    await expect(page.locator('input[type=checkbox][value=WT1]')).toBeChecked();
    await clickPage(5); await jobAt(5, 21);
    await page.goBack(); await jobAt(4, 16);
    await page.goForward(); await jobAt(5, 21);
    await page.getByRole('combobox', { name: 'Tìm kiếm việc làm' }).fill('Vue');
    await page.getByRole('combobox', { name: 'Tìm kiếm việc làm' }).press('Enter'); await jobAt(1, 1);
    assert.equal(last(reads.jobs).offset, '0'); assert.equal(last(reads.jobs).search || last(reads.jobs).q, 'Vue');
    await page.goBack(); await jobAt(5, 21);
    await expect(page.getByRole('combobox', { name: 'Tìm kiếm việc làm' })).toHaveValue('React');
    await page.getByLabel('Lĩnh vực', { exact: true }).selectOption('OPS'); await jobAt(1, 1);
    assert.equal(last(reads.jobs).offset, '0'); assert.equal(last(reads.jobs).categoryJobCode, 'OPS');
    assert.equal(paramsOf(page).get('source'), 'keep');
    await page.goBack(); await jobAt(5, 21);
    await expect(page.getByLabel('Lĩnh vực', { exact: true })).toHaveValue('DEV');
    reads.jobs.length = 0;
    await page.goto(`${baseUrl}/job?page=50&search=overflow&categoryJobCode=DEV`); await jobAt(2, 6);
    assert.equal(reads.jobs[0].offset, '245'); assert.equal(last(reads.jobs).offset, '5');
    assert.equal(paramsOf(page).get('page'), '2'); assert.equal(paramsOf(page).get('categoryJobCode'), 'DEV');
    await page.screenshot({ path: path.join(artifacts, 'jobs.png'), fullPage: true, animations: 'disabled' });

    await page.goto(`${baseUrl}/company?search=smooth`); await companyAt(1, 1);
    await smoothPage('companies', 2, 7);
    await smoothPage('companies', 5, 25); // A shorter final page must not pull the footer/pager up.
    await page.goto(`${baseUrl}/job?search=smooth`); await jobAt(1, 1);
    await smoothPage('jobs', 2, 6);
    await smoothPage('jobs', 6, 26);
    await page.screenshot({ path: path.join(artifacts, 'job-smooth-last-page.png'), fullPage: true, animations: 'disabled' });

    // The smooth in-place update must preserve the existing detail -> Back restoration contract.
    await page.locator('.job-result-link').last().scrollIntoViewIfNeeded(); await settleFrames();
    const listPosition = await page.evaluate(() => scrollY), listReads = reads.jobs.length;
    await page.locator('.job-result-link').last().click();
    await expect(page.getByRole('heading', { name: 'Pagination Job detail', exact: true })).toBeVisible();
    await page.goBack(); await jobAt(6, 26); await settleFrames();
    const restoredPosition = await page.evaluate(() => scrollY);
    assert.ok(Math.abs(restoredPosition - listPosition) <= 2, `Detail Back scroll: ${listPosition} -> ${restoredPosition}`);
    assert.equal(reads.jobs.length, listReads, 'Fresh cached results must restore without another list request');

    if (process.env.PAGINATION_RECORD_BASELINE !== '1') {
        await page.goto(`${baseUrl}/job?search=race`); await jobAt(1, 1);
        const second = { started: deferred(), release: deferred() }, third = { started: deferred(), release: deferred() };
        gatedReads.set('jobs:5', second); gatedReads.set('jobs:10', third);
        try {
            await clickPage(2); await waitForGate(second);
            await clickPage(3); await waitForGate(third);
            third.release.resolve(); await jobAt(3, 11);
            const staleResponse = page.waitForResponse(response => {
                const url = new URL(response.url());
                return ['/api/get-filter-post', '/api/search/jobs'].includes(url.pathname) && url.searchParams.get('offset') === '5';
            });
            second.release.resolve(); await staleResponse; await settleFrames();
            await jobAt(3, 11);
            assert.equal(paramsOf(page).get('page'), '3');
            await expect(page.locator('.stable-list')).toHaveAttribute('aria-busy', 'false');
        } finally { second.release.resolve(); third.release.resolve(); }
        const revisit = { started: deferred(), release: deferred() };
        gatedReads.set('jobs:5', revisit);
        try {
            await page.goBack(); await waitForGate(revisit);
            await expect(page.locator('.stable-list')).toHaveAttribute('aria-busy', 'true');
        } finally { revisit.release.resolve(); }
        await jobAt(2, 6);
        await expect(page.locator('.stable-list')).toHaveAttribute('aria-busy', 'false');
        await page.goBack(); await jobAt(1, 1);
        await page.goForward(); await jobAt(2, 6);

        await page.setViewportSize({ width: 390, height: 844 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`${baseUrl}/company?search=smooth`); await companyAt(1, 1);
        await smoothPage('companies', 2, 7); await smoothPage('companies', 5, 25);
        await page.goto(`${baseUrl}/job?search=smooth`); await jobAt(1, 1);
        await smoothPage('jobs', 2, 6); await smoothPage('jobs', 6, 26);
        await expect(page.locator('.stable-list__content')).toHaveCSS('transition-duration', '0s');
        await page.screenshot({ path: path.join(artifacts, 'job-smooth-mobile.png'), fullPage: true, animations: 'disabled' });
    }
    await fs.writeFile(path.join(artifacts, 'transitions.json'), JSON.stringify(transitions, null, 2));
    if (process.env.PAGINATION_RECORD_BASELINE !== '1') for (const transition of transitions) {
        assert.ok(transition.rowsRemainVisible, `${transition.kind}: current rows disappear during loading`);
        assert.equal(transition.missingPagerFrames, 0, `${transition.kind}: pager disappeared`);
        assert.ok(transition.maxScrollDelta <= 2, `${transition.kind}: scroll moved ${transition.maxScrollDelta}px`);
        assert.ok(transition.maxPagerDelta <= 2, `${transition.kind}: pager moved ${transition.maxPagerDelta}px`);
    }
    assert.deepEqual(errors, []);
    console.log(process.env.PAGINATION_RECORD_BASELINE === '1'
        ? 'BASELINE RECORDED: pagination functionality passed; transition measurements captured without smoothness assertions.'
        : 'PASS: pagination persistence, Back/Forward, filters, overflow clamp, desktop/mobile delayed transitions without scroll/layout jumps, shorter last pages, detail Back restoration, rapid navigation with late responses, reduced motion, and no JavaScript errors.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
