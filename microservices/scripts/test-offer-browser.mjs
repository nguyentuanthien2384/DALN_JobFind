// Isolated browser acceptance: all APIs are mocked; no email or production data writes.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { offerFixture } from '../tests/offerFixture.js';
import { applicationDecisionTemplate } from '../notification-service/src/templates.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const build = path.resolve(root, process.env.OFFER_PREVIEW_BUILD || '.local/offer-preview-build');
const output = path.join(root, '.local/offer-browser');
await mkdir(output, { recursive: true });
await readFile(path.join(build, 'index.html'));
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const file = path.resolve(build, `.${pathname}`);
        if (!file.startsWith(build + path.sep) && file !== build) { res.writeHead(403).end(); return; }
        const target = path.extname(file) ? file : path.join(build, 'index.html');
        const data = await readFile(target);
        res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' });
        res.end(data);
    } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser = await chromium.launch({ headless: true, ...(process.env.JOBFIND_TEST_BROWSER_CHANNEL ? { channel: process.env.JOBFIND_TEST_BROWSER_CHANNEL } : {}) });
    for (const width of [1440, 375]) {
        const context = await browser.newContext({ viewport: { width, height: 980 }, serviceWorkers: 'block' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const user = { id: 5, userId: 5, roleCode: 'COMPANY', companyId: 9, companyStatusCode: 'S1', companyCensorCode: 'CS1',
            firstName: 'Hà', lastName: 'Nguyễn', email: 'hr@example.com', companyName: offerFixture.companyName };
        await page.addInitScript((value) => {
            localStorage.setItem('userData', JSON.stringify(value));
            localStorage.setItem('token_user', 'synthetic-offer-browser-test');
        }, user);
        const application = { id: 1, candidate_id: 2, candidate_name: 'Lan Nguyễn', candidate_email: 'lan@example.com',
            company_id: 9, job_id: 7, job_title: 'Frontend Developer', stage: 'phong_van', applied_at: '2026-09-10T00:00:00Z', notes: [], timeline: [], is_read: true };
        const stages = ['moi_ung_tuyen', 'dang_xem_xet', 'phong_van', 'de_nghi', 'nhan_viec', 'tu_choi'];
        let captured;
        await page.route('**/*', async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith('/api/')) {
                let data = { errCode: 0, data: [], count: 0 };
                if (url.pathname === '/api/auth/me') data.data = user;
                if (url.pathname.includes('get-all-post')) data.data = [{ id: 7, postDetailData: { name: application.job_title } }];
                if (url.pathname === '/api/applications/board') data.data = { total: 1, columns: stages.map((stage) => ({ stage, label: stage, items: stage === application.stage ? [application] : [], count: stage === application.stage ? 1 : 0 })) };
                if (url.pathname === '/api/applications/funnel') data.data = { funnel: stages.map((stage) => ({ stage, label: stage, count: stage === application.stage ? 1 : 0 })), conversionRate: 0 };
                if (url.pathname === '/api/applications/1') data.data = application;
                if (url.pathname.endsWith('/decision-notification')) {
                    assert.equal(route.request().method(), 'POST');
                    captured = route.request().postDataJSON();
                    application.stage = 'de_nghi';
                    application.timeline = [{ id: 1, to_stage: 'de_nghi', created_at: new Date().toISOString(), decision_snapshot: captured }];
                    data = { errCode: 0, emailQueued: true, data: application };
                }
                return route.fulfill({ json: data });
            }
            if (url.origin === base && !url.pathname.startsWith('/socket.io')) return route.continue();
            return route.abort();
        });
        page.on('dialog', (dialog) => dialog.accept());
        await page.goto(`${base}/admin/pipeline`);
        await page.getByText('Lan Nguyễn', { exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Chi tiết hồ sơ Lan Nguyễn' });
        await dialog.getByRole('button', { name: 'Gửi trúng tuyển', exact: true }).click();
        await dialog.getByRole('button', { name: 'Xem trước thư mời' }).click();
        await dialog.getByRole('alert').waitFor();
        assert.equal(captured, undefined);
        const fill = async (label, value) => dialog.getByLabel(label, { exact: true }).fill(value);
        await fill('Ngày nhận việc *', offerFixture.startDate);
        await fill('Giờ nhận việc *', offerFixture.startTime);
        await fill('Địa điểm nhận việc cụ thể *', offerFixture.location);
        await fill('Hạn phản hồi *', offerFixture.responseDeadline);
        await fill('Số điện thoại HR', offerFixture.contactPhone);
        await fill('Lương / thu nhập (ghi rõ gross hoặc net)', offerFixture.salary);
        await fill('Giấy tờ cần chuẩn bị', offerFixture.requiredDocuments);
        await fill('Hướng dẫn ngày đầu nhận việc', offerFixture.onboardingInstructions);
        const overflow = await dialog.locator('.kb-offer').evaluate((element) => element.scrollWidth > element.clientWidth + 1);
        assert.equal(overflow, false, `Composer overflow at ${width}px`);
        await dialog.locator('.kb-offer h5').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `composer-${width}.png`) });
        await dialog.getByRole('button', { name: 'Xem trước thư mời' }).click();
        await dialog.getByText('20/10/2099', { exact: true }).waitFor();
        assert.equal(captured, undefined);
        await dialog.locator('.kb-offer h5').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `preview-${width}.png`) });
        await dialog.getByRole('button', { name: 'Xác nhận gửi thư mời' }).click();
        await page.getByText('Đã xếp hàng gửi email thông báo trúng tuyển', { exact: true }).waitFor();
        assert.equal(captured.decision, 'accepted');
        assert.equal(captured.offer.startTime, '08:30');
        assert.equal(captured.offer.location, offerFixture.location);
        assert.equal(captured.offer.timeZone, 'Asia/Ho_Chi_Minh');
        await dialog.getByText('Xem nội dung đã yêu cầu gửi').waitFor();
        assert.deepEqual(errors, [], `Browser errors at ${width}px`);
        await context.close();
    }
    const email = applicationDecisionTemplate({ decision: 'accepted', candidateName: 'Lan Nguyễn', jobTitle: 'Frontend Developer', offer: offerFixture }).email;
    await writeFile(path.join(output, 'offer-email.html'), email.html);
    for (const width of [800, 375]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        await page.setContent(email.html);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(output, `email-${width}.png`), fullPage: true });
        await page.close();
    }
    console.log('Offer browser checks passed: desktop + mobile, required fields, preview, synthetic send, history, email layout. No live API/email calls.');
} finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
}
