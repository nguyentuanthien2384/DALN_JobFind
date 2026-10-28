// GTranslate + React QA on the real frontend (npm start) with the real translator.
// API responses and the Socket.IO server are fixtures, so nothing is written to the
// database; only the page text is sent to Google Translate (needs Internet).
//
//   node backend/scripts/test-gtranslate-browser.cjs [--lang=en] [--only=chat,post]
//
// Each scenario runs untranslated (vi) as a control and translated. Besides page
// errors it counts what the guard in public/gtranslate-guard.js papers over:
// removeChild/insertBefore on nodes the translator moved, and React text updates
// written into text nodes the translator detached (the page keeps showing old text).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../../microservices/node_modules/playwright');

const base = process.env.JOB_TEST_WEB_URL || 'http://localhost:3000';
const arg = (name, fallback) => (process.argv.find(value => value.startsWith(`--${name}=`)) || '').split('=')[1] || fallback;
const targetLang = arg('lang', 'en');
const only = arg('only', 'chat,post').split(',');
const output = path.join(__dirname, '../../.local/gtranslate-qa');
const me = { id: 7, userId: 7, roleCode: 'EMPLOYER', firstName: 'Kiểm thử', lastName: 'Dịch trang', companyId: 1, companyStatusCode: 'S1', companyCensorCode: 'CS1' };
const partner = { id: 20, firstName: 'Ứng viên', lastName: 'Mẫu' };

// Runs before every page script, so it sits underneath the guard's prototype patches.
const instrument = () => {
    const stats = window.__gtQa = { removeMismatch: [], insertMismatch: [], staleWrites: [], errors: [] };
    const removed = new WeakSet();
    const sample = node => String((node && (node.nodeValue ?? node.textContent)) || '').trim().slice(0, 60);
    for (const [name, bucket, pick] of [['removeChild', 'removeMismatch', args => args[0]], ['insertBefore', 'insertMismatch', args => args[1]]]) {
        const original = Node.prototype[name];
        let installed = null;
        function counted(...args) {
            const node = pick(args);
            if (node && node.parentNode !== this) stats[bucket].push({ text: sample(node), parent: this.nodeName, nodeParent: node.parentNode?.nodeName || null });
            return installed.apply(this, args);
        }
        Object.defineProperty(Node.prototype, name, {
            configurable: true,
            get() { return installed ? counted : original; },
            set(fn) { installed = fn; },
        });
    }
    new MutationObserver(records => {
        for (const record of records) for (const node of record.removedNodes) if (node.nodeType === 3) removed.add(node);
    }).observe(document, { childList: true, subtree: true });
    // A write into a detached node is only a problem if the node is still detached once the
    // guard (which wraps these setters) has had its chance to put it back.
    for (const [proto, prop] of [[Node.prototype, 'nodeValue'], [CharacterData.prototype, 'data']]) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
        Object.defineProperty(proto, prop, {
            configurable: true,
            get: descriptor.get,
            set(value) {
                const node = this;
                const before = sample(node);
                const watched = node.nodeType === 3 && !node.isConnected && removed.has(node) && String(value) !== node.nodeValue;
                descriptor.set.call(node, value);
                if (watched) queueMicrotask(() => {
                    if (node.isConnected) stats.restored = (stats.restored || 0) + 1;
                    else stats.staleWrites.push({ from: before, to: String(value).slice(0, 60) });
                });
            },
        });
    }
    window.addEventListener('error', event => stats.errors.push(event.message));
};

const translated = page => page.waitForFunction(() => document.documentElement.classList.contains('translated-ltr')
    || document.documentElement.classList.contains('translated-rtl'), null, { timeout: 30000 });
const settle = page => page.waitForTimeout(3500);
const visibleText = (page, selector) => page.locator(selector).first().evaluate(element => element.innerText.replace(/\s+/g, ' ').trim());

const json = (route, data, delay = 0) => new Promise(resolve => setTimeout(resolve, delay)).then(() => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(data),
}));

