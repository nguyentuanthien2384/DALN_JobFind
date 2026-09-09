import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { chromium, expect } from 'playwright/test';

// Invoked only by the owning Compose runner. All /api requests are proxied to
// its actual loopback Gateway. No route.fulfill, seeded JWT or browser storage.
export async function runComposeBrowser({ gateway, password, build, compose }) {
    assert.match(gateway, /^http:\/\/127\.0\.0\.1:\d+$/);
    const artifacts = await mkdtemp(path.join(tmpdir(), 'jobfind-compose-ui-'));
    const app = express();
    app.use('/api', createProxyMiddleware({ target: gateway, changeOrigin: true,
        pathRewrite: value => '/api' + value }));
    app.use('/socket.io', createProxyMiddleware({ target: gateway, changeOrigin: true,
        pathRewrite: value => '/socket.io' + value }));
    app.use(express.static(build)); app.get('*', (_req, res) => res.sendFile(path.join(build, 'index.html')));
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser; const errors = [], calls = [], failures = [], checkpoints = []; let current;
    const screenshot = (page, name) => page.screenshot({ path: path.join(artifacts, name + '.png'), fullPage: true });
    const pass = message => { checkpoints.push(message); console.log('PASS browser: ' + message); };
    try {
        browser = await chromium.launch({ headless: true,
            ...(process.env.JOBFIND_TEST_BROWSER_CHANNEL && { channel: process.env.JOBFIND_TEST_BROWSER_CHANNEL }) });
        const session = async (user, destination) => {
            const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
            // Deny only outside origins. API bytes and status are never replaced.
            await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
            const page = await context.newPage(); current = page;
            page.on('pageerror', error => errors.push(error.message));
            page.on('response', async response => {
                const url = new URL(response.url()); if (!url.pathname.startsWith('/api/')) return;
                const request = response.request(); calls.push({ path: url.pathname, method: request.method(), status: response.status() });
                if (response.status() >= 500) failures.push(`${response.status()} ${url.pathname}`);
            });
            await page.goto(origin + '/login');
            await page.getByPlaceholder('Số điện thoại', { exact: true }).fill(String(user).padStart(4, '0'));
            await page.getByPlaceholder('Mật khẩu', { exact: true }).fill(password);
            const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/login' && response.request().method() === 'POST');
            const navigation = page.waitForNavigation({ waitUntil: 'load' });
            await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
            assert.equal((await loginResponse).status(), 200);
            await navigation;
            // Login deliberately performs a full navigation; Chromium may release
            // the response body. Check the session the real login UI persisted.
            await expect.poll(async () => {
                try { return await page.evaluate(() => JSON.parse(localStorage.getItem('userData'))?.id); }
                catch { return null; }
            }, { timeout: 10000 }).toBe(user);
            await page.goto(origin + destination);
            return page;
        };
        const candidate = await session(18, '/candidate/ai-cv');
        await expect(candidate.getByRole('heading', { name: 'CV và trợ lý AI' })).toBeVisible();
        await candidate.getByLabel('Tệp CV PDF (tối đa 5 MiB)').setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nSynthetic') });
        await candidate.getByRole('button', { name: 'Gửi yêu cầu AI', exact: true }).click();
        await expect(candidate.getByRole('button', { name: 'Xem và chỉnh sửa toàn bộ CV' })).toBeVisible({ timeout: 90000 });
        await candidate.getByRole('button', { name: 'Xem và chỉnh sửa toàn bộ CV' }).click();
        await expect(candidate.getByLabel('Họ và tên', { exact: true })).toHaveValue('Synthetic Candidate');
        await candidate.getByRole('button', { name: 'Tải danh sách CV', exact: true }).click();
        await candidate.getByLabel('Họ và tên', { exact: true }).fill('Nguyễn Thị Ánh');
        await candidate.getByRole('textbox', { name: /^Giới thiệu/ }).fill(('Tôi xây dựng dịch vụ xử lý hồ sơ, kiểm tra quyền truy cập và bảo vệ dữ liệu ứng viên.\n').repeat(28));
        const createdResponse = candidate.waitForResponse(response => new URL(response.url()).pathname === '/api/profile/cvs' && response.request().method() === 'POST');
        await candidate.getByRole('button', { name: 'Lưu CV', exact: true }).click();
        const cv = (await (await createdResponse).json()).data; assert.match(cv._id, /^[a-f0-9]{24}$/);
        await expect(candidate.getByRole('button', { name: 'Xóa CV', exact: true })).toBeEnabled();
        await screenshot(candidate, '01-prepared-cv');
        pass('real login -> asynchronous AI worker result -> edited CV persisted by Identity');

        await candidate.goto(origin + '/job');
        await expect(candidate.getByText('Compose accepted', { exact: true }).first()).toBeVisible({ timeout: 20000 });
        const search = candidate.getByRole('combobox', { name: 'Tìm kiếm việc làm', exact: true });
        await search.fill('zzzxqnotfoundvv');
        const noResults = candidate.waitForResponse(response => new URL(response.url()).pathname === '/api/search/jobs' && new URL(response.url()).searchParams.get('q') === 'zzzxqnotfoundvv');
        await candidate.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
        assert.equal((await (await noResults).json()).count, 0);
        await expect(candidate.getByText('Không tìm thấy công việc phù hợp. Hãy thử đổi từ khóa hoặc bộ lọc.')).toBeVisible();
        await candidate.getByRole('button', { name: 'Xóa từ khóa', exact: true }).click();
        await expect(candidate.getByText('Compose accepted', { exact: true }).first()).toBeVisible();
        const filtered = candidate.waitForResponse(response => new URL(response.url()).pathname === '/api/search/jobs' && new URL(response.url()).searchParams.get('categoryWorktypeCode') === 'WT1');
        await candidate.locator('label').filter({ has: candidate.locator('input[value="WT1"]') }).click();
        assert.equal((await (await filtered).json()).errCode, 0);
        await expect(candidate.getByText('Compose accepted', { exact: true }).first()).toBeVisible();
        const jobLink = candidate.getByRole('link').filter({ has: candidate.getByText('Compose accepted', { exact: true }) }).first();
        const href = await jobLink.getAttribute('href'); assert.match(href, /detail-job\/\d+/);
        await jobLink.click();
        await expect(candidate.getByRole('heading', { name: 'Compose accepted', exact: true })).toBeVisible();
        const jobId = Number(new URL(candidate.url()).pathname.match(/detail-job\/(\d+)/)[1]);
        await candidate.goto(origin + '/candidate/ai-cv');
        await candidate.getByRole('button', { name: 'Xem / tiếp tục chờ kết quả' }).click();
        await expect(candidate.getByRole('button', { name: 'Xem và chỉnh sửa toàn bộ CV' })).toBeVisible({ timeout: 30000 });
        assert.equal(calls.filter(row => row.path === '/api/ai/parse-resume' && row.method === 'POST').length, 1);
        await candidate.getByRole('button', { name: 'Tác vụ mới', exact: true }).click();
        await candidate.getByRole('button', { name: 'Tải danh sách CV', exact: true }).click();
        await candidate.getByRole('button', { name: 'Dùng để đánh giá', exact: true }).click();
        await expect(candidate.getByRole('combobox', { name: /^Chức năng/ })).toHaveValue('match_cv');
        await expect(candidate.getByRole('textbox', { name: 'Nội dung CV', exact: true })).toHaveValue(/Nguyễn Thị Ánh/);
        await candidate.getByLabel('Mã công việc', { exact: true }).fill(String(jobId));
        await candidate.getByRole('button', { name: 'Gửi yêu cầu AI', exact: true }).click();
        await expect(candidate.locator('.candidate-ai-score')).toHaveText('80/100', { timeout: 90000 });
        await candidate.getByRole('button', { name: 'Tác vụ mới', exact: true }).click();
        await candidate.getByRole('combobox', { name: /^Chức năng/ }).selectOption('cover_letter');
        await candidate.getByRole('combobox', { name: /^Ngôn ngữ/ }).selectOption('vi');
        await candidate.getByRole('button', { name: 'Gửi yêu cầu AI', exact: true }).click();
        const letter = candidate.getByRole('textbox', { name: 'Thư ứng tuyển (có thể chỉnh sửa)', exact: true });
        await expect(letter).toHaveValue('Synthetic application letter.', { timeout: 90000 });
        await letter.fill('Thư ứng tuyển đã được ứng viên kiểm tra và chỉnh sửa.');
        await expect(letter).toHaveValue('Thư ứng tuyển đã được ứng viên kiểm tra và chỉnh sửa.');
        await screenshot(candidate, '08-ai-letter');
        pass('AI task resumes without resubmission; saved CV matching and editable cover letter use actual worker results');
        await candidate.getByRole('link', { name: `Trở lại công việc #${jobId} để ứng tuyển`, exact: true }).click();
        await candidate.getByRole('button', { name: /Ứng tuyển ngay/ }).first().click();
        const modal = candidate.getByRole('dialog'); await expect(modal).toBeVisible();
        await modal.getByLabel('CV đã chuẩn bị', { exact: true }).check();
        await modal.getByLabel('CV đã lưu', { exact: true }).selectOption(cv._id);
        await modal.getByLabel('Lời giới thiệu', { exact: true }).fill('Tôi muốn ứng tuyển bằng bản CV đã xem.');
        await expect(modal.getByRole('button', { name: 'Gửi hồ sơ', exact: true })).toBeDisabled();
        await modal.getByRole('button', { name: 'Tạo bản PDF để xem lại' }).click();
        const pdfLink = modal.getByRole('link', { name: 'Mở bản PDF sẽ gửi' });
        await expect(pdfLink).toBeVisible({ timeout: 20000 });
        const pdfBytes = Buffer.from(await candidate.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), await pdfLink.getAttribute('href')));
        assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
        await writeFile(path.join(artifacts, 'reviewed-cv.pdf'), pdfBytes);
        await screenshot(candidate, '02-review-desktop');
        await candidate.setViewportSize({ width: 390, height: 844 });
        assert.ok(await modal.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
        await pdfLink.scrollIntoViewIfNeeded();
        await expect(modal.getByRole('button', { name: 'Gửi hồ sơ', exact: true })).toBeInViewport({ ratio: 1 });
        await screenshot(candidate, '03-review-mobile');
        assert.equal(calls.filter(row => row.path === '/api/create-new-cv').length, 0);
        await modal.getByLabel('Tôi đã xem và chọn bản PDF này để ứng tuyển').check();
        const submitted = candidate.waitForResponse(response => new URL(response.url()).pathname === '/api/create-new-cv' && response.request().method() === 'POST');
        await modal.getByRole('button', { name: 'Gửi hồ sơ', exact: true }).click();
        const submission = await submitted, receipt = await submission.json();
        assert.equal(receipt.errCode, 0); assert.ok(receipt.cvId);
        assert.equal(submission.request().postDataJSON().file, 'data:application/pdf;base64,' + pdfBytes.toString('base64'));
        assert.equal(Number(submission.request().postDataJSON().postId), jobId);
        await expect(modal).not.toBeVisible();
        pass('Core search -> legacy job detail -> reviewed Vietnamese PDF -> explicit mobile submission of exact bytes');

        await candidate.goto(origin + '/candidate/cv-post');
        const historyRow = candidate.getByRole('row').filter({ hasText: 'Compose accepted' });
        await expect(historyRow).toBeVisible();
        await expect.poll(async () => {
            await candidate.getByRole('button', { name: 'Tải lại hồ sơ' }).click();
            await expect(candidate.getByRole('button', { name: 'Tải lại hồ sơ' })).toBeEnabled();
            return historyRow.innerText();
        }, { timeout: 30000 }).toContain('Mới ứng tuyển');
        await expect(historyRow.getByRole('link', { name: 'Xem CV đã nộp' })).toHaveAttribute('href', `/candidate/cv-detail/${receipt.cvId}`);
        assert.ok(await candidate.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        await screenshot(candidate, '04-history-mobile');

        const recruiter = await session(10, '/admin/pipeline');
        await expect(recruiter.getByRole('heading', { name: 'Quản lý hồ sơ ứng tuyển' })).toBeVisible();
        await recruiter.locator('.kb-filter').selectOption(String(jobId));
        const card = recruiter.getByRole('button', { name: 'Hồ sơ Browser Candidate', exact: true });
        await expect(card).toBeVisible();
        await card.dragTo(recruiter.getByRole('region', { name: 'Phỏng vấn', exact: true }));
        await expect(recruiter.getByRole('region', { name: 'Phỏng vấn', exact: true }).getByRole('button', { name: 'Hồ sơ Browser Candidate', exact: true })).toBeVisible();
        await recruiter.reload();
        await expect(recruiter.getByRole('region', { name: 'Phỏng vấn', exact: true }).getByRole('button', { name: 'Hồ sơ Browser Candidate', exact: true })).toBeVisible();
        await card.click();
        const detail = recruiter.getByRole('dialog');
        await expect(detail).toContainText('browser@example.invalid');
        await detail.getByPlaceholder('Nhận xét về ứng viên…').fill('Ghi chú riêng từ bài nghiệm thu trình duyệt');
        const noteResponse = recruiter.waitForResponse(response => /\/api\/applications\/\d+\/notes$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
        await detail.getByRole('button', { name: 'Thêm', exact: true }).click();
        assert.equal((await (await noteResponse).json()).errCode, 0);
        await expect(detail.locator('.kb-note-body')).toHaveText('Ghi chú riêng từ bài nghiệm thu trình duyệt');
        await screenshot(recruiter, '05-recruiter-detail');
        const storedPdfResponse = recruiter.waitForResponse(response => new URL(response.url()).pathname === '/api/get-detail-cv-by-id');
        await detail.getByRole('button', { name: 'Xem file CV', exact: true }).click();
        const storedPdf = (await (await storedPdfResponse).json()).data;
        assert.equal(storedPdf.file, 'data:application/pdf;base64,' + pdfBytes.toString('base64'));
        assert.equal(storedPdf.isChecked, 1);
        pass('same-company recruiter drag/drop survives reload; private note saved; actual legacy PDF equals reviewed bytes');

        current = candidate;
        await candidate.getByRole('button', { name: 'Tải lại hồ sơ' }).click();
        await expect(historyRow).toContainText('Phỏng vấn'); await expect(historyRow).toContainText('Đã xem');
        await expect(candidate.locator('body')).not.toContainText('Ghi chú riêng từ bài nghiệm thu trình duyệt');
        await screenshot(candidate, '06-candidate-interview');
        const ownPdfResponse = candidate.waitForResponse(response => new URL(response.url()).pathname === '/api/get-detail-cv-by-id');
        await historyRow.getByRole('link', { name: 'Xem CV đã nộp' }).click();
        assert.equal((await (await ownPdfResponse).json()).data.file, storedPdf.file);
        await expect(candidate.getByRole('link', { name: 'Mở PDF đã nộp' })).toBeVisible();
        await expect(candidate.locator('.submitted-cv-frame')).not.toBeVisible();
        assert.ok(await candidate.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        const downloadResponse = candidate.waitForEvent('download');
        await candidate.getByRole('link', { name: 'Tải CV đã nộp' }).click();
        const download = await downloadResponse;
        const downloaded = path.join(artifacts, 'downloaded-cv.pdf'); await download.saveAs(downloaded);
        assert.deepEqual(await readFile(downloaded), pdfBytes);
        await screenshot(candidate, '07-submitted-pdf');
        const opened = candidate.waitForEvent('popup');
        const expectedPdfUrl = await candidate.getByRole('link', { name: 'Mở PDF đã nộp' }).getAttribute('href');
        await candidate.getByRole('link', { name: 'Mở PDF đã nộp' }).click();
        const pdfTab = await opened;
        await expect.poll(() => pdfTab.url()).toBe(expectedPdfUrl);
        await pdfTab.close();
        await candidate.setViewportSize({ width: 1365, height: 1000 });
        await expect(candidate.locator('.submitted-cv-frame')).toBeVisible();
        await screenshot(candidate, '09-submitted-pdf-desktop');
        await candidate.setViewportSize({ width: 390, height: 844 });
        pass('candidate sees interview/read status and submitted PDF through actual API without recruiter notes');

        await candidate.goto(origin + '/candidate/ai-cv');
        await candidate.getByRole('button', { name: 'Tải danh sách CV', exact: true }).click();
        // Select the saved record in the actual editor before deleting the source.
        await candidate.getByRole('button', { name: cv.title, exact: true }).click();
        await candidate.getByLabel('Họ và tên', { exact: true }).fill('Bản CV đã chỉnh sửa sau khi nộp');
        const edited = candidate.waitForResponse(response => new URL(response.url()).pathname === `/api/profile/cvs/${cv._id}` && response.request().method() === 'PUT');
        await candidate.getByRole('button', { name: 'Lưu CV', exact: true }).click();
        assert.equal((await (await edited).json()).errCode, 0);
        await expect(candidate.getByRole('button', { name: 'Lưu CV', exact: true })).toBeEnabled();
        candidate.once('dialog', dialog => dialog.accept());
        await candidate.getByRole('button', { name: 'Xóa CV', exact: true }).click();
        await expect(candidate.getByRole('button', { name: 'Xóa CV', exact: true })).not.toBeVisible();
        await compose('restart', 'application-service', 'identity-service', 'legacy');
        await compose('run', '--rm', '--no-deps', 'runner', 'node', '--input-type=module', '-e',
            "for (const url of ['http://legacy:4011/readyz','http://identity-service:4001/readyz','http://application-service:4004/readyz']) { let ready=false; for(let n=0;n<90;n++){try{ready=(await fetch(url,{signal:AbortSignal.timeout(1000)})).ok;}catch{} if(ready)break;await new Promise(r=>setTimeout(r,1000));}if(!ready)throw Error('Restart readiness timeout'); }");
        await candidate.goto(origin + '/candidate/cv-post');
        await expect(historyRow).toContainText('Phỏng vấn', { timeout: 30000 });
        const restartPdfResponse = candidate.waitForResponse(response => new URL(response.url()).pathname === '/api/get-detail-cv-by-id');
        await historyRow.getByRole('link', { name: 'Xem CV đã nộp' }).click();
        assert.equal((await (await restartPdfResponse).json()).data.file, storedPdf.file);
        pass('editing/deleting prepared source and restarting services preserves submitted PDF and candidate progress');

        const outsider = await session(11, '/admin/pipeline');
        await expect(outsider.getByRole('heading', { name: 'Quản lý hồ sơ ứng tuyển' })).toBeVisible();
        const emptyBoardResponse = outsider.waitForResponse(response => new URL(response.url()).pathname === '/api/applications/board');
        await outsider.reload();
        const emptyBoard = await (await emptyBoardResponse).json();
        assert.equal(emptyBoard.errCode, 0); assert.equal(emptyBoard.data.total, 0);
        await expect(outsider.locator('.kb-empty')).not.toBeVisible();
        await expect(outsider.locator('.kb-card')).toHaveCount(0);
        const deniedPdf = outsider.waitForResponse(response => new URL(response.url()).pathname === '/api/get-detail-cv-by-id');
        await outsider.goto(origin + `/admin/user-cv/${receipt.cvId}`);
        assert.equal((await deniedPdf).status(), 403);
        await expect(outsider.getByRole('alert').first()).toContainText('quyền');
        await expect(outsider.locator('iframe')).toHaveCount(0);
        await expect(outsider.getByRole('link', { name: 'Mở PDF đã nộp' })).toHaveCount(0);
        current = recruiter;
        await recruiter.goto(origin + '/admin/user-cv/9105');
        await expect(recruiter.getByText('Thông tin ứng viên không còn khả dụng')).toBeVisible();
        await expect(recruiter.getByText('Hồ sơ này không còn tệp PDF hợp lệ để xem.')).toBeVisible();
        current = candidate;
        await candidate.goto(origin + '/admin/pipeline'); await expect(candidate).toHaveURL(origin + '/forbidden');
        pass('other-company browser cannot see applications/PDF; candidate route guard blocks recruiter workspace');
        assert.ok(calls.some(row => row.path === '/api/search/jobs'));
        assert.equal(calls.filter(row => row.path === '/api/create-new-cv' && row.method === 'POST').length, 1);
        assert.deepEqual(errors, [], 'browser runtime errors'); assert.deepEqual(failures, [], 'unexpected server errors');
        await writeFile(path.join(artifacts, 'evidence.json'), JSON.stringify({ checkpoints, calls,
            jobId, legacyCvId: receipt.cvId, preparedCvId: cv._id, pdfBytes: pdfBytes.length,
            pdfSha256: createHash('sha256').update(pdfBytes).digest('hex'), browserErrors: errors, serverErrors: failures }, null, 2));
        console.log('Browser artifacts: ' + artifacts);
    } catch (error) {
        await writeFile(path.join(artifacts, 'failure-evidence.json'), JSON.stringify({ checkpoints, calls, browserErrors: errors, serverErrors: failures }, null, 2));
        if (current) {
            await screenshot(current, 'failure').catch(() => {});
            console.error('Current page: ' + current.url());
            console.error((await current.locator('body').innerText().catch(() => '')).slice(0, 4500));
        }
        console.error('Browser errors: ' + JSON.stringify(errors)); console.error('HTTP failures: ' + JSON.stringify(failures));
        console.error('Browser artifacts: ' + artifacts); throw error;
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
