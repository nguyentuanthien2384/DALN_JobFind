const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { build } = require('esbuild');
const { chromium } = require('@playwright/test');

// Real assistant-ui/React in Chromium; deterministic local SSE provider, no AI quota.
(async () => {
    const root = path.resolve(__dirname, '../..');
    const output = path.join(root, '.local/support-chat-browser');
    await fs.mkdir(output, { recursive: true });
    const requests = [];
    let aborted = false;
    const server = http.createServer(async (req, res) => {
        if (req.url === '/api/support-chat') {
            let body = '';
            for await (const chunk of req) body += chunk;
            const data = JSON.parse(body);
            requests.push(data);
            const question = data.messages.at(-1).text;
            if (question === 'error') { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ errMessage: 'AI thử nghiệm đang bận' })); return; }
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            if (question === 'slow') {
                res.write('event: token\ndata: {"text":"Đang trả lời"}\n\n');
                req.socket.once('close', () => { aborted = true; });
                return;
            }
            if (question === 'partial-error') {
                res.end('event: token\ndata: {"text":"Nội dung chưa hoàn chỉnh"}\n\nevent: error\ndata: {"message":"AI bị ngắt kết nối"}\n\n');
                return;
            }
            res.write('event: tool\ndata: {"name":"search_jobs","jobs":[{"id":42,"name":"Frontend React","company":"JobFind Demo","location":"Hà Nội","salary":"Thỏa thuận"}]}\n\n');
            res.write('event: token\ndata: {"text":"**Kết quả** cho "}\n\n');
            setTimeout(() => { if (!res.destroyed) res.end(`event: token\ndata: ${JSON.stringify({ text: question + '\n\n[Xem tin](/detail-job/42)' })}\n\nevent: done\ndata: {}\n\n`); }, 100);
            return;
        }
        if (req.url === '/app.js' || req.url === '/app.css') {
            res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
            res.end(await fs.readFile(path.join(output, req.url.slice(1)))); return;
        }
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>JobFind assistant test</title><div id="root"></div><script src="/app.js"></script></html>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {BrowserRouter} from 'react-router-dom'; import SupportChat from './src/components/support/SupportChat'; createRoot(document.getElementById('root')).render(<BrowserRouter><SupportChat/></BrowserRouter>);`, resolveDir: path.join(root, 'frontend'), loader: 'jsx' }, bundle: true, outfile: path.join(output, 'app.js'), loader: { '.js': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"', 'process.env.REACT_APP_BACKEND_URL': JSON.stringify(origin) } });
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin);
        const button = (name) => page.getByRole('button', { name, exact: true });
        await button('Mở chatbot hỗ trợ JobFind').click();
        await page.screenshot({ path: path.join(output, 'welcome.png') });
        const input = page.getByRole('textbox', { name: 'Đặt câu hỏi hỗ trợ' });
        const send = async (text) => { await input.fill(text); await button('Gửi tin nhắn').click(); };
        await send('Tìm việc React');
        await page.getByRole('link', { name: 'Xem tin', exact: true }).waitFor();
        assert.equal(await page.locator('.jf-support__markdown strong').innerText(), 'Kết quả');
        assert.equal(await page.locator('.jf-support__result').getAttribute('href'), '/detail-job/42');
        await button('Tạo lại').click();
        await button('Sửa câu hỏi').waitFor();
        await button('Sửa câu hỏi').click();
        await page.getByLabel('Sửa câu hỏi và tạo câu trả lời mới').fill('Tìm việc Java');
        await button('Gửi lại').click();
        await page.locator('.jf-support__markdown').filter({ hasText: 'Tìm việc Java' }).waitFor();
        assert.equal(requests.at(-1).messages.length, 1);
        await button('Mở rộng chatbot').click();
        await page.screenshot({ path: path.join(output, 'conversation.png') });
        await send('partial-error');
        await page.getByText('Phản hồi bị gián đoạn · cần thử lại').waitFor();
        await page.getByText('Nội dung chưa hoàn chỉnh', { exact: true }).waitFor();
        await send('slow');
        await page.getByText('Đang trả lời', { exact: true }).waitFor();
        await button('Dừng trả lời').click();
        await page.getByText('Đã dừng · câu trả lời chưa hoàn chỉnh').waitFor();
        await send('error');
        await page.getByRole('alert').filter({ hasText: 'AI thử nghiệm đang bận' }).waitFor();
        await button('Thử lại').click();
        await button('Gửi tin nhắn').waitFor();
        assert.equal(requests.at(-1).messages.at(-1).text, 'error');
        assert.ok(!requests.at(-1).messages.some((message) => message.text === 'Đang trả lời'));
        assert.ok(!requests.at(-1).messages.some((message) => message.text === 'Nội dung chưa hoàn chỉnh'));
        await button('Cuộc trò chuyện mới').click();
        await page.getByText('Bạn cần hỗ trợ gì?').waitFor();
        await button('Lịch sử trò chuyện').click();
        await page.getByRole('button', { name: /Tìm việc Java/ }).first().click();
        await page.locator('.jf-support__markdown').filter({ hasText: 'Tìm việc Java' }).waitFor();
        await page.getByText('Phản hồi bị gián đoạn · cần thử lại').waitFor();
        await page.reload();
        await button('Mở chatbot hỗ trợ JobFind').click();
        await page.locator('.jf-support__markdown').filter({ hasText: 'Tìm việc Java' }).waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(output, 'mobile.png') });
        const box = await page.getByRole('dialog').boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= 390);
        assert.ok(aborted, 'Stopping must close the upstream stream');
        assert.deepEqual(errors, []);
        console.log('PASS: assistant-ui send, SSE, Markdown, cards, regenerate, edit, stop, retry, history, reload and mobile layout.');
    } finally {
        await browser?.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
