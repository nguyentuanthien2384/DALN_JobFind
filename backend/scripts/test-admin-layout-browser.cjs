/* Layout-only acceptance using synthetic browser fixtures. No backend records
 * or real messages are created, and realtime connections are intercepted. */
const assert = require('node:assert/strict');
const { chromium } = require('../../microservices/node_modules/playwright/test');

const origin = process.env.E2E_WEB_URL || 'http://localhost:3001';
const routes = ['/admin/list-job-type', '/admin/add-job-type', '/admin/support', '/admin/chat'];
const viewports = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }];

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        await context.routeWebSocket('**/*', socket => socket.close());
        await context.addInitScript(() => {
            localStorage.setItem('userData', JSON.stringify({ id: 99999, roleCode: 'ADMIN', firstName: 'Layout', lastName: 'Fixture' }));
            localStorage.setItem('token_user', 'synthetic-layout-only');
            window.layoutErrors = [];
            window.addEventListener('error', event => window.layoutErrors.push(event.message));
        });
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith('/api/')) return route.fulfill({
                status: 200, contentType: 'application/json', body: JSON.stringify(url.pathname === '/api/auth/me'
                    ? { errCode: 0, data: { userId: 99999, roleCode: 'ADMIN', companyId: null } }
                    : { errCode: 0, data: [], count: 0, unreadCount: 0 }),
            });
            if (url.pathname.startsWith('/socket.io')) return route.abort();
            return url.origin === new URL(origin).origin ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        const measurements = [];
        for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            for (const path of routes) {
                await page.goto(origin + path);
                await page.locator('.content-wrapper > *').waitFor();
                await page.waitForTimeout(350);
                const dimensions = await page.evaluate(() => {
                    const content = document.querySelector('.content-wrapper');
                    const child = content.firstElementChild;
                    return {
                        width: document.documentElement.scrollWidth,
                        height: document.documentElement.scrollHeight,
                        viewportHeight: innerHeight,
                        contentTop: child.getBoundingClientRect().top,
                        footerHeight: document.querySelector('.main-panel > .footer').getBoundingClientRect().height,
                        errors: window.layoutErrors,
                    };
                });
                assert.ok(dimensions.width <= viewport.width + 1, `${path}: horizontal overflow at ${viewport.width}px`);
                assert.ok(dimensions.contentTop <= 84, `${path}: redundant space above content`);
                assert.ok(dimensions.footerHeight <= 75, `${path}: stacked footer padding`);
                if (path === '/admin/list-job-type' || path === '/admin/chat') {
                    assert.ok(dimensions.height <= viewport.height + 1, `${path}: empty page stretched to ${dimensions.height}px at ${viewport.width}x${viewport.height}`);
                }
                assert.deepEqual(dimensions.errors, [], `${path}: browser runtime error`);
                measurements.push({ path, viewport, pageHeight: dimensions.height });
            }
        }

        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto(origin + '/admin/list-job-type');
        const sidebar = page.locator('.jf-admin .sidebar');
        const lastGroup = sidebar.locator(':scope > .nav > .nav-item').last();
        await lastGroup.locator(':scope > .nav-link').scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => scrollY), 0, 'Scrolling the long sidebar must not move the content page');
        assert.ok(await sidebar.evaluate(element => element.scrollTop > 0), 'Last navigation group must remain reachable');

        await page.getByRole('button', { name: 'Thu gọn thanh menu', exact: true }).click();
        await page.waitForTimeout(300);
        assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'Compact menu must not stretch empty pages');
        await lastGroup.locator(':scope > .nav-link').scrollIntoViewIfNeeded();
        await lastGroup.hover();
        const flyout = lastGroup.locator(':scope > .jf-submenu');
        await flyout.waitFor({ state: 'visible' });
        assert.equal(await lastGroup.locator('.menu-title').evaluate(element => getComputedStyle(element).color), 'rgb(255, 255, 255)', 'Collapsed title retains readable contrast on hover');
        const assertFlyoutVisible = async () => {
            const box = await flyout.boundingBox();
            assert.ok(box && box.x >= 69 && box.y >= 60 && box.y + box.height <= page.viewportSize().height, 'Compact flyout must fit outside the sidebar scrollport');
            assert.ok(await flyout.locator('a').first().isVisible(), 'Submenu links must not be clipped');
            assert.ok(await flyout.locator('a').first().evaluate(element => {
                const bounds = element.getBoundingClientRect();
                return element.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
            }), 'Submenu links must be clickable outside the scrollport');
        };
        await assertFlyoutVisible();
        await page.mouse.move(500, 80);
        await lastGroup.locator(':scope > .nav-link').focus();
        await assertFlyoutVisible();
        await page.keyboard.press('Tab');
        assert.ok(await flyout.evaluate(element => element.contains(document.activeElement)), 'Keyboard must reach submenu links');
        await page.setViewportSize({ width: 1280, height: 500 });
        await page.waitForFunction(() => {
            const menu = document.querySelector('.jf-submenu:focus-within');
            return menu && menu.getBoundingClientRect().bottom <= innerHeight;
        });
        await assertFlyoutVisible();
        await page.setViewportSize({ width: 1280, height: 720 });
        await sidebar.evaluate(element => { element.scrollTop = 0; });
        await assertFlyoutVisible();

        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole('button', { name: 'Mở menu trên điện thoại', exact: true }).click();
        await page.waitForTimeout(300);
        const mobileMenu = await sidebar.boundingBox();
        assert.ok(mobileMenu && mobileMenu.x >= 0 && mobileMenu.x + mobileMenu.width <= 391, 'Mobile menu must fit on screen');
        await lastGroup.locator(':scope > .nav-link').scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => scrollY), 0);
        assert.deepEqual(await page.evaluate(() => window.layoutErrors), []);
        console.log(JSON.stringify({ status: 'passed', pages: measurements.length, measurements, navigation: ['desktop scroll', 'compact hover', 'compact keyboard', 'compact scroll anchor', 'mobile menu'] }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
