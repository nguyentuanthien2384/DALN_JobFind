'use strict';

// Live acceptance checks against the already seeded local app. No applications,
// emails, payments or AI calls are submitted. Login and profile reads may create
// normal session/read-status records; all browser sessions are logged out.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const { PASSWORD } = require('./demo-data/mysql.cjs');
const root = path.resolve(__dirname, '../..');
const web = process.env.DEMO_WEB_URL || 'http://localhost:3000';
const api = process.env.DEMO_API_URL || 'http://localhost:4000';

async function main() {
    for (const url of [web, api]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
    const manifest = JSON.parse(await fs.readFile(path.join(root, '.local/demo-data/manifest.json')));
    const output = path.join(root, '.local/demo-data');
    const browser = await chromium.launch({ headless: true });
    const checks = [];
    const pass = name => { checks.push(name); console.log('PASS: ' + name); };
    const contexts = [];
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
        contexts.push(context);
        const page = await context.newPage();
        const faults = [];
        page.on('pageerror', error => faults.push(error.message));
        await page.goto(web + '/login');
        await page.getByPlaceholder('Email hoặc số điện thoại').fill('0918800001');
        await page.getByPlaceholder('Mật khẩu', { exact: true }).fill(PASSWORD);
        // Read the actual upstream login response before the app's full-page
        // navigation discards Chromium's response-body handle.
        let loginComplete;
        const logged = new Promise(resolve => { loginComplete = resolve; });
        await page.route('**/api/login', async route => {
            const response = await route.fetch();
            const result = await response.json();
            await route.fulfill({ response });
            loginComplete(result);
        });
        await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
        const auth = await logged;
        assert.equal(auth.errCode, 0);
        const get = async url => {
            const response = await context.request.get(api + url, { headers: { Authorization: `Bearer ${auth.token}` } });
            assert.equal(response.status(), 200, url);
            const data = await response.json();
            assert.equal(data.errCode, 0, url);
            return data;
        };
        const jobs = await get('/api/candidate-search-jobs?limit=20&offset=0');
        assert.ok(jobs.data.length >= 6);
        assert.ok(jobs.data.every(job => manifest.posts.some(p => p.id === job.id && p.companyId === auth.user.companyId)));
        const board = await get('/api/applications/board');
        assert.equal(board.data.total, 18);
        assert.equal(board.data.columns.length, 6);
        assert.ok(board.data.columns.every(column => column.count === 3));
        pass('Nhà tuyển dụng mới: 6 tin thuộc đúng công ty, 18 hồ sơ ở đủ 6 bước');
        const candidates = await get('/api/fillter-cv-by-selection?limit=5&offset=0');
        assert.ok(candidates.count >= 72);
        const primary = jobs.data.find(j => j.name.includes('Frontend'));
        assert.ok(primary);
        const criteria = primary.criteria;
        const query = new URLSearchParams({ limit: 5, offset: 0, categoryJobCode: criteria.categoryJobCode,
            provinceCode: criteria.provinceCode, salaryCode: criteria.salaryCode, experienceJobCode: criteria.experienceJobCode,
            listSkills: criteria.listSkills.map(s => s.id).join(','), skillMode: 'any', sort: 'match' });
        const matched = await get('/api/fillter-cv-by-selection?' + query);
        assert.ok(matched.count >= 1, 'Strong-match profile should survive hard filters');
        pass('Bộ lọc theo tin tuyển dụng trả về ứng viên có kỹ năng phù hợp');
        await page.goto(web + '/admin/list-candiate/');
        await expect(page.getByRole('heading', { name: 'Tìm ứng viên phù hợp' })).toBeVisible();
        await page.getByRole('combobox', { name: 'Chọn tin tuyển dụng' }).click();
        await expect(page.getByTitle(`#${primary.id} · ${primary.name}`)).toBeVisible();
        await page.getByTitle(`#${primary.id} · ${primary.name}`).click();
        await expect(page.locator('.cv-search-score').first()).toBeVisible();
        await page.screenshot({ path: path.join(output, 'candidate-search.png'), fullPage: true });
        pass('Màn tìm ứng viên: chọn được tin và hiển thị điểm đối chiếu');
        await page.goto(web + '/admin/pipeline/');
        await expect(page.locator('.kb-card')).toHaveCount(18);
        await page.screenshot({ path: path.join(output, 'pipeline.png'), fullPage: true });
        const detailId = board.data.columns.find(c => c.stage === 'phong_van').items[0].id;
        const detail = await get('/api/applications/' + detailId);
        assert.ok(detail.data.notes.length >= 2 && detail.data.timeline.length >= 3);
        pass('Bảng tuyển dụng và chi tiết có ghi chú, đánh giá, lịch sử xử lý');
        const candidate = manifest.candidates[0];
        await page.goto(web + '/admin/candiate/' + candidate.id);
        const selector = page.getByRole('combobox', { name: 'Tin tuyển dụng để đối chiếu' });
        await expect(selector).toBeVisible();
        await selector.click();
        await page.getByTitle(`#${primary.id} · ${primary.name}`).click();
        await expect(page.getByRole('button', { name: /Phân tích CV/ })).toBeEnabled();
        await page.screenshot({ path: path.join(output, 'candidate-detail.png'), fullPage: true });
        const pdfButton = page.getByRole('button', { name: /Xem.*PDF|Xem CV|Xem trước/i }).first();
        await pdfButton.click();
        await expect(page.locator('.chat-pdf-modal canvas').first()).toBeVisible({ timeout: 30000 });
        await page.screenshot({ path: path.join(output, 'resume-preview.png'), fullPage: true });
        pass('Chi tiết ứng viên: chọn tin đối chiếu và mở được CV PDF thật');

        for (const [phone, password, role] of [['0900000002', '123456', 'existing-employer'], ['0928800001', PASSWORD, 'candidate']]) {
            const session = await browser.newContext();
            contexts.push(session);
            const login = await session.request.post(api + '/api/auth/login', {
                headers: { Origin: web }, data: { phonenumber: phone, password }
            });
            const result = await login.json();
            assert.equal(result.errCode, 0, role + ' login');
            const request = async endpoint => {
                const response = await session.request.get(api + endpoint, { headers: { Authorization: `Bearer ${result.token}` } });
                assert.equal(response.status(), 200, endpoint);
                return response.json();
            };
            if (role === 'existing-employer') {
                const existingBoard = await request('/api/applications/board');
                assert.ok(existingBoard.data.total >= 24);
                assert.ok(existingBoard.data.columns.every(c => c.count >= 4));
                const existingJobs = await request('/api/candidate-search-jobs?limit=20&offset=0');
                assert.ok(existingJobs.data.length >= 6);
                pass('Tài khoản tuyển dụng cũ 0900000002 có tin và dữ liệu đủ 6 bước');
            } else {
                const cvs = await request('/api/profile/cvs');
                assert.equal(cvs.count, 2);
                assert.ok(cvs.data.every(cv => cv.experiences[0].from && cv.educations[0].school && cv.languages.length === 2));
                const history = await request('/api/my-applications');
                assert.ok(history.data.length > 0);
                pass('Tài khoản ứng viên có 2 CV Builder đầy đủ và lịch sử ứng tuyển');
            }
        }
        const publicResponse = await context.request.get(api + '/api/search/jobs?limit=10&offset=0');
        const publicJobs = await publicResponse.json();
        assert.equal(publicJobs.errCode, 0);
        // `npm run demo:hide-jobs` keeps fictional vacancies out of public search; `demo:show-jobs` restores them.
        const hidden = await fs.access(path.join(output, 'hidden-demo-posts.json')).then(() => true, () => false);
        assert.equal(publicJobs.data.some(job => job.name.includes('[Demo]')), !hidden);
        assert.deepEqual(faults, []);
        pass(hidden ? 'Tin demo đã được ẩn khỏi tìm kiếm công khai; các màn đã mở không có lỗi JavaScript'
            : 'Tìm kiếm công khai đã có tin demo; các màn đã mở không có lỗi JavaScript');
        await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), checks }, null, 2));
    } finally {
        for (const context of contexts) {
            await context.request.post(api + '/api/auth/logout', { headers: { Origin: web }, data: {} }).catch(() => {});
        }
        await browser.close();
    }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
