// Real application modal, PDF.js viewer and API client with local browser fixtures.
// No account, job application or external service is changed by this check.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { chromium, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.local/cv-upload');
const limit = 2 * 1024 * 1024;
let server, browser;

(async () => {
    await fs.mkdir(output, { recursive: true });
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let number = 1; number <= 2; number++) {
        const sheet = pdf.addPage([595, 842]);
        sheet.drawText(number === 1 ? 'JOBFIND | UPLOADED CV' : 'EXPERIENCE & PROJECTS', { x: 45, y: 770, size: 22, font });
        sheet.drawText(`Local upload regression fixture - page ${number}`, { x: 45, y: 725, size: 12, font });
        sheet.drawText('This synthetic file contains no candidate personal information.', { x: 45, y: 695, size: 11, font });
    }
    const plainPdf = Buffer.from(await pdf.save());
    const bomPdf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(' \r\n\t'), plainPdf]);
    const oversized = Buffer.concat([plainPdf, Buffer.alloc(limit + 1 - plainPdf.length, 32)]);

    execFileSync(process.execPath, [path.join(root, 'frontend/scripts/copy-pdf-assets.cjs')], { windowsHide: true, stdio: 'ignore' });
    await require('esbuild').build({
        stdin: {
            contents: `import React, {useState} from 'react';
                import {createRoot} from 'react-dom/client';
                import {ToastContainer} from 'react-toastify';
                import 'react-toastify/dist/ReactToastify.css';
                import './src/css/App.css';
                import SendCvModal from './src/components/modal/SendCvModal';
                const user={id:98765,roleCode:'CANDIDATE',firstName:'Ứng viên',lastName:'Kiểm thử'};
                localStorage.setItem('token_user','local-cv-upload-fixture');
                localStorage.setItem('userData',JSON.stringify(user));
                function App(){const[opened,setOpened]=useState(true),[submitted,setSubmitted]=useState(false);return <main>
                    <h1>Kiểm tra ứng tuyển</h1><button onClick={()=>setOpened(true)}>Mở form ứng tuyển</button>
                    {submitted&&<p role='status'>Đã nhận hồ sơ kiểm thử</p>}
                    {opened&&<SendCvModal isOpen postId={42} jobTitle='QA Engineer Manual / Automation — Công ty kiểm thử'
                        onHide={()=>setOpened(false)} onSubmitted={()=>setSubmitted(true)}/>}
                    <ToastContainer autoClose={150} pauseOnFocusLoss={false} pauseOnHover={false}/>
                </main>}createRoot(document.getElementById('root')).render(<App/>);`,
            resolveDir: path.join(root, 'frontend'), loader: 'jsx',
        },
        bundle: true, format: 'esm', outfile: path.join(output, 'app.js'), loader: { '.js': 'jsx' },
        define: {
            'process.env.NODE_ENV': JSON.stringify('production'),
            'process.env.PUBLIC_URL': JSON.stringify(''),
            'process.env.REACT_APP_BACKEND_URL': JSON.stringify('/'),
            'process.env.REACT_APP_CANDIDATE_AI_ENABLED': JSON.stringify('true'),
            'process.env.REACT_APP_PREPARED_CV_APPLICATION_ENABLED': JSON.stringify('false'),
        },
        logLevel: 'warning',
    });
    await fs.writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="vi"><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <link rel="stylesheet" href="/assetsAdmin/vendors/css/vendor.bundle.base.css">
        <link rel="stylesheet" href="/assetsAdmin/css/vertical-layout-light/style.css">
        <link rel="stylesheet" href="/assets/css/style.css"><link rel="stylesheet" href="/app.css">
        <style>body{background:#f5f7fa}main{padding:24px}main>h1{font-size:24px}main>button{padding:10px}</style>
        <div id="root"></div><script type="module" src="/app.js"></script></html>`);
    const express = require('express'), app = express();
    app.use(express.static(output, { dotfiles: 'allow' }));
    app.use(express.static(path.join(root, 'frontend/public')));
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;

    browser = await chromium.launch({ headless: true });
    const report = [];
    for (const scenario of [
        { name: 'desktop', width: 1440, height: 1000 },
        { name: 'mobile', width: 390, height: 844 },
    ]) {
        const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, serviceWorkers: 'block' });
        const page = await context.newPage();
        const errors = [], blockedExternalRequests = [], submissions = [], unexpectedApi = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.routeWebSocket('**/*', socket => socket.close());
        await page.route('**/*', async route => {
            const request = route.request(), url = new URL(request.url());
            if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
            // The production CSS imports Google Fonts. Stub that optional stylesheet
            // locally, so this fixture never makes an external network request.
            if (url.hostname === 'fonts.googleapis.com' && request.resourceType() === 'stylesheet')
                return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
            if (url.origin !== origin) {
                blockedExternalRequests.push(request.url());
                return route.abort();
            }
            if (url.pathname.startsWith('/api/')) {
                let result;
                if (url.pathname === '/api/get-detail-user-by-id' && request.method() === 'GET')
                    result = { errCode: 0, data: { userAccountData: {} } };
                else if (url.pathname === '/api/create-new-cv' && request.method() === 'POST') {
                    submissions.push(request.postDataJSON());
                    result = { errCode: 0 };
                } else {
                    unexpectedApi.push(`${request.method()} ${url.pathname}`);
                    result = { errCode: 400, errMessage: 'Unexpected API in upload fixture' };
                }
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
            }
            return route.continue();
        });
        await page.goto(origin);
        const modal = page.locator('.send-cv-modal');
        const input = page.getByLabel('Chọn tệp CV', { exact: true });
        const submit = modal.getByRole('button', { name: 'Gửi hồ sơ', exact: true });
        const preview = modal.getByRole('button', { name: 'Xem trước CV', exact: true });
        const dismissToasts = async () => {
            await expect(page.locator('.Toastify__toast')).toHaveCount(0, { timeout: 10000 });
        };
        await expect(modal).toBeVisible();
        await modal.getByLabel('Lời giới thiệu', { exact: true }).fill('Tôi muốn ứng tuyển và đã kiểm tra bản CV đính kèm.');
        await expect(submit).toBeDisabled();

        for (const fixture of [
            { name: 'CV-BOM-empty-mime.pdf', mimeType: '', buffer: bomPdf },
            { name: 'CV-BOM-octet-stream.pdf', mimeType: 'application/octet-stream', buffer: bomPdf },
        ]) {
            await input.setInputFiles(fixture);
            await expect(preview).toBeVisible();
            await expect(submit).toBeEnabled();
            await expect(modal).toContainText(fixture.name);
            await preview.click();
            await expect(page.locator('.react-pdf__Page canvas')).toBeVisible({ timeout: 20000 });
            await expect(page.getByText('Trang 1 / 2', { exact: true })).toBeVisible();
            await page.getByRole('button', { name: 'Trang PDF sau', exact: true }).click();
            await expect(page.getByText('Trang 2 / 2', { exact: true })).toBeVisible();
            await expect(page.locator('.react-pdf__Page canvas')).toBeVisible();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Preview must fit its viewport');
            if (fixture.mimeType) {
                await page.screenshot({ path: path.join(output, `${scenario.name}-preview.png`), animations: 'disabled' });
                const [download] = await Promise.all([
                    page.waitForEvent('download'), page.getByRole('link', { name: 'Tải PDF', exact: true }).click(),
                ]);
                assert.deepEqual(await fs.readFile(await download.path()), bomPdf, 'Preview download must preserve original PDF bytes');
            }
            // The next-page button becomes disabled on the final page. Move keyboard
            // focus to an enabled viewer control before exercising nested Escape.
            await page.getByRole('link', { name: 'Tải PDF', exact: true }).focus();
            await page.keyboard.press('Shift+Tab');
            assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.ant-modal'))), true);
            await page.keyboard.press('Escape');
            await expect(page.locator('.react-pdf__Page canvas')).toHaveCount(0);
            await expect(modal).toBeVisible();
            await expect(modal.getByLabel('Lời giới thiệu', { exact: true })).toHaveValue('Tôi muốn ứng tuyển và đã kiểm tra bản CV đính kèm.');
            assert.equal(submissions.length, 0, 'Selecting and previewing a CV must never submit an application');
        }

        for (const fixture of [
            { name: 'not-a-pdf.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>not a PDF</html>'), expected: /PDF/ },
            { name: 'too-large.pdf', mimeType: 'application/pdf', buffer: oversized, expected: /2 MiB/ },
            { name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0), expected: /PDF/ },
            { name: 'wrong-extension.txt', mimeType: 'application/pdf', buffer: plainPdf, expected: /PDF/ },
        ]) {
            await dismissToasts();
            await input.setInputFiles({ name: fixture.name, mimeType: fixture.mimeType, buffer: fixture.buffer });
            await expect(modal.getByRole('alert')).toContainText(fixture.expected);
            await expect(preview).toHaveCount(0);
            await expect(submit).toBeDisabled();
            assert.equal(await input.evaluate(element => element.files.length), 0, 'Rejected input must clear its displayed filename');
            assert.equal(submissions.length, 0);
            if (fixture.name === 'too-large.pdf')
                await page.screenshot({ path: path.join(output, `${scenario.name}-invalid.png`), animations: 'disabled' });
        }

        await input.setInputFiles({ name: 'CV-final.pdf', mimeType: 'application/octet-stream', buffer: bomPdf });
        await expect(preview).toBeVisible();
        await expect(modal.getByRole('alert')).toHaveCount(0);
        await expect(submit).toBeEnabled();
        await dismissToasts();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Form must fit mobile and desktop viewports');
        await page.screenshot({ path: path.join(output, `${scenario.name}-selected.png`), animations: 'disabled' });
        await submit.click();
        await expect(modal).toHaveCount(0);
        await expect(page.getByText('Đã nhận hồ sơ kiểm thử', { exact: true })).toBeVisible();
        assert.equal(submissions.length, 1);
        assert.equal(submissions[0].userId, 98765);
        assert.equal(submissions[0].postId, 42);
        assert.equal(submissions[0].file, `data:application/pdf;base64,${bomPdf.toString('base64')}`, 'Submission must normalize only MIME, retaining the original PDF bytes');
        assert.deepEqual(unexpectedApi, []);
        assert.deepEqual(blockedExternalRequests, []);
        assert.deepEqual(errors, []);
        report.push({ scenario: scenario.name, result: 'PASS', submissions: submissions.length, pdfBytes: bomPdf.length,
            checked: ['BOM/whitespace header', 'empty/octet-stream MIME', 'two rendered PDF pages', 'nested Escape', 'original bytes', 'invalid/oversize/empty/extension rejection', 'no external traffic', 'no JavaScript errors'] });
        console.log(`PASS ${scenario.name}: valid PDF upload and preview, safe rejection, exact-byte fixture submission.`);
        await context.close();
    }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});
