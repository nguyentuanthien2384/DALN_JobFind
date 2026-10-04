// Real recruiter/candidate shells and calendar, backed only by synthetic APIs.
// Every invitation POST stays in this local fixture server; no email is sent.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');
const { Server } = require('socket.io');
const sass = require('../../frontend/node_modules/sass');

const CLOCK = new Date('2026-10-04T03:00:00Z');
const interview = (changes = {}) => ({ companyName: 'Sao Khuê Digital', interviewDate: '2026-10-06', interviewTime: '09:30',
    timeZone: 'Asia/Ho_Chi_Minh', durationMinutes: '60', interviewMode: 'onsite', location: 'Tầng 5, 12 Nguyễn Huệ, TP. Hồ Chí Minh',
    round: 'Vòng chuyên môn', interviewers: 'Trần Hà · Trưởng nhóm kỹ thuật', contactName: 'Trần Hà', contactEmail: 'hr@example.test',
    contactPhone: '0901234567', preparation: 'Mang theo portfolio và chuẩn bị chia sẻ về dự án gần đây.', ...changes });
const appointment = (id, candidateName, jobTitle, details, extra = {}) => {
    const start = Date.parse(`${details.interviewDate}T${details.interviewTime}:00+07:00`);
    return { id: 100 + id, applicationId: id, legacyCvId: 200 + id, jobId: id === 2 ? 52 : 51, jobTitle,
        companyId: 42, companyName: details.companyName, candidateId: 99, candidateName, candidateEmail: 'candidate@example.test',
        applicationStage: 'phong_van', scheduledAt: '2026-10-02T04:00:00Z', startAt: new Date(start).toISOString(),
        endAt: new Date(start + Number(details.durationMinutes || 60) * 60000).toISOString(), status: 'scheduled',
        interview: details, message: 'Rất mong được trao đổi cùng bạn.', ...extra };
};