// Minimal Engine.IO v4 / Socket.IO v5 server over Playwright's WebSocket route.
const socketServer = async (page, handlers) => {
    const server = { ws: null, offline: false, emit(event, data) { this.ws?.send(`42${JSON.stringify([event, data])}`); } };
    await page.routeWebSocket(url => url.pathname.startsWith('/socket.io'), ws => {
        if (server.offline) { ws.close(); return; }
        server.ws = ws;
        ws.send(`0${JSON.stringify({ sid: `e${Date.now()}`, upgrades: [], pingInterval: 25000, pingTimeout: 60000, maxPayload: 1e6 })}`);
        ws.onMessage(message => {
            message = String(message);
            if (message.startsWith('40')) return ws.send(`40${JSON.stringify({ sid: `n${Date.now()}` })}`);
            const packet = /^42(\d*)(\[.*)$/s.exec(message);
            if (!packet) return;
            const [event, data] = JSON.parse(packet[2]);
            const reply = handlers[event]?.(data);
            if (packet[1]) ws.send(`43${packet[1]}${JSON.stringify([reply ?? { errCode: 0 }])}`);
        });
    });
    await page.route('**/socket.io/**', route => route.abort());
    return server;
};

const openPage = async (browser, lang, apiHandler) => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'vi-VN' });
    await context.addInitScript(({ user, lang: language }) => {
        localStorage.setItem('userData', JSON.stringify(user));
        localStorage.setItem('token_user', 'gtranslate-qa-fixture');
        if (language !== 'vi') localStorage.setItem('__GT_TRANSLATE_LANGS', JSON.stringify({ srcLang: 'vi', tgtLang: language }));
    }, { user: me, lang });
    await context.addInitScript(instrument);
    const page = await context.newPage();
    const faults = [];
    page.on('pageerror', error => faults.push(error.message));
    // Only localhost API calls are fixtures; translator requests go to Google.
    await page.route(url => url.hostname === 'localhost' && url.pathname.startsWith('/api/'), async route => {
        const url = new URL(route.request().url());
        const data = await apiHandler(url, route.request());
        return json(route, data?.body ?? data, data?.delay || 0);
    });
    return { context, page, faults };
};

const readStats = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__gtQa)));
// True while the guard keeps text containing `needle` transparent (waiting for a translation).
const hiddenByGuard = (page, needle) => page.evaluate(text => {
    const pending = window.CSS?.highlights?.get('gt-pending');
    if (!pending) return document.documentElement.classList.contains('gt-guard-fallback-hide');
    for (const range of pending) if (range.startContainer.nodeValue?.includes(text)) return true;
    return false;
}, needle);

const chatScenario = async (browser, lang) => {
    const history = Array.from({ length: 6 }, (_, index) => ({
        id: index + 1, senderId: index % 2 ? 7 : 20, receiverId: index % 2 ? 20 : 7,
        content: `Tin nhắn cũ số ${index + 1}: hẹn phỏng vấn vào thứ hai.`, createdAt: new Date(Date.now() - (10 - index) * 60000).toISOString(), isRead: 1,
    }));
    let unread = 0;
    let nextId = 100;
    const { context, page, faults } = await openPage(browser, lang, url => {
        if (url.pathname === '/api/auth/me') return { errCode: 0, data: me };
        if (url.pathname === '/api/auth/providers') return { google: false };
        if (url.pathname === '/api/get-list-chat-conversation') return { errCode: 0, data: [{ partnerId: 20, partnerData: partner, lastMessage: history.at(-1), unreadCount: unread }] };
        if (url.pathname === '/api/get-chat-conversation') return { errCode: 0, data: history, partnerData: partner, conversationMeta: { richContent: false } };
        return { errCode: 0, data: [], count: 0 };
    });
    let online = false;
    const server = await socketServer(page, {
        'chat:presence': () => ({ errCode: 0, data: { online, lastSeenAt: new Date(Date.now() - 3600000).toISOString() } }),
        'chat:send': payload => {
            const message = { id: nextId++, senderId: 7, receiverId: 20, content: payload.content, createdAt: new Date().toISOString(), isRead: 0 };
            history.push(message);
            return { errCode: 0, data: message };
        },
    });
    try {
        await page.goto(`${base}/admin/chat/20`);
        await page.getByRole('textbox', { name: /Nội dung tin nhắn|message/i }).waitFor();
        if (lang !== 'vi') await translated(page);
        await settle(page);
        const header = '.chat-main > div:first-child';
        const before = await visibleText(page, header);

        // 1. Partner typing indicator appears at once, then disappears after 4.5 s.
        server.emit('chat:typing', { fromUserId: 20 });
        await page.waitForTimeout(500);
        const typingHidden = await hiddenByGuard(page, 'soạn tin nhắn');
        await page.waitForTimeout(1500);
        const typing = await visibleText(page, header);
        await page.waitForTimeout(5000);
        const afterTyping = await visibleText(page, header);

        // 2. Incoming realtime message, then an outgoing one; order must be kept.
        const incoming = { id: 50, senderId: 20, receiverId: 7, content: 'QA-0001 Xin chào, tôi muốn hỏi về lịch phỏng vấn.', createdAt: new Date().toISOString(), isRead: 0 };
        history.push(incoming);
        unread = 1;
        server.emit('chat:new-message', incoming);
        await page.waitForTimeout(800);
        const incomingHidden = await hiddenByGuard(page, 'QA-0001');
        const box = page.getByRole('textbox', { name: /Nội dung tin nhắn|message/i });
        await box.fill('QA-0002 Cảm ơn bạn, tôi sẽ phản hồi sớm.');
        await box.press('Enter');
        await page.waitForTimeout(1500);
        const sendButton = await page.locator('.chat-composer-row button').innerText();

        // 3. Transport drops (periodic reload mode) and recovers with the partner online.
        server.offline = true;
        server.ws?.close();
        await page.waitForTimeout(4000);
        const offline = await visibleText(page, header);
        online = true;
        server.offline = false;
        // socket.io-client backs off up to 30 s (randomized) between attempts.
        await page.locator('main[data-realtime="connected"]').waitFor({ timeout: 45000 });
        await page.waitForTimeout(2000);
        const recovered = await visibleText(page, header);
        await settle(page);

        const bubbles = await page.locator('[role="log"] .chat-message-text').allInnerTexts();
        const tail = bubbles.slice(-2).map(text => text.slice(0, 7));
        const stats = await readStats(page);
        await page.screenshot({ path: path.join(output, `chat-${lang}.png`) });
        const partnerName = await page.locator('.chat-main > div:first-child b').innerText();
        return { lang, faults, stats, before, typing, typingHidden, incomingHidden, afterTyping, offline, recovered, partnerName,
            sendButton: sendButton.trim(), tail, bubbleCount: bubbles.length };
    } finally {
        await context.close();
    }
};

