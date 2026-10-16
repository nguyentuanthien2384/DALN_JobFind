import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fixturePdfBytes } from '../microservices/scripts/compose-acceptance/pdf.mjs';
const { chromium, expect } = createRequire(fileURLToPath(new URL('../microservices/package.json', import.meta.url)))('playwright/test');
// Uses the actually served bundle with explicitly synthetic browser-only API fixtures.
// No candidate, listing, CV or submission is written into the real backend.
export async function checkPreparedFlag(enabled) {
    const origin = 'http://127.0.0.1:3001', browser = await chromium.launch({ headless: true });
    const result = { scope: 'served bundle with synthetic browser API fixtures', enabled, submitted: 0, apiRequestsReachedBackend: 0 };
    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
        await context.addInitScript(() => { if (window.top !== window) return; localStorage.setItem('userData', JSON.stringify({ id: 8, roleCode: 'CANDIDATE', firstName: 'Synthetic', lastName: 'Acceptance' })); localStorage.setItem('token_user', 'synthetic-local-fixture'); });
        const requests = [], errors = [];
        await context.route('**/*', async route => {
            const request = route.request(), url = new URL(request.url());
            if (url.pathname.startsWith('/api/')) {
                requests.push({ path: url.pathname, method: request.method() });
                const reply = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
                if (url.pathname === '/api/auth/me') return reply({ errCode: 0, data: { userId: 8, roleCode: 'CANDIDATE', companyId: null } });
                if (url.pathname === '/api/get-detail-post-by-id') return reply({ errCode: 0, data: { id: 7, userId: 10, statusCode: 'PS1', timeEnd: Date.now() + 86400000,
                    companyData: { id: 3, name: 'Công ty kiểm thử', address: 'Đà Nẵng' }, postDetailData: { name: 'Tin kiểm thử PDF', descriptionHTML: '<p>Dữ liệu giả chỉ trong trình duyệt.</p>' } } });
                if (url.pathname === '/api/get-detail-user-by-id') return reply({ errCode: 0, data: { userAccountData: { userSettingData: { file: '' } } } });
                if (url.pathname === '/api/create-new-cv' && request.method() === 'POST') { result.submitted++; return reply({ errCode: 0, cvId: 22 }); }
                return reply({ errCode: 0, data: [], count: 0, isFavorite: false });
            }
            return url.origin === origin ? route.continue() : route.abort();
        });
        const p = await context.newPage(); p.on('pageerror', e => errors.push(e.name));
        await p.goto(origin + '/detail-job/7/');
        await p.getByRole('button', { name: /Nộp CV ngay/ }).first().click();
        const modal = p.getByRole('dialog'); await expect(modal).toBeVisible();
        // The prepared-CV choice was removed from the form, so the flag no longer changes it:
        // either setting must offer only the uploaded PDF and never read saved CVs.
        assert.equal(await modal.getByRole('radio').count(), 0);
        assert.ok(!requests.some(r => r.path === '/api/profile/cvs'));
        await modal.getByLabel('Lời giới thiệu', { exact: true }).fill('Hồ sơ kiểm thử trình duyệt.');
        const send = modal.getByRole('button', { name: 'Gửi hồ sơ', exact: true }); await expect(send).toBeDisabled();
        const bytes = fixturePdfBytes();
        await modal.getByLabel('Chọn tệp CV', { exact: true }).setInputFiles({ name: 'synthetic-cv.pdf', mimeType: 'application/pdf', buffer: bytes });
        await expect(modal.getByRole('button', { name: 'Xem trước CV', exact: true })).toBeEnabled({ timeout: 20000 });
        await expect(send).toBeEnabled();
        await p.setViewportSize({ width: 390, height: 844 });
        assert.ok(await modal.evaluate(e => e.scrollWidth <= e.clientWidth + 1));
        result.pdf = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), source: 'uploaded file', mobileFits: true };
        assert.deepEqual(errors, []); assert.equal(result.submitted, 0); assert.ok(!requests.some(r => r.method === 'POST'));
        return result;
    } finally { await browser.close(); }
}
