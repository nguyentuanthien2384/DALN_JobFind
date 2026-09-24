// Real frontend and styles; every API response and socket is isolated from user data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../../microservices/node_modules/playwright');
const base = process.env.JOB_TEST_WEB_URL || 'http://localhost:3001';
const output = path.join(__dirname, '../../.local/spacing/chat');
const partner = { id: 20, firstName: 'Nhân viên', lastName: 'Hỗ trợ' };
const viewports = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }];

(async () => {
    await fs.mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const measurements = [];
    try {
        for (const roleCode of ['ADMIN', 'CANDIDATE']) {
            for (const viewport of viewports) {
                const user = { id: 7, userId: 7, roleCode, firstName: 'Kiểm thử', lastName: 'Bố cục' };
                const context = await browser.newContext({ viewport });
                await context.addInitScript(value => {
                    localStorage.setItem('userData', JSON.stringify(value));
                    localStorage.setItem('token_user', 'chat-layout-fixture');
                    window.layoutErrors = [];
                    window.addEventListener('error', event => window.layoutErrors.push(event.message));
                }, user);
                const page = await context.newPage();
                const faults = [];
                page.on('pageerror', error => faults.push(error.message));
                await page.routeWebSocket(url => url.pathname.startsWith('/socket.io'), socket => socket.close());
                await page.route('**/socket.io/**', route => route.abort());
                const messages = Array.from({ length: 35 }, (_, index) => ({
                    id: index + 1, senderId: index % 2 ? 7 : 20, receiverId: index % 2 ? 20 : 7,
                    content: `Tin nhắn kiểm thử ${index + 1}: Nội dung dài để kiểm tra cuộn trong hội thoại.`,
                    createdAt: '2026-09-24T07:00:00Z', isRead: 1,
                }));
                await page.route('**/api/**', async route => {
                    const url = new URL(route.request().url());
                    let data = { errCode: 0, data: [], count: 0 };
                    if (url.pathname === '/api/auth/me') data = { errCode: 0, data: user };
                    if (url.pathname === '/api/auth/providers') data = { google: false };
                    if (url.pathname === '/api/get-list-chat-conversation') data = {
                        errCode: 0, data: [{ partnerId: 20, partnerData: partner, lastMessage: messages.at(-1), unreadCount: 0 }],
                    };
                    if (url.pathname === '/api/get-chat-conversation') data = {
                        errCode: 0, data: messages, partnerData: partner, conversationMeta: { richContent: true },
                    };
                    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
                });
                const chatPath = roleCode === 'ADMIN' ? '/admin/chat' : '/chat';
                await page.goto(base + chatPath + '/20');
                await page.getByRole('textbox', { name: 'Nội dung tin nhắn' }).waitFor();
                await page.getByRole('log').getByText(messages.at(-1).content, { exact: true }).waitFor();
                // Allow deferred history scrolling and observer/font layout to settle.
                await page.waitForFunction(() => {
                    const log = document.querySelector('[role="log"]');
                    return log && log.scrollTop > 0 && window.scrollY === 0;
                });
                const metrics = await page.evaluate(() => {
                    const rect = selector => {
                        const { top, bottom, height } = document.querySelector(selector).getBoundingClientRect();
                        return { top, bottom, height };
                    };
                    const log = document.querySelector('[role="log"]');
                    return {
                        viewport: innerHeight, width: innerWidth, documentWidth: document.documentElement.scrollWidth,
                        documentHeight: document.documentElement.scrollHeight, scrollY,
                        container: rect('.chat-page-container'), composer: rect('.chat-composer'),
                        header: rect(document.querySelector('.jf-admin') ? '.navbar' : 'header'),
                        title: rect('.chat-page-container > h4'), historyHeight: log.clientHeight,
                        historyScrollHeight: log.scrollHeight, historyScrollTop: log.scrollTop,
                        errors: window.layoutErrors,
                    };
                });
                await page.screenshot({ path: path.join(output, `${roleCode}-${viewport.width}.png`), fullPage: false });
                await fs.writeFile(path.join(output, `${roleCode}-${viewport.width}.json`), JSON.stringify(metrics, null, 2));
                assert.ok(metrics.documentWidth <= viewport.width + 1, 'No horizontal overflow');
                assert.equal(metrics.scrollY, 0, 'Loading history must not scroll the whole page');
                assert.ok(metrics.composer.bottom <= viewport.height + 1, 'Composer visible without page scroll');
                assert.ok(metrics.historyHeight >= 120, 'History keeps usable space');
                assert.ok(metrics.historyScrollHeight > metrics.historyHeight, 'Long history scrolls internally');
                assert.ok(metrics.title.top - metrics.header.bottom <= 30, 'No obsolete header spacer');
                if (roleCode === 'ADMIN') assert.ok(metrics.documentHeight <= viewport.height + 1, 'Admin chat fits viewport');
                assert.deepEqual(metrics.errors, [], 'No browser error events (including ResizeObserver loops)');
                measurements.push({ roleCode, viewport, ...metrics });
                if (viewport.width < 768) {
                    await page.locator('.chat-back-btn').click();
                    await page.waitForURL(base + chatPath);
                    await page.locator('.chat-main').waitFor({ state: 'hidden' });
                    assert.equal(await page.locator('.chat-main').isVisible(), false, 'Mobile shows one pane at a time');
                    await page.getByRole('link', { name: /Nhân viên Hỗ trợ/ }).click();
                    await page.getByRole('textbox', { name: 'Nội dung tin nhắn' }).waitFor();
                }
                // Resize the same mounted page; the composer must stay in view.
                await page.setViewportSize({ width: viewport.width, height: viewport.height - 80 });
                await page.waitForFunction(() => document.querySelector('.chat-composer').getBoundingClientRect().bottom <= innerHeight + 1);
                assert.deepEqual(await page.evaluate(() => window.layoutErrors), []);
                assert.deepEqual(faults, []);
                console.log(`PASS ${roleCode} ${viewport.width}x${viewport.height}: compact title, visible composer, contained history, responsive resize`);
                await context.close();
            }
        }
        await fs.writeFile(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
