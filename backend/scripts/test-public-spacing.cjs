// Real frontend and theme; intercept API reads with deterministic fixture data.
// Run against a running frontend: node backend/scripts/test-public-spacing.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const base = process.env.JOB_TEST_WEB_URL || 'http://localhost:3001';
const output = path.resolve(__dirname, '../../.local/public-spacing');
const logo = `${base}/assetsAdmin/images/logo-mini.svg`;
const jobs = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1, name: `Chuyên viên phát triển phần mềm và hỗ trợ khách hàng ${index + 1}`,
    statusCode: 'PS1', timePost: Date.now(), companyName: 'Công ty thử nghiệm', companyLogo: logo,
    categoryJoblevelCode: 'LEVEL1', addressCode: 'CITY1', salaryJobCode: 'SALARY1', categoryWorktypeCode: 'WORK1',
    userPostData: { userCompanyData: { thumbnail: logo } },
    postDetailData: {
        name: `Chuyên viên phát triển phần mềm và hỗ trợ khách hàng ${index + 1}`,
        jobLevelPostData: { value: 'Nhân viên' }, provincePostData: { value: 'Hà Nội' },
        salaryTypePostData: { value: 'Thỏa thuận' }, workTypePostData: { value: 'Toàn thời gian' },
    },
}));

(async () => {
    await fs.mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const measurements = [];
    try {
        for (const viewport of [{ width: 1366, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
            const page = await browser.newPage({ viewport });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            let releasePage;
            let pageRequested;
            const nextPageRequested = new Promise(resolve => { pageRequested = resolve; });
            await page.route('**/api/**', async route => {
                const request = route.request();
                const url = new URL(request.url());
                assert.ok(['GET', 'OPTIONS'].includes(request.method()), 'Layout checks must not mutate application data');
                let result = { errCode: 0, data: [], count: 0 };
                if (/get-filter-post|\/search\/jobs$/.test(url.pathname)) {
                    const offset = Number(url.searchParams.get('offset') || 0);
                    if (offset > 0) await new Promise(resolve => { releasePage = resolve; pageRequested(); });
                    result = { errCode: 0, data: jobs.slice(offset, offset + 5), count: jobs.length };
                } else if (url.pathname.endsWith('/get-list-job-count-post')) {
                    result.data = Array.from({ length: 4 }, (_, index) => ({ amount: index + 1,
                        postDetailData: { jobTypePostData: { code: `JOB${index}`, value: `Công nghệ thông tin ${index + 1}`, image: logo } },
                    }));
                } else if (url.pathname.endsWith('/get-all-code')) {
                    result.data = [{ code: 'VALUE1', value: 'Lựa chọn thứ nhất' }, { code: 'VALUE2', value: 'Lựa chọn thứ hai' }];
                }
                await route.fulfill({ json: result });
            });
            for (const route of ['/', '/job', '/about', '/contact', '/layout-regression-missing']) {
                await page.goto(`${base}${route}`);
                await page.locator('main').waitFor();
                if (route === '/') await page.locator('.single-job-items').first().waitFor();
                if (route === '/job') await page.locator('.stable-list[aria-busy="false"] .job-result-link').first().waitFor();
                await page.evaluate(() => document.fonts.ready);
                const geometry = await page.evaluate(() => {
                    const boxes = selector => [...document.querySelectorAll(selector)].map(node => {
                        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
                        return { top: rect.top, left: rect.left, right: rect.right, height: rect.height,
                            paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom) };
                    });
                    return { scrollHeight: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth,
                        hero: boxes('.slider-height2'), sections: boxes('.section-pad-t30,.feature-padding,.section-padding2,.apply-process-area,.online-cv'),
                        content: boxes('.job-listing-area,.contact-section'), cards: boxes('.single-job-items'), categories: boxes('.single-services') };
                });
                assert.ok(geometry.scrollWidth <= viewport.width, `${route}: horizontal overflow`);
                for (const hero of geometry.hero) assert.ok(hero.height <= (viewport.width < 768 ? 128 : 180) + 1, `${route}: oversized title banner`);
                for (const section of geometry.sections) assert.ok(section.paddingTop <= 56 && section.paddingBottom <= 56, `${route}: excessive section padding`);
                for (const content of geometry.content) assert.ok(content.paddingTop <= 32 && content.paddingBottom <= 40, `${route}: duplicate page offsets`);
                for (const card of geometry.cards) assert.ok(card.left >= -1 && card.right <= viewport.width + 1, `${route}: card overflows viewport`);
                if (viewport.width < 768) {
                    for (const card of geometry.cards) assert.ok(card.height < 260, `${route}: mobile job card has unnecessary stacked whitespace`);
                    if (geometry.categories.length > 1) assert.equal(geometry.categories[0].top, geometry.categories[1].top, 'Mobile categories should share a row');
                }
                measurements.push({ route, viewport, ...geometry });
                await page.screenshot({ path: path.join(output, `${viewport.width}-${route === '/' ? 'home' : route.slice(1)}.png`), fullPage: true });
                if (route === '/job') {
                    const list = page.locator('.stable-list');
                    const before = (await list.boundingBox()).height;
                    await page.locator('.pagination .page-link').filter({ hasText: /^2$/ }).click();
                    await page.waitForFunction(() => document.querySelector('.stable-list')?.getAttribute('aria-busy') === 'true');
                    assert.ok((await list.boundingBox()).height >= before - 1, 'Pending pagination must keep the current space');
                    await nextPageRequested;
                    releasePage();
                    await page.waitForFunction(() => document.querySelector('.stable-list')?.getAttribute('aria-busy') === 'false');
                    assert.equal(await list.locator('.job-result-link').count(), 2);
                    assert.ok((await list.boundingBox()).height < before - 100, 'Settled short page must release old rows\' empty space');
                    assert.equal(await list.evaluate(node => node.style.minHeight), '', 'Settled lists must not keep a stale minimum height');
                }
            }
            assert.deepEqual(errors, []);
            await page.close();
        }
        await fs.writeFile(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2));
        console.log(`PASS ${measurements.length} public page/viewport checks; screenshots: ${output}`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
