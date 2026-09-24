// Opt-in: one real model turn through the running UI/Gateway, then reload/delete.
// No mocked HTTP routes, existing account, or personal data is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from 'playwright/test';

const web = process.env.SUPPORT_EVAL_WEB || 'http://localhost:3001';
const output = fileURLToPath(new URL('../../.local/support-live-browser/', import.meta.url));
await fs.mkdir(output, { recursive: true });
const report = { at: new Date().toISOString(), realProvider: false, passed: false, turns: 0 };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
const owned = new Map();
const faults = [];
page.on('pageerror', () => faults.push('browser_error'));
page.on('response', response => {
    if (new URL(response.url()).pathname === '/api/support/turn' && response.request().method() === 'POST') {
        const request = response.request().postDataJSON();
        const guest = response.headers()['x-support-guest'];
        if (guest && request?.requestId) owned.set(request.requestId, { guest, origin: new URL(response.url()).origin });
    }
});
page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/support/turn' && request.method() === 'POST') report.turns++;
});
try {
    await page.goto(web);
    await page.getByRole('button', { name: 'Mở chatbot hỗ trợ JobFind', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Đặt câu hỏi hỗ trợ', exact: true });
    await expect(page.getByRole('button', { name: 'Gửi tin nhắn', exact: true })).toBeVisible();
    await input.fill('Làm thế nào lưu một việc làm yêu thích trên JobFind?');
    const started = Date.now();
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/support/turn' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
    const response = await pending;
    report.stage = 'stream';
    assert.equal(response.status(), 200);
    // The widget closes its SSE reader at the done event; Chromium cannot
    // reliably expose that closed streaming body's bytes through CDP.
    // Verify the completed persisted answer, not a second generated answer.
    await expect(page.getByRole('button', { name: 'Sao chép', exact: true })).toBeVisible({ timeout: 70000 });
    const request = response.request().postDataJSON();
    const guest = await page.evaluate(() => localStorage.getItem('jobfind-support-guest'));
    const origin = new URL(response.url()).origin;
    owned.set(request.requestId, { guest, origin });
    const saved = await context.request.get(`${origin}/api/support/conversations/${request.requestId}`, { headers: { 'X-Support-Guest': guest } });
    assert.equal(saved.status(), 200);
    const answer = (await saved.json()).data?.messages?.at(-1);
    assert.equal(answer?.status, 'complete');
    report.mode = answer.mode;
    assert.ok(['claude', 'openai', 'gemini', 'ollama'].includes(report.mode), 'A fallback does not prove a real provider call');
    report.realProvider = true;
    report.durationMs = Date.now() - started;
    const bubble = page.locator('.jf-support__message--assistant .jf-support__bubble').last();
    report.stage = 'answer';
    await expect(page.getByRole('button', { name: 'Sao chép', exact: true })).toBeVisible();
    report.answer = await bubble.innerText();
    assert.ok(report.answer.length > 40);
    await page.locator('.jf-support__panel').screenshot({ path: output + 'desktop.png' });
    await page.reload();
    report.stage = 'reload';
    const launcher = page.getByRole('button', { name: 'Mở chatbot hỗ trợ JobFind', exact: true });
    await launcher.click();
    await page.getByRole('button', { name: 'Lịch sử trò chuyện', exact: true }).click();
    await page.locator('.jf-support__thread-open').filter({ hasText: 'Làm thế nào lưu một việc làm' }).click();
    await expect(bubble).toHaveText(report.answer);
    assert.equal(report.turns, 1, 'Reload must restore the saved answer without another paid call');
    await page.setViewportSize({ width: 390, height: 844 });
    report.stage = 'mobile';
    assert.equal(await page.locator('.jf-support__panel').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
    }), true, 'Chat panel must fit a phone viewport');
    await page.locator('.jf-support__panel').screenshot({ path: output + 'mobile.png' });
    await page.getByRole('button', { name: 'Lịch sử trò chuyện', exact: true }).click();
    report.stage = 'delete';
    const removal = page.getByRole('button', { name: /^Xóa Làm thế nào/ });
    await removal.click();
    await expect(removal).toHaveCount(0);
    for (const [id, { guest, origin }] of owned) {
        const deleted = await context.request.get(`${origin}/api/support/conversations/${id}`, { headers: { 'X-Support-Guest': guest } });
        assert.equal(deleted.status(), 404);
    }
    assert.deepEqual(faults, []);
    report.passed = true;
} catch (error) {
    report.error = error.name === 'AssertionError' ? 'assertion_failed' : 'browser_check_failed';
    console.error('Check stage:', report.stage || 'start', error.name, error.message.slice(0, 300));
    await page.screenshot({ path: output + 'failure.png', fullPage: true }).catch(() => {});
    console.error('FAIL: live chat browser; inspect .local/support-live-browser/failure.png');
    process.exitCode = 1;
} finally {
    // Exact IDs and capabilities from this new browser context only; never delete user history.
    report.cleanup = true;
    for (const [id, { guest, origin }] of owned) {
        try {
            const result = await context.request.delete(`${origin}/api/support/conversations/${id}`, { headers: { 'X-Support-Guest': guest }, timeout: 10000 });
            if (![200, 204, 404].includes(result.status())) report.cleanup = false;
        } catch { report.cleanup = false; }
    }
    if (!report.cleanup) process.exitCode = 1;
    await fs.writeFile(output + 'validation.json', JSON.stringify(report, null, 2));
    await browser.close();
}
if (report.passed && report.cleanup) console.log('PASS: live chatbot, persisted answer after reload without a second call, desktop/mobile, and history deletion.');
