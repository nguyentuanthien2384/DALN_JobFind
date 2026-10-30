// public/gtranslate-guard.js keeps React and the GTranslate page translator in sync.
// engineReplace() repeats what GTranslate's lib.min.js does to a text node: insert a
// <font> before it, cloneNode() it into the font with the translation, remove the original.
const fs = require('fs');
const path = require('path');

const guardSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'gtranslate-guard.js'), 'utf8');
const translateUrl = 'https://translate-pa.googleapis.com/v1/translateHtml';
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const text = value => document.createTextNode(value);
const element = (tag, ...children) => {
    const node = document.createElement(tag);
    node.append(...children);
    return node;
};

const engineReplace = (original, translation) => {
    const outer = document.createElement('font');
    original.parentNode.insertBefore(outer, original);
    const inner = document.createElement('font');
    outer.appendChild(inner);
    const clone = original.cloneNode(false);
    inner.appendChild(clone);
    clone.textContent = translation;
    original.parentNode.removeChild(original);
    return clone;
};

const sendForTranslation = (...sources) => {
    const request = new XMLHttpRequest();
    request.open('POST', translateUrl);
    request.send(JSON.stringify([[sources, 'vi', 'en'], 'te_lib']));
};

let sentBodies;
let reload;

beforeAll(() => {
    // The guard wraps whatever XHR it finds; give it a transport that never leaves the test.
    sentBodies = [];
    window.XMLHttpRequest.prototype.send = function send(body) { sentBodies.push(body); };
    if (!window.Range.prototype.getBoundingClientRect) {
        window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
    }
    reload = jest.fn();
    delete window.location;
    window.location = { reload };
    localStorage.setItem('__GT_TRANSLATE_LANGS', JSON.stringify({ srcLang: 'vi', tgtLang: 'en' }));
    // eslint-disable-next-line no-new-func
    new Function(guardSource)();
});

beforeEach(async () => {
    document.body.innerHTML = '';
    // Let the guard's 150 ms tick forget text nodes removed with the previous test's DOM.
    await new Promise(resolve => setTimeout(resolve, 400));
});

describe('React text updates after translation', () => {
    test('a number React updates replaces the stale translation (quota "0 bài" -> "7 bài")', async () => {
        const count = text('0');
        const label = text(' bài bình thường');
        const paragraph = element('p', count, label);
        document.body.append(paragraph);
        engineReplace(count, '0 ');
        engineReplace(label, 'normal posts');
        await flush();
        expect(paragraph.textContent).toBe('0 normal posts');

        count.nodeValue = '7';

        expect(count.parentNode).toBe(paragraph);
        expect(paragraph.textContent).toBe('7 normal posts');
        // Only the translation of the label is left.
        expect(paragraph.querySelectorAll(':scope > font')).toHaveLength(1);
    });

    test('a label React changes is shown instead of the old translation, also through data', async () => {
        const label = text('Gửi');
        const button = element('button', element('i'), label);
        document.body.append(button);
        engineReplace(label, 'Send');
        await flush();

        label.nodeValue = 'Đang gửi…';
        expect(button.textContent).toBe('Đang gửi…');
        expect(button.querySelector('font')).toBeNull();

        engineReplace(label, 'Sending…');
        await flush();
        label.data = 'Gửi';
        expect(button.textContent).toBe('Gửi');
        expect(label.parentNode).toBe(button);
    });
});

describe('React DOM operations on replaced nodes', () => {
    test('removing a translated node removes its translation instead of leaving ghost text', async () => {
        const loading = text('Đang tải...');
        const status = element('div', loading);
        document.body.append(status);
        engineReplace(loading, 'Loading...');
        await flush();

        expect(() => status.removeChild(loading)).not.toThrow();
        expect(status.textContent).toBe('');
        expect(status.childNodes).toHaveLength(0);
    });

    test('inserting before a translated node keeps the on-screen order', async () => {
        const first = text('Một ');
        const second = text('Hai');
        const line = element('p', first, second);
        document.body.append(line);
        engineReplace(second, 'Two');
        await flush();

        line.insertBefore(text('[mới] '), second);

        expect(line.textContent).toBe('Một [mới] Two');
    });

    test('nodes another translator moved into <font> can still be removed and used as anchors', () => {
        const moved = text('Xin chào');
        const other = text('Tạm biệt');
        const paragraph = element('p', moved, other);
        document.body.append(paragraph);
        const wrapper = document.createElement('font');
        paragraph.insertBefore(wrapper, other);
        wrapper.appendChild(other);

        paragraph.insertBefore(text('|'), other);
        expect(paragraph.textContent).toBe('Xin chào|Tạm biệt');
        expect(() => paragraph.removeChild(other)).not.toThrow();
        expect(paragraph.textContent).toBe('Xin chào|');
        expect(paragraph.removeChild(text('detached'))).toBeTruthy();
    });

    test('a React removal of a node the translator cloned but never replaced also drops the clone', async () => {
        const label = text('Mới');
        const cell = element('span', label);
        document.body.append(cell);
        const copy = label.cloneNode(false);
        const extra = element('font', copy);
        cell.append(extra);
        await flush();

        cell.removeChild(label);

        expect(cell.textContent).toBe('');
        expect(extra.isConnected).toBe(false);
    });
});