(async () => {
    const root = path.resolve(__dirname, '../..');
    const output = path.join(root, '.local/interview-calendar-checks');
    await fs.mkdir(output, { recursive: true });
    const app = express();
    app.use(express.json());
    const server = app.listen(0, '127.0.0.1');
    const io = new Server(server);
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    let activePage;
    try {
        await build({
            stdin: { contents: `
                import React from 'react'; import {createRoot} from 'react-dom/client';
                import {BrowserRouter, Routes, Route} from 'react-router-dom';
                import HomeAdmin from './src/container/system/HomeAdmin';
                import HomeCandidate from './src/container/Candidate/HomeCandidate';
                import Header from './src/container/header/header';
                import SessionContext from './src/auth/SessionContext';
                import './src/css/App.css';
                const candidate=location.pathname.startsWith('/candidate');
                const user=candidate?{id:99,roleCode:'CANDIDATE',firstName:'Nguyễn Minh',lastName:'Anh',image:'/assetsAdmin/images/logo-mini.svg'}
                    :{id:8,companyId:42,roleCode:'EMPLOYER',companyStatusCode:'S1',companyCensorCode:'CS1',firstName:'Trần',lastName:'Hà',email:'hr@example.test',image:'/assetsAdmin/images/logo-mini.svg'};
                localStorage.setItem('userData',JSON.stringify(user));
                localStorage.setItem('token_user','synthetic-browser-session');
                createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><SessionContext.Provider value={user}><Routes>
                    <Route path='/admin/*' element={<HomeAdmin user={user}/>}/>
                    <Route path='/candidate/*' element={<><Header/><HomeCandidate/></>}/>
                </Routes></SessionContext.Provider></BrowserRouter></React.StrictMode>);
            `, resolveDir: path.join(root, 'frontend'), loader: 'jsx' },
            bundle: true, outfile: path.join(output, 'app.js'),
            loader: { '.js': 'jsx', '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.gif': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
            plugins: [{ name: 'compile-scss', setup(bundler) { bundler.onLoad({ filter: /\.scss$/ }, args => ({
                contents: sass.compile(args.path, { style: 'expanded', quietDeps: true }).css,
                loader: 'css', resolveDir: path.dirname(args.path)
            })); } }],
            define: { 'process.env.NODE_ENV': '"development"', 'process.env.REACT_APP_BACKEND_URL': JSON.stringify(origin), 'process.env': '{}' },
        });
        app.use('/assets', express.static(path.join(root, 'frontend/public/assets')));
        app.use('/assetsAdmin', express.static(path.join(root, 'frontend/public/assetsAdmin')));
        app.use('/app', express.static(output));
        let entries = [
            appointment(1, 'Nguyễn Minh Anh', 'Frontend Developer', interview()),
            appointment(2, 'Lê Hoàng Nam', 'UI / UX Designer', interview({ interviewDate: '2026-10-08', interviewTime: '14:00', interviewMode: 'online', location: undefined, meetingUrl: 'https://meet.example.test/design' })),
            appointment(3, 'Trần Ngọc Linh', 'Frontend Developer', interview({ interviewDate: '2026-10-02', interviewTime: '10:00' }), { status: 'past' }),
            appointment(4, 'Phạm Gia Huy', 'Frontend Developer', interview({ interviewDate: '2026-10-12', interviewTime: '15:30', interviewMode: 'phone', location: undefined }), { status: 'inactive', applicationStage: 'tu_choi' }),
        ];
        const requests = [];
        const writes = [];
        let failCalendar = false;
        const applications = entries.map(entry => ({ id: entry.applicationId, legacy_cv_id: entry.legacyCvId, job_id: entry.jobId,
            job_title: entry.jobTitle, candidate_id: entry.candidateId, candidate_name: entry.candidateName,
            candidate_email: entry.candidateEmail, company_id: 42, stage: entry.applicationStage, notes: [],
            timeline: [{ decision_snapshot: { decision: 'interview', interview: entry.interview } }] }));
        applications.push({ id: 5, legacy_cv_id: 205, job_id: 51, job_title: 'Frontend Developer', candidate_id: 100,
            candidate_name: 'Đỗ Quỳnh Chi', candidate_email: 'chi@example.test', company_id: 42, stage: 'dang_xem_xet', timeline: [], notes: [] });
        app.all(/^\/api\//, (req, res) => {
            requests.push({ path: req.path, method: req.method, query: { ...req.query } });
            res.setHeader('Cache-Control', 'private, no-store');
            if (['/api/applications/interviews', '/api/my-interviews'].includes(req.path)) {
                if (failCalendar) return res.status(503).json({ errCode: -1, errMessage: 'Dịch vụ lịch tạm thời chưa sẵn sàng' });
                const rows = entries.filter(entry => (!req.query.from || entry.interview.interviewDate >= req.query.from)
                    && (!req.query.to || entry.interview.interviewDate <= req.query.to)
                    && (!req.query.jobId || String(entry.jobId) === req.query.jobId));
                return res.json({ errCode: 0, data: rows, count: rows.length });
            }
            if (req.path === '/api/applications') return res.json({ errCode: 0, data: applications, count: applications.length });
            const sendMatch = req.path.match(/^\/api\/applications\/(\d+)\/interview-invitation$/);
            if (sendMatch && req.method === 'POST') {
                writes.push({ id: Number(sendMatch[1]), body: req.body });
                const application = applications.find(row => row.id === Number(sendMatch[1]));
                application.stage = 'phong_van';
                application.timeline.unshift({ decision_snapshot: { decision: 'interview', interview: req.body.interview } });
                entries = entries.filter(row => row.applicationId !== application.id);
                entries.push(appointment(application.id, application.candidate_name, application.job_title, req.body.interview));
                return res.json({ errCode: 0, emailQueued: true, data: application });
            }
            const detailMatch = req.path.match(/^\/api\/applications\/(\d+)$/);
            if (detailMatch) return res.json({ errCode: 0, data: applications.find(row => row.id === Number(detailMatch[1])) });
            if (req.path.includes('get-detail-company')) return res.json({ errCode: 0, data: { id: 42, name: 'Sao Khuê Digital', address: interview().location } });
            if (req.path.includes('get-all-post-by-admin')) return res.json({ errCode: 0, count: 2, data: [
                { id: 51, postDetailData: { name: 'Frontend Developer' } }, { id: 52, postDetailData: { name: 'UI / UX Designer' } }
            ] });
            return res.json({ errCode: 0, data: [], count: 0, unreadCount: 0, totalUnread: 0 });
        });
        app.get(/.*/, (_, res) => res.send(`<!doctype html><html lang='vi'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
            <link rel='stylesheet' href='/assetsAdmin/vendors/css/vendor.bundle.base.css'>
            <link rel='stylesheet' href='/assetsAdmin/vendors/feather/feather.css'>
            <link rel='stylesheet' href='/assetsAdmin/vendors/ti-icons/css/themify-icons.css'>
            <link rel='stylesheet' href='/assets/css/fontawesome-all.min.css'>
            <link rel='stylesheet' href='/assetsAdmin/css/vertical-layout-light/style.css'>
            <link rel='stylesheet' href='/assets/css/style.css'><link rel='stylesheet' href='/app/app.css'>
            <div id='root'></div><script src='/app/app.js'></script></html>`));
        browser = await chromium.launch({ headless: true });
        const errors = [];
        const newPage = async viewport => {
            const page = await browser.newPage({ viewport });
            await page.clock.setFixedTime(CLOCK);
            page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
            page.on('dialog', dialog => dialog.accept());
            activePage = page;
            return page;
        };
        const page = await newPage({ width: 1440, height: 1000 });
        await page.goto(`${origin}/admin/interviews/`);
        await expect(page.getByRole('heading', { name: 'Lịch phỏng vấn', exact: true }).last()).toBeVisible();
        const grid = page.getByRole('table', { name: 'Lịch phỏng vấn tháng 10/2026' });
        await expect(grid.locator('.ic-grid-event')).toHaveCount(4);
        await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Lịch phỏng vấn', exact: true }))
            .toHaveAttribute('aria-current', 'page');
        await page.screenshot({ path: path.join(output, 'employer-desktop.png'), fullPage: true });

        // Local filters, safe online links, Escape and focus restoration.
        await page.getByLabel('Lọc hình thức').selectOption('online');
        await expect(grid.locator('.ic-grid-event')).toHaveCount(1);
        const onlineEvent = grid.getByRole('button', { name: 'Lê Hoàng Nam · UI / UX Designer · 14:00' });
        await onlineEvent.click();
        await expect(page.getByRole('dialog')).toContainText('Vòng chuyên môn');
        await expect(page.getByRole('link', { name: 'Mở phòng họp trực tuyến ↗' })).toHaveAttribute('href', 'https://meet.example.test/design');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(onlineEvent).toBeFocused();
        await page.getByLabel('Lọc hình thức').selectOption('');
        await page.getByLabel('Tìm lịch phỏng vấn').fill('khong ton tai');
        await expect(page.getByText('Không có lịch phù hợp với bộ lọc trong tháng này.')).toBeVisible();
        await page.getByLabel('Tìm lịch phỏng vấn').fill('');
        await page.getByLabel('Lọc trạng thái').selectOption('inactive');
        await grid.getByRole('button', { name: 'Phạm Gia Huy · Frontend Developer · 15:30' }).click();
        await expect(page.getByRole('dialog')).toContainText('Lịch này không còn hiệu lực');
        await expect(page.getByRole('button', { name: 'Tải lịch .ics' })).toBeDisabled();
        await page.keyboard.press('Escape');
        await page.getByLabel('Lọc trạng thái').selectOption('');

        await page.getByRole('button', { name: 'Danh sách', exact: true }).click();
        await expect(page.locator('.ic-list .ic-event-row')).toHaveCount(4);
        await page.getByRole('button', { name: 'Tháng sau', exact: true }).click();
        await expect(page.getByText('Chưa có lịch phỏng vấn trong tháng này.', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Hôm nay', exact: true }).click();
        await expect(page.locator('.ic-list .ic-event-row')).toHaveCount(4);
        await page.getByRole('button', { name: 'Tháng', exact: true }).click();
        await grid.getByRole('button', { name: 'Nguyễn Minh Anh · Frontend Developer · 09:30' }).click();
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Tải lịch .ics' }).click();
        const download = await downloadPromise;
        const icsPath = path.join(output, download.suggestedFilename());
        await download.saveAs(icsPath);
        const ics = await fs.readFile(icsPath, 'utf8');
        assert(ics.includes('BEGIN:VEVENT\r\n'), 'ICS must contain a calendar event');
        assert(ics.includes('DTSTART:20261006T023000Z'), 'ICS must preserve Vietnam wall-clock time');
        assert(ics.includes('DTEND:20261006T033000Z'), 'ICS must preserve duration');
        await page.screenshot({ path: path.join(output, 'employer-detail.png'), fullPage: true });
        await page.keyboard.press('Escape');

        // Create a new invitation: preview must not send, then one explicit POST.
        await page.getByRole('button', { name: 'Tạo lịch phỏng vấn', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: /Đỗ Quỳnh Chi/ }).click();
        await expect(page.getByLabel('Tên công ty *', { exact: true })).toHaveValue('Sao Khuê Digital');
        await page.getByLabel('Ngày phỏng vấn *', { exact: true }).fill('2026-10-20');
        await page.getByLabel('Giờ bắt đầu *', { exact: true }).fill('11:00');
        await page.getByLabel('Lời nhắn thêm cho ứng viên').fill('Chuẩn bị portfolio để cùng trao đổi.');
        await page.getByRole('button', { name: 'Xem trước thư mời phỏng vấn', exact: true }).click();
        await expect(page.getByRole('dialog')).toContainText('Thứ Ba, 20/10/2026 lúc 11:00');
        assert.equal(writes.length, 0, 'Preview must not send an invitation');
        await page.screenshot({ path: path.join(output, 'employer-create-preview.png'), fullPage: true });
        await page.getByRole('button', { name: 'Xác nhận gửi thư mời phỏng vấn', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        assert.equal(writes[0].id, 5);
        assert.equal(writes[0].body.interview.interviewDate, '2026-10-20');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(grid.getByRole('button', { name: 'Đỗ Quỳnh Chi · Frontend Developer · 11:00' })).toBeVisible();

        // Reschedule the existing invitation through the same production form.
        await grid.getByRole('button', { name: 'Nguyễn Minh Anh · Frontend Developer · 09:30' }).click();
        await page.getByRole('button', { name: 'Đổi lịch / gửi lại thư mời', exact: true }).click();
        await expect(page.getByLabel('Ngày phỏng vấn *', { exact: true })).toHaveValue('2026-10-06');
        await page.getByLabel('Ngày phỏng vấn *', { exact: true }).fill('2026-10-22');
        await page.getByRole('button', { name: 'Xem trước thư mời phỏng vấn', exact: true }).click();
        assert.equal(writes.length, 1);
        await page.getByRole('button', { name: 'Xác nhận gửi thư mời phỏng vấn', exact: true }).click();
        await expect.poll(() => writes.length).toBe(2);
        assert.equal(writes[1].id, 1);
        assert.equal(writes[1].body.interview.interviewDate, '2026-10-22');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(grid.locator('.ic-grid-event')).toHaveCount(5);

        // Actual network failure is distinguishable from an empty calendar.
        failCalendar = true;
        await page.getByRole('button', { name: 'Tháng sau', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Chưa tải được lịch phỏng vấn');
        failCalendar = false;
        await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await page.getByRole('button', { name: 'Hôm nay', exact: true }).click();
        await expect(grid.locator('.ic-grid-event')).toHaveCount(5);
        await page.setViewportSize({ width: 390, height: 844 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Recruiter mobile page must not overflow horizontally');
        await page.screenshot({ path: path.join(output, 'employer-mobile.png'), fullPage: true });

        const candidateRequestStart = requests.length;
        const candidate = await newPage({ width: 1440, height: 1000 });
        await candidate.goto(`${origin}/candidate/interviews`);
        await expect(candidate.locator('.ic-grid-event')).toHaveCount(5);
        await expect(candidate.getByRole('button', { name: 'Tạo lịch phỏng vấn', exact: true })).toHaveCount(0);
        await candidate.locator('#profileDropdown').click();
        await expect(candidate.locator('#public-profile-menu').getByRole('link', { name: 'Lịch phỏng vấn', exact: true })).toHaveAttribute('href', '/candidate/interviews');
        await candidate.keyboard.press('Escape');
        await candidate.screenshot({ path: path.join(output, 'candidate-desktop.png'), fullPage: true });
        await candidate.getByRole('table').getByRole('button', { name: 'Sao Khuê Digital · Frontend Developer · 09:30' }).click();
        await expect(candidate.getByRole('dialog')).toContainText('Để xác nhận tham gia hoặc đề xuất đổi lịch');
        await expect(candidate.getByRole('link', { name: 'Liên hệ HR', exact: true })).toHaveAttribute('href', /^mailto:hr@example.test\?subject=/);
        await expect(candidate.getByRole('button', { name: 'Đổi lịch / gửi lại thư mời', exact: true })).toHaveCount(0);
        await candidate.keyboard.press('Escape');
        await candidate.setViewportSize({ width: 390, height: 844 });
        await candidate.locator('.public-mobile-menu-toggle').click();
        await expect(candidate.getByRole('navigation', { name: 'Điều hướng di động' }).getByRole('link', { name: 'Lịch phỏng vấn', exact: true })).toHaveAttribute('href', '/candidate/interviews');
        await candidate.keyboard.press('Escape');
        assert(await candidate.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Candidate mobile page must not overflow horizontally');
        await candidate.screenshot({ path: path.join(output, 'candidate-mobile.png'), fullPage: true });
        await candidate.getByRole('table').getByRole('button', { name: 'Sao Khuê Digital · Frontend Developer · 09:30' }).click();
        await expect(candidate.getByRole('dialog')).toBeVisible();
        await candidate.evaluate(() => { localStorage.removeItem('token_user'); localStorage.removeItem('userData'); window.dispatchEvent(new Event('jobfind:session-ended')); });
        await expect(candidate.getByRole('dialog')).toHaveCount(0);
        await expect(candidate.getByText('Vui lòng đăng nhập để xem lịch phỏng vấn của bạn.')).toBeVisible();
        await expect(candidate.locator('.ic-grid-event')).toHaveCount(0);
        assert(requests.slice(candidateRequestStart).some(request => request.path === '/api/my-interviews'), 'Candidate must use self-scoped calendar API');
        assert(!requests.slice(candidateRequestStart).some(request => request.path.startsWith('/api/applications')), 'Candidate must not read recruiter APIs');
        assert.deepEqual(errors, []);
        console.log(`PASS: real shells in StrictMode, month/list/filters, details, ICS, create/reschedule preview, outage/retry, role-specific navigation, session clearing, desktop/mobile layout. Synthetic invitation POSTs: ${writes.length}. Screenshots: ${output}`);
    } catch (error) {
        if (activePage && !activePage.isClosed()) {
            await activePage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
            await fs.writeFile(path.join(output, 'failure.txt'), await activePage.locator('body').innerText()).catch(() => {});
        }
        throw error;
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => io.close(resolve));
        if (server.listening) await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
