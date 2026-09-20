const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../../microservices/node_modules/playwright');

const base = process.env.JOB_TEST_WEB_URL || 'http://localhost:3001';
const output = path.join(__dirname, '../../.local/job-navigation');

(async () => {
    await fs.mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
        for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
            const page = await browser.newPage({ viewport });
            const faults = [];
            page.on('pageerror', error => faults.push(error.message));
            let searches = 0;
            page.on('request', request => { if (/get-filter-post|\/api\/search\/jobs/.test(request.url())) searches++; });
            await page.goto(`${base}/job`);
            await page.locator('.job-result-link').first().waitFor();
            await page.locator('.pagination .page-link').filter({ hasText: /^3$/ }).click();
            await page.waitForFunction(() => document.querySelector('.pagination .active')?.textContent === '3');

            const returnFromDetail = async label => {
                const links = page.locator('.job-result-link');
                const target = links.nth(Math.min(2, await links.count() - 1));
                await target.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
                const before = await page.evaluate(() => ({ y: scrollY,
                    titles: [...document.querySelectorAll('.job-result-link h5')].map(node => node.textContent),
                    activePage: document.querySelector('.pagination .active')?.textContent,
                    search: document.querySelector('input[role="combobox"]').value,
                    selected: [...document.querySelectorAll('.job-category-listing input:checked')].map(node => node.value),
                }));
                await target.locator('h5').click();
                await page.locator('.jd-heading h1').waitFor();
                assert.equal(await page.evaluate(() => scrollY), 0);
                const searchCount = searches;
                await page.route('**/api/get-all-code?**', async route => {
                    await new Promise(resolve => setTimeout(resolve, 700));
                    await route.continue();
                });
                await page.evaluate(() => {
                    window.returnFrames = [];
                    const end = performance.now() + 1200;
                    const sample = () => {
                        if (document.querySelector('.job-listing-area')) returnFrames.push({ y: scrollY, rows: document.querySelectorAll('.job-result-link').length });
                        if (performance.now() < end) requestAnimationFrame(sample);
                    };
                    requestAnimationFrame(sample);
                    history.back();
                });
                await page.locator('.job-result-link').first().waitFor();
                await page.waitForFunction(() => window.returnFrames?.length > 30);
                const after = await page.evaluate(() => ({ y: scrollY,
                    titles: [...document.querySelectorAll('.job-result-link h5')].map(node => node.textContent),
                    activePage: document.querySelector('.pagination .active')?.textContent,
                    search: document.querySelector('input[role="combobox"]').value,
                    selected: [...document.querySelectorAll('.job-category-listing input:checked')].map(node => node.value),
                }));
                assert.deepEqual(after, before, `${name}/${label}: restore the complete search state`);
                assert.equal(searches, searchCount, 'Back must not refetch/clear fresh results');
                const frames = await page.evaluate(() => window.returnFrames);
                assert.ok(frames.every(frame => frame.rows === before.titles.length && Math.abs(frame.y - before.y) <= 1), 'No empty-list or displaced-scroll frame');
                await page.unrouteAll({ behavior: 'wait' });
                await page.screenshot({ path: path.join(output, `${name}-${label}.png`) });
                console.log(`PASS ${name}/${label}: ${before.titles.length} rows, page ${before.activePage}, scroll ${before.y}px, ${frames.length} stable frames`);
            };

            await returnFromDetail('page-three');
            await page.goForward();
            await page.locator('.jd-heading h1').waitFor();
            await page.goBack();
            await page.locator('.job-result-link').first().waitFor();
            assert.equal(await page.locator('.pagination .active').innerText(), '3');
            await page.locator('.job-category-listing label').filter({ hasText: /^Toàn thời gian$/ }).click();
            assert.equal(await page.getByLabel('Toàn thời gian', { exact: true }).isChecked(), true);
            await page.locator('.job-result-link').first().waitFor();
            await page.getByRole('combobox', { name: 'Tìm kiếm việc làm' }).fill('Tuyển');
            await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
            await page.locator('.job-result-link').first().waitFor();
            await returnFromDetail('filtered-search');
            assert.doesNotMatch(await page.locator('main').innerText(), /\b(?:months? ago|years? ago|days? ago|Remote)\b/);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            for (const id of [4, 6, 21, 40]) {
                await page.goto(`${base}/detail-job/${id}`);
                await page.locator('.jd-heading h1').waitFor();
                for (const heading of ['Mô tả công việc', 'Yêu cầu ứng viên', 'Quyền lợi']) {
                    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
                }
                assert.doesNotMatch(await page.locator('.jd-content').innerText(), /Supporting the Sales|Check payments|Set up internal|[\u4e00-\u9fff]/);
            }
            await page.screenshot({ path: path.join(output, `${name}-vietnamese-detail.png`), fullPage: true });
            assert.deepEqual(faults, []);
            await page.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
