// Real browser regression: production components/theme, synthetic API responses only.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');

(async () => {
    const root = path.resolve(__dirname, '../..');
    const output = path.join(root, '.local/recruiter-layout');
    await fs.mkdir(output, { recursive: true });
    const app = express();
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        await build({
            stdin: { contents: `
                import React from 'react'; import {createRoot} from 'react-dom/client';
                import {BrowserRouter} from 'react-router-dom';
                import HomeAdmin from './src/container/system/HomeAdmin';
                import SupportChat from './src/components/support/SupportChat';
                import SessionContext from './src/auth/SessionContext';
                import {ToastContainer, toast} from 'react-toastify';
                import './src/css/App.css'; import 'react-toastify/dist/ReactToastify.css';
                const user={id:8,companyId:42,roleCode:'EMPLOYER',companyStatusCode:'S1',companyCensorCode:'CS1',firstName:'Nhà',lastName:'Tuyển dụng',image:'/assetsAdmin/images/logo-mini.svg'};
                localStorage.setItem('userData',JSON.stringify(user));
                window.showTestToast=()=>toast.error('Thông báo kiểm tra vị trí');
                window.dismissTestToasts=()=>toast.dismiss();
                createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter basename='/admin'><SessionContext.Provider value={user}><HomeAdmin user={user}/><SupportChat/></SessionContext.Provider></BrowserRouter><ToastContainer className='jf-notifications' position='top-right' autoClose={false}/></React.StrictMode>);
            `, resolveDir: path.join(root, 'frontend'), loader: 'jsx' },
            bundle: true, outfile: path.join(output, 'app.js'),
            loader: { '.js': 'jsx', '.scss': 'empty', '.png': 'dataurl', '.jpg': 'dataurl' },
            define: { 'process.env.NODE_ENV': '"development"', 'process.env.REACT_APP_BACKEND_URL': JSON.stringify(origin) },
        });
        app.use('/assets', express.static(path.join(root, 'frontend/public/assets')));
        app.use('/assetsAdmin', express.static(path.join(root, 'frontend/public/assetsAdmin')));
        app.use('/app', express.static(output));
        app.use(express.json());
        app.all(/^\/api\//, (req, res) => {
            if (req.path === '/api/support/conversations') return res.json({ data: [] });
            if (req.path === '/api/support/turn') {
                const text = req.body.text === 'Trả lời dài' ? 'Nội dung hỗ trợ dài để kiểm tra cuộn.\n\n'.repeat(40) : 'Câu trả lời thử nghiệm';
                return res.type('text/event-stream').send(`event: token\ndata: ${JSON.stringify({ text })}\n\nevent: done\ndata: {}\n\n`);
            }
            if (req.path === '/api/get-statistical-post') return res.json({ errCode: 1, errMessage: 'Error from server' });
            if (req.path.includes('notification')) return res.json({ errCode: 0, data: [{ id: 1, content: 'Bạn có hồ sơ ứng tuyển mới', isChecked: 0 }], unreadCount: 1 });
            return res.json({ errCode: 0, data: [], count: 0, totalPost: 0 });
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
        const page = await browser.newPage({ viewport: { width: 1520, height: 740 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            window.layoutErrors = [];
            window.addEventListener('error', event => window.layoutErrors.push(event.message));
        });
        await page.goto(`${origin}/admin/`);
        const button = name => page.getByRole('button', { name, exact: true });
        await button('Mở chatbot hỗ trợ JobFind').click();
        const input = page.getByRole('textbox', { name: 'Đặt câu hỏi hỗ trợ', exact: true });
        for (let i = 0; i < 4; i++) {
            await input.fill('Nội dung nhiều dòng\n'.repeat(8));
            await button('Cuộc trò chuyện mới').click();
            assert.equal(await input.inputValue(), '');
        }
        await input.fill('Xin chào');
        await button('Gửi tin nhắn').click();
        await page.getByText('Câu trả lời thử nghiệm', { exact: true }).waitFor();
        await button('Cuộc trò chuyện mới').click();
        await page.getByRole('heading', { name: 'Bạn cần hỗ trợ gì?' }).waitFor();
        await button('Lịch sử trò chuyện').click();
        await page.getByRole('button', { name: /^Xin chào / }).click();
        await page.getByText('Câu trả lời thử nghiệm', { exact: true }).waitFor();
        await button('Cuộc trò chuyện mới').click();
        await input.fill('Trả lời dài');
        await button('Gửi tin nhắn').click();
        await button('Sửa câu hỏi').waitFor();
        const viewport = page.getByRole('log', { name: 'Nội dung trò chuyện' });
        await page.waitForTimeout(150);
        const heightBeforeScroll = (await viewport.boundingBox()).height;
        await viewport.evaluate(element => { element.scrollTop = 0; });
        await button('Đến tin nhắn mới nhất').waitFor();
        const heightAfterScroll = (await viewport.boundingBox()).height;
        assert.ok(Math.abs(heightAfterScroll - heightBeforeScroll) <= 1, 'Scroll control resizes its observed viewport');
        await button('Cuộc trò chuyện mới').click();
        await page.getByRole('heading', { name: 'Bạn cần hỗ trợ gì?' }).waitFor();
        assert.equal(await input.inputValue(), '');
        await page.evaluate(() => window.showTestToast());
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
        const geometry = await page.evaluate(() => {
            const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width }; };
            return { panel: rect('.main-panel'), sidebar: rect('.sidebar'), header: rect('.navbar'), toast: rect('.Toastify__toast-container'), viewport: innerWidth, errors: window.layoutErrors };
        });
        console.log(JSON.stringify(geometry));
        assert.ok(geometry.panel.right <= geometry.viewport + 1, 'Main panel overflows viewport');
        await page.evaluate(() => window.dismissTestToasts());
        await page.locator('.Toastify__toast').first().waitFor({ state: 'detached' });
        for (const size of [{ width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
            await page.setViewportSize(size);
            await button('Mở rộng chatbot').click();
            await input.fill('Nhiều dòng\n'.repeat(12));
            await button('Cuộc trò chuyện mới').click();
            await button('Thu nhỏ chatbot').click();
            const box = await page.getByRole('dialog').boundingBox();
            assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1, 'Chat outside viewport');
            await button('Đóng chatbot').click();
            if (size.width < 992) {
                const sidebar = await page.locator('.sidebar').boundingBox();
                assert.ok(sidebar.x >= size.width, 'Closed mobile sidebar remains visible');
                await button('Mở menu trên điện thoại').click();
                await page.waitForTimeout(300);
                const opened = await page.locator('.sidebar').boundingBox();
                assert.ok(opened.x >= 0 && opened.x + opened.width <= size.width + 1, 'Open mobile sidebar outside viewport');
                await button('Đóng menu trên điện thoại').click();
                await expect.poll(async () => (await page.locator('.sidebar').boundingBox()).x).toBeGreaterThanOrEqual(size.width);
            }
            await button('Thông báo').click();
            const notification = await page.locator('#system-notification-menu').boundingBox();
            assert.ok(notification.x >= 0 && notification.x + notification.width <= size.width, 'Notification menu outside viewport');
            await page.screenshot({ path: path.join(output, `notification-${size.width}.png`) });
            await button('Thông báo').click();
            await button('Mở chatbot hỗ trợ JobFind').click();
            await page.screenshot({ path: path.join(output, `chat-${size.width}.png`) });
        }
        await page.setViewportSize({ width: 1520, height: 740 });
        await button('Đóng chatbot').click();
        await button('Thu gọn thanh menu').click();
        await page.waitForTimeout(350);
        const collapsed = await page.locator('.main-panel').boundingBox();
        assert.ok(collapsed.x + collapsed.width <= 1521, 'Collapsed layout overflows');
        console.log('Browser errors:', await page.evaluate(() => window.layoutErrors));
        assert.deepEqual(await page.evaluate(() => window.layoutErrors), []);
        assert.deepEqual(errors, []);
        assert.ok(geometry.toast.y >= geometry.header.bottom, 'Toast covers header');
        console.log('PASS: new chat, history, send, resize, desktop/mobile layout and notification placement');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
