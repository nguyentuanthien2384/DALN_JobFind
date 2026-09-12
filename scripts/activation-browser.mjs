import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const backendRequire = createRequire(path.join(root, 'backend/package.json'));
const { chromium, expect } = createRequire(path.join(root, 'microservices/package.json'))('playwright/test');
const { io } = createRequire(path.join(root, 'frontend/package.json'))('socket.io-client');
const origin = 'http://127.0.0.1:3001';

// Read real data without submitting applications or changing account passwords.
// Session tokens and personal records stay in memory; evidence is counts only.
export async function checkBrowser(directory, stage) {
    const env = backendRequire('dotenv').parse(await readFile(path.join(root, 'backend/.env')));
    const settings = JSON.parse(await readFile(path.join(directory, 'private.json'), 'utf8'));
    const db = await backendRequire('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT),
        user: settings.mysqlRoles.gateway.user, password: settings.mysqlRoles.gateway.password, database: env.DB_NAME });
    let browser;
    const report = { stage, checks: [], writes: 0, errors: 0 };
    try {
        const [[candidate]] = await db.query("SELECT u.id,a.roleCode FROM users u JOIN accounts a ON a.userId=u.id WHERE a.statusCode='S1' AND a.roleCode='CANDIDATE' ORDER BY (SELECT COUNT(*) FROM cvs WHERE userId=u.id) DESC,u.id LIMIT 1");
        const [[company]] = await db.query("SELECT u.id,a.roleCode,u.companyId,c.statusCode companyStatusCode,c.censorCode companyCensorCode FROM users u JOIN accounts a ON a.userId=u.id JOIN companies c ON c.id=u.companyId WHERE a.statusCode='S1' AND a.roleCode IN ('COMPANY','EMPLOYER') AND c.statusCode='S1' AND c.censorCode='CS1' ORDER BY u.id LIMIT 1");
        assert.ok(candidate && company);
        const token = user => backendRequire('jsonwebtoken').sign({ sub: String(user.id) }, env.JWT_SECRET,
            { algorithm: 'HS256', issuer: 'jobfind-auth', audience: 'jobfind-api', expiresIn: 300 });
        browser = await chromium.launch({ headless: true });
        const context = async user => {
            const c = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
            if (user) await c.addInitScript(({ user, token }) => {
                if (window.top !== window) return;
                localStorage.setItem('userData', JSON.stringify({ ...user, firstName: 'Kiểm tra', lastName: 'triển khai' }));
                localStorage.setItem('token_user', token);
            }, { user, token: token(user) });
            await c.route('**/*', route => {
                const r = route.request(), url = new URL(r.url());
                if (url.origin !== origin) return route.abort();
                if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) {
                    report.writes++; return route.abort();
                }
                return route.continue();
            });
            const p = await c.newPage(); p.on('pageerror', () => report.errors++);
            return { c, p };
        };
        const responseFor = (p, pathname) => p.waitForResponse(r => new URL(r.url()).pathname === pathname && r.request().method() === 'GET', { timeout: 30000 });
        const valid = async response => { assert.equal(response.status(), 200); const b = await response.json(); assert.equal(b.errCode, 0); return b; };
        const { c: publicContext, p: publicPage } = await context();
        const searchResponse = responseFor(publicPage, '/api/search/jobs');
        await publicPage.goto(origin + '/job');
        const jobs = await valid(await searchResponse); assert.ok(jobs.count > 0);
        await expect(publicPage.locator('a[href^="/detail-job/"]').first()).toBeVisible();
        report.checks.push('public browser uses real Core search'); await publicContext.close();
        if (stage !== 'search') {
            const { c, p } = await context(candidate);
            const progress = responseFor(p, '/api/my-applications');
            await p.goto(origin + '/candidate/cv-post'); await valid(await progress);
            await expect(p.getByRole('columnheader', { name: 'Tiến trình tuyển dụng', exact: true })).toBeVisible();
            await expect(p.getByRole('link', { name: 'Xem CV đã nộp' }).first()).toBeVisible();
            await expect(p.getByRole('button', { name: 'Tải lại hồ sơ', exact: true })).toBeEnabled();
            assert.equal(await p.locator('.application-history [role="alert"]').count(), 0);
            report.checks.push('candidate browser displays real application history and progress');
            await p.setViewportSize({ width: 390, height: 844 });
            assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
            report.checks.push('candidate history fits mobile viewport');
            await c.close();
        }
        if (['workspace', 'prepared-cv'].includes(stage)) {
            const { c, p } = await context(company);
            const workspace = responseFor(p, '/api/jobs/manage');
            await p.goto(origin + '/admin/list-post'); await valid(await workspace);
            await expect(p.getByRole('heading', { name: 'Danh sách bài đăng', exact: true })).toBeVisible();
            await expect(p.getByRole('button', { name: 'Tải lại danh sách', exact: true })).toBeEnabled();
            await expect(p.getByText(/Danh sách riêng của công ty qua Job Core/)).toBeVisible();
            assert.equal(await p.locator('.card-body [role="alert"]').count(), 0);
            report.checks.push('company browser uses private Core workspace'); await c.close();
        }
        if (stage === 'prepared-cv') {
            // Existing listings can be expired. Do not alter deadlines to test a modal.
            const [openJobs] = await db.query("SELECT p.id FROM posts p JOIN users u ON u.id=p.userId JOIN companies c ON c.id=u.companyId WHERE p.statusCode='PS1' AND c.statusCode='S1' AND c.censorCode='CS1' AND CAST(p.timeEnd AS UNSIGNED)>? AND NOT EXISTS(SELECT 1 FROM cvs WHERE cvs.userId=? AND cvs.postId=p.id) ORDER BY p.id LIMIT 1", [Date.now(), candidate.id]);
            const { c, p } = await context(candidate);
            if (openJobs.length) {
                await p.goto(origin + '/detail-job/' + openJobs[0].id + '/');
                await p.getByRole('button', { name: /Nộp CV ngay/ }).first().click();
                const modal = p.getByRole('dialog'); await expect(modal).toBeVisible();
                const saved = responseFor(p, '/api/profile/cvs');
                await modal.getByLabel('CV đã chuẩn bị', { exact: true }).check();
                const cvs = await valid(await saved); report.savedCvChoices = cvs.data.length;
                await expect(modal.getByRole('button', { name: 'Gửi hồ sơ', exact: true })).toBeDisabled();
                if (cvs.data.length) {
                    await modal.getByLabel('CV đã lưu', { exact: true }).selectOption(cvs.data[0]._id);
                    await modal.getByRole('button', { name: 'Tạo bản PDF để xem lại' }).click();
                    await expect(modal.getByRole('link', { name: 'Mở bản PDF sẽ gửi' })).toBeVisible({ timeout: 20000 });
                    report.checks.push('saved CV produces PDF preview without submission');
                } else await expect(modal.getByText(/Bạn chưa có CV đã lưu/)).toBeVisible();
                report.checks.push('prepared CV selector reads actual saved CVs; submit requires review');
            } else {
                report.limitation = 'All applicable existing jobs expired; live application modal not exercised. Prepared PDF/submission was verified in isolated release tests.';
            }
            await p.goto(origin + '/candidate/ai-cv');
            await expect(p.getByText(/Tính năng mới chưa mở/)).toBeVisible();
            report.checks.push('AI controls remain disabled'); await c.close();
            await new Promise((resolve, reject) => {
                const socket = io(origin, { auth: { token: token(candidate) }, transports: ['websocket'], reconnection: false, timeout: 10000 });
                socket.once('connect', () => { socket.disconnect(); resolve(); });
                socket.once('connect_error', () => { socket.disconnect(); reject(Error('Authenticated Socket connection failed')); });
            });
            report.checks.push('authenticated Socket connects through same-origin proxy');
        }
        assert.equal(report.writes, 0, 'Browser attempted a business write');
        assert.equal(report.errors, 0, 'Browser runtime errors');
        return report;
    } finally { await browser?.close(); await db.end(); }
}