const postScenario = async (browser, lang) => {
    const { context, page, faults } = await openPage(browser, lang, url => {
        if (url.pathname === '/api/auth/me') return { errCode: 0, data: me };
        if (url.pathname === '/api/auth/providers') return { google: false };
        // Slow network: the quota arrives after the translator already finished.
        if (url.pathname === '/api/get-detail-company-by-userId') return { delay: lang === 'vi' ? 0 : 6000, body: { errCode: 0, data: { id: 1, name: 'Công ty Kiểm thử', allowPost: 7, allowHotPost: 3 } } };
        return { errCode: 0, data: [], count: 0 };
    });
    await socketServer(page, {});
    try {
        await page.goto(`${base}/admin/add-post/`);
        await page.locator('form.form-sample').waitFor();
        if (lang !== 'vi') await translated(page);
        await page.waitForTimeout(lang === 'vi' ? 1500 : 9000);
        await settle(page);
        const quota = await visibleText(page, '.card-body .mb-5');
        const stats = await readStats(page);
        await page.screenshot({ path: path.join(output, `post-${lang}.png`) });
        return { lang, faults, stats, quota };
    } catch (error) {
        await page.screenshot({ path: path.join(output, `post-${lang}-failed.png`) }).catch(() => {});
        error.message += `\npage errors: ${faults.join(' | ') || 'none'}`;
        throw error;
    } finally {
        await context.close();
    }
};

const summarize = result => ({
    ...result,
    stats: {
        removeMismatch: result.stats.removeMismatch.length,
        insertMismatch: result.stats.insertMismatch.length,
        restored: result.stats.restored || 0,
        staleWrites: result.stats.staleWrites,
        errors: result.stats.errors,
    },
});

(async () => {
    await fs.mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const report = {};
    try {
        for (const [name, scenario] of [['chat', chatScenario], ['post', postScenario]]) {
            if (!only.includes(name)) continue;
            report[name] = {};
            for (const lang of ['vi', targetLang]) report[name][lang] = summarize(await scenario(browser, lang));
        }
    } finally {
        await browser.close();
    }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));

    const problems = [];
    for (const [name, byLang] of Object.entries(report)) {
        for (const result of Object.values(byLang)) {
            if (result.faults.length || result.stats.errors.length) problems.push(`${name}/${result.lang}: page errors ${[...result.faults, ...result.stats.errors].join(' | ')}`);
            if (result.stats.staleWrites.length) problems.push(`${name}/${result.lang}: ${result.stats.staleWrites.length} React text updates hidden by the translator`);
        }
    }
    if (report.chat) {
        for (const result of Object.values(report.chat)) {
            if (result.tail.join() !== 'QA-0001,QA-0002') problems.push(`chat/${result.lang}: message order ${result.tail.join()}`);
            if (/soạn|compos|typing/i.test(result.afterTyping)) problems.push(`chat/${result.lang}: typing indicator stayed: ${result.afterTyping}`);
            if (/định kỳ|periodic|reload/i.test(result.recovered)) problems.push(`chat/${result.lang}: offline text stayed after reconnect: ${result.recovered}`);
            if (/Đang gửi|Sending/i.test(result.sendButton)) problems.push(`chat/${result.lang}: send button stuck: ${result.sendButton}`);
            if (result.partnerName.trim() !== `${partner.firstName} ${partner.lastName}`) problems.push(`chat/${result.lang}: partner name shows "${result.partnerName}"`);
            if (result.typingHidden) problems.push(`chat/${result.lang}: typing indicator hidden while waiting for a translation`);
            if (result.incomingHidden) problems.push(`chat/${result.lang}: incoming message hidden while waiting for a translation`);
        }
    }
    if (report.post) {
        for (const result of Object.values(report.post)) {
            if (!/\b7\b/.test(result.quota) || !/\b3\b/.test(result.quota)) problems.push(`post/${result.lang}: quota shows "${result.quota}" instead of 7/3`);
        }
    }
    if (problems.length) {
        console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
        process.exitCode = 1;
    } else {
        console.log('\nGTranslate QA passed');
    }
    assert.ok(Object.keys(report).length, 'no scenario selected');
})().catch(error => { console.error(error); process.exitCode = 1; });