describe('translations that arrive after React changed the text', () => {
    test('the old translation is undone so the current text stays visible', async () => {
        sendForTranslation('Người dùng', 'Chế độ <a i=0>tải</a> lại &amp; chờ');
        expect(sentBodies).toHaveLength(1);
        const name = text('Người dùng');
        const header = element('b', name);
        document.body.append(header);

        name.nodeValue = 'Ứng viên Mẫu';
        engineReplace(name, 'User');
        await flush();

        expect(name.parentNode).toBe(header);
        expect(header.textContent).toBe('Ứng viên Mẫu');
    });

    test('a translation of the text that was sent is kept (inline markup and entities ignored)', async () => {
        sendForTranslation('Chế độ <a i=0>tải</a> lại &amp; chờ');
        const status = text('Chế độ tải lại & chờ');
        const line = element('div', status);
        document.body.append(line);

        engineReplace(status, 'Reload mode & wait');
        await flush();

        expect(line.textContent).toBe('Reload mode & wait');
    });

    test('gives up after two corrections so a node is never retranslated forever', async () => {
        sendForTranslation('Nội dung khác');
        const value = text('Không khớp');
        const box = element('div', value);
        document.body.append(box);
        for (let round = 0; round < 2; round += 1) {
            engineReplace(value, 'Mismatch');
            await flush();
            expect(box.textContent).toBe('Không khớp');
        }
        engineReplace(value, 'Mismatch');
        await flush();
        expect(box.textContent).toBe('Mismatch');
    });
});

describe('hiding text that waits for a translation', () => {
    const hidden = () => document.documentElement.classList.contains('gt-guard-fallback-hide');

    test('live regions (status, alert, chat log) are never hidden; ordinary text is', async () => {
        document.body.append(
            element('div', text('Đang soạn tin nhắn...')),
        );
        document.body.lastChild.setAttribute('role', 'status');
        const log = element('div', element('p', text('Tin nhắn mới đến')));
        log.setAttribute('role', 'log');
        const alert = element('p', text('Vui lòng nhập tên bài đăng'));
        alert.setAttribute('role', 'alert');
        const own = element('b', text('Nguyễn Văn Thử'));
        own.setAttribute('translate', 'no');
        document.body.append(log, alert, own);
        await flush();
        expect(hidden()).toBe(false);

        document.body.append(element('p', text('Tạo mới bài đăng')));
        await flush();
        expect(hidden()).toBe(true);
    });
});

describe('in-place language switching without page reload', () => {
    const engineRestore = (original, outerFont, savedOriginalText) => {
        if (!outerFont.parentNode) return;
        const parent = outerFont.parentNode;
        while (outerFont.firstChild) outerFont.removeChild(outerFont.firstChild);
        outerFont.appendChild(original);
        original.nodeValue = savedOriginalText;
        while (outerFont.firstChild) parent.insertBefore(outerFont.firstChild, outerFont);
        parent.removeChild(outerFont);
    };

    const clickLang = lang => {
        const wrapper = element('div');
        wrapper.className = 'gtranslate_wrapper';
        const link = element('a');
        link.setAttribute('data-gt-lang', lang);
        wrapper.appendChild(link);
        document.body.appendChild(wrapper);
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    };

    test('switches between languages (en -> az -> vi -> en) in place without reloading', async () => {
        reload.mockClear();
        const heading = text('Kết nối việc làm phù hợp');
        const box = element('h1', heading);
        document.body.append(box);

        // Initial translation (en)
        sendForTranslation('Kết nối việc làm phù hợp', 'Tìm việc làm mới');
        heading._gt_mark = 1;
        const cloneEn = engineReplace(heading, 'Connecting suitable jobs');
        const outerEn = cloneEn.parentNode.parentNode;
        await flush();
        expect(box.textContent).toBe('Connecting suitable jobs');

        // Switch en -> az without reload
        clickLang('az');
        expect(reload).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem('__GT_TRANSLATE_LANGS'))).toEqual({ srcLang: 'vi', tgtLang: 'az' });
        engineRestore(heading, outerEn, 'Kết nối việc làm phù hợp');
        const cloneAz = engineReplace(heading, 'Uyğun işlərin əlaqələndirilməsi');
        const outerAz = cloneAz.parentNode.parentNode;
        await flush();
        expect(box.textContent).toBe('Uyğun işlərin əlaqələndirilməsi');

        // React updates heading while in az; translator expando mark is cleared so it can retranslate
        heading.nodeValue = 'Tìm việc làm mới';
        expect(heading._gt_mark).toBeUndefined();
        expect(box.textContent).toBe('Tìm việc làm mới');

        // Switch az -> vi without reload; stale savedOriginalText does not overwrite React's update
        const cloneAzUpdated = engineReplace(heading, 'Yeni iş tapın');
        const outerAzUpdated = cloneAzUpdated.parentNode.parentNode;
        await flush();
        heading.nodeValue = 'Đã cập nhật việc làm';
        clickLang('vi');
        expect(reload).not.toHaveBeenCalled();
        expect(localStorage.getItem('__GT_TRANSLATE_LANGS')).toBeNull();
        engineRestore(heading, outerAzUpdated, 'Tìm việc làm mới');
        expect(box.textContent).toBe('Đã cập nhật việc làm');

        // Switch back vi -> en so subsequent tests start with active = true
        clickLang('en');
        expect(reload).not.toHaveBeenCalled();
    });
});

describe('back/forward cache', () => {
    test('reloads a translated page restored from bfcache (the translator restored the Vietnamese text)', () => {
        const event = new Event('pageshow');
        Object.defineProperty(event, 'persisted', { value: true });
        window.dispatchEvent(event);
        expect(reload).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new Event('pageshow'));
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
