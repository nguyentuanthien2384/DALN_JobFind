import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const { chromium, expect } = createRequire(fileURLToPath(new URL('../microservices/package.json', import.meta.url)))('playwright/test');
// Uses the actually served bundle with explicitly synthetic browser-only API fixtures.
// No candidate, listing, CV or submission is written into the real backend.
export async function checkPreparedFlag(enabled) {
    const origin = 'http://127.0.0.1:3001', browser = await chromium.launch({ headless: true });
    const result = { scope: 'served bundle with synthetic browser API fixtures', enabled, submitted: 0, apiRequestsReachedBackend: 0 };
    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
        await context.addInitScript(() => { if (window.top !== window) return; localStorage.setItem('userData', JSON.stringify({ id: 8, roleCode: 'CANDIDATE', firstName: 'Synthetic', lastName: 'Acceptance' })); localStorage.setItem('token_user', 'synthetic-local-fixture'); });
        const cv = { _id: '507f1f77bcf86cd799439011', title: 'CV nghiệm thu', fullName: 'Ứng viên kiểm thử', email: 'test@example.invalid', phone: '', address: '', summary: 'Kiểm tra PDF tiếng Việt.', skills: ['Node'], languages: ['Tiếng Việt'], experiences: [], educations: [] };
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
                if (url.pathname === '/api/profile/cvs') return reply({ errCode: 0, data: [cv], count: 1 });
                if (url.pathname === '/api/create-new-cv' && request.method() === 'POST') { result.submitted++; return reply({ errCode: 0, cvId: 22 }); }
                return reply({ errCode: 0, data: [], count: 0, isFavorite: false });
            }
            return url.origin === origin ? route.continue() : route.abort();
        });
        const p = await context.newPage(); p.on('pageerror', e => errors.push(e.name));
        await p.goto(origin + '/detail-job/7/');
        await p.getByRole('button', { name: /Nộp CV ngay/ }).first().click();
        const modal = p.getByRole('dialog'); await expect(modal).toBeVisible();
        if (!enabled) {
            assert.equal(await modal.getByLabel('CV đã chuẩn bị', { exact: true }).count(), 0);
            assert.ok(!requests.some(r => r.path === '/api/profile/cvs'));
        } else {
            await modal.getByLabel('CV đã chuẩn bị', { exact: true }).check();
            await modal.getByLabel('CV đã lưu', { exact: true }).selectOption(cv._id);
            await modal.getByLabel('Lời giới thiệu', { exact: true }).fill('Hồ sơ kiểm thử trình duyệt.');
            const send = modal.getByRole('button', { name: 'Gửi hồ sơ', exact: true }); await expect(send).toBeDisabled();
            await modal.getByRole('button', { name: 'Tạo bản PDF để xem lại' }).click();
            const link = modal.getByRole('link', { name: 'Mở bản PDF sẽ gửi' }); await expect(link).toBeVisible({ timeout: 20000 });
            const bytes = Buffer.from(await p.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), await link.getAttribute('href')));
            assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok(bytes.length < 2 * 1024 * 1024);
            await expect(send).toBeDisabled();
            await modal.getByLabel('Tôi đã xem và chọn bản PDF này để ứng tuyển').check(); await expect(send).toBeEnabled();
            await p.setViewportSize({ width: 390, height: 844 });
            assert.ok(await modal.evaluate(e => e.scrollWidth <= e.clientWidth + 1));
            result.pdf = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), reviewRequired: true, mobileFits: true };
        }
        assert.deepEqual(errors, []); assert.equal(result.submitted, 0); assert.ok(!requests.some(r => r.method === 'POST'));
        return result;
    } finally { await browser.close(); }
}
