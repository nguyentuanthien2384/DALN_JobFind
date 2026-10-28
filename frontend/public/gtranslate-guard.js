/*
 * GTranslate guard - giúp việc đổi ngôn ngữ không bị "dính" ngôn ngữ cũ.
 *
 * Widget GTranslate dịch trang bất đồng bộ: chữ tiếng Việt được hiển thị trước,
 * vài trăm ms tới vài giây sau mới được thay bằng bản dịch (khi vừa đổi ngôn ngữ,
 * khi chuyển trang trong SPA, khi dữ liệu API tải về...). Script này:
 *
 *  1. Ẩn tạm (chữ trong suốt, vẫn giữ bố cục) mọi đoạn chữ tiếng Việt chưa được dịch
 *     khi đang chọn ngôn ngữ khác tiếng Việt, và hiện lại ngay khi bản dịch được gắn vào.
 *     Dùng CSS Custom Highlight API nên KHÔNG sửa DOM của trang (sửa DOM sẽ khiến
 *     GTranslate phải dịch lại từ đầu, làm chậm thêm).
 *  2. Khi đổi từ một ngôn ngữ đã dịch sang ngôn ngữ khác (VD: DE -> EN, DE -> VI),
 *     tải lại trang với ngôn ngữ mới thay vì để GTranslate "khôi phục" DOM cũ. Việc
 *     khôi phục có thể đưa lại những đoạn chữ cũ mà React đã cập nhật trong lúc dịch.
 *  3. Tải trước thư viện dịch khi trình duyệt rảnh để lần đổi ngôn ngữ đầu tiên nhanh hơn.
 *  4. Giữ React và bản dịch đồng bộ khi Google Translate thay chữ bằng <font>: không lỗi
 *     removeChild/insertBefore, không giữ chữ dịch cũ khi React cập nhật, không để lại chữ "ma".
 *
 * Script phải được nạp đồng bộ trong <head>, trước React và trước float.js của GTranslate.
 * Kiểm thử trên trình duyệt thật: node backend/scripts/test-gtranslate-browser.cjs
 */
(function () {
    'use strict';

    if (typeof window === 'undefined' || !window.MutationObserver || !window.Map || !window.WeakMap ||
        !window.WeakSet || !Element.prototype.closest || !document.createRange || !('isConnected' in Node.prototype)) {
        return;
    }

    var DEFAULT_LANG = 'vi';
    var STORAGE_KEY = '__GT_TRANSLATE_LANGS';
    var HIGHLIGHT_NAME = 'gt-pending';
    // Thời gian tối đa (ms) một đoạn chữ ĐANG NẰM TRONG VÙNG NHÌN được phép ẩn để chờ dịch.
    // Quá thời gian này (VD: tên riêng không cần dịch) thì hiện lại để không mất nội dung.
    var MAX_VISIBLE_WAIT = 4000;
    // Chữ React vừa cập nhật sau khi trang đã dịch: GTranslate dịch lại trong khoảng 1 giây nếu có,
    // và có vùng nó không dịch lại (VD: khung chat), nên không để nút/trạng thái trống lâu.
    var UPDATED_TEXT_WAIT = 1200;
    var TICK_MS = 150;
    var VIEWPORT_MARGIN = 200;

    // Ký tự chỉ có trong tiếng Việt (ă, đ, ơ, ư và khối Latin Extended Additional U+1EA0-U+1EF9).
    var VI_STRICT = '\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9\u0309\u031B\u0323';
    // Thêm các ký tự có dấu dùng chung với ngôn ngữ khác (à, á, â, ê, ô...).
    var VI_BROAD = VI_STRICT +
        '\u00C0-\u00C3\u00C8-\u00CA\u00CC\u00CD\u00D2-\u00D5\u00D9\u00DA\u00DD' +
        '\u00E0-\u00E3\u00E8-\u00EA\u00EC\u00ED\u00F2-\u00F5\u00F9\u00FA\u00FD' +
        '\u0128\u0129\u0168\u0169\u0300\u0301\u0303';
    var STRICT_RE = new RegExp('[' + VI_STRICT + ']');
    var BROAD_RE = new RegExp('[' + VI_BROAD + ']');

    var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1, TITLE: 1, OPTION: 1 };
    var SKIP_SELECTOR = '.notranslate,[translate="no"],[contenteditable=""],[contenteditable="true"]';
    // Vùng thông báo/hội thoại trực tiếp (tin nhắn mới, lỗi biểu mẫu, toast) phải hiện ngay:
    // chậm vài giây còn tệ hơn hiện tạm tiếng Việt trong lúc chờ dịch.
    var LIVE_SELECTOR = '[aria-live],[role="alert"],[role="alertdialog"],[role="status"],[role="log"]';

    var root = document.documentElement;
    var supportsHighlight = typeof CSS !== 'undefined' && !!CSS.highlights && typeof window.Highlight === 'function';
    var highlight = supportsHighlight ? new window.Highlight() : null;

    var currentLang = readStoredLang();
    var active = false;
    var pending = new Map(); // Text node -> { since: thời điểm bắt đầu hiển thị trong viewport }
    var givenUp = new WeakMap(); // Text node -> nội dung lúc bỏ cuộc chờ dịch
    var updated = new WeakSet(); // Text node được đặt lại vì React đổi chữ sau khi đã dịch
    var dirty = false;
    var tickTimer = null;

    /* ---------------------------------------------------------------- storage */

    function readStoredLang() {
        try {
            var stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (stored && typeof stored.tgtLang === 'string' && stored.tgtLang) {
                return stored.tgtLang;
            }
        } catch (e) { /* localStorage không khả dụng */ }
        return DEFAULT_LANG;
    }

    function writeStoredLang(lang) {
        try {
            if (!lang || lang === DEFAULT_LANG) {
                localStorage.removeItem(STORAGE_KEY);
            } else {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ srcLang: DEFAULT_LANG, tgtLang: lang }));
            }
        } catch (e) { /* localStorage không khả dụng */ }
    }

    /* -------------------------------------------------------------------- CSS */

    function injectStyles() {
        var placeholderSelectors = [];
        // Ẩn placeholder còn tiếng Việt (VD: "Nhập tên công ty"). Khi GTranslate dịch thuộc tính
        // placeholder, selector không còn khớp nên placeholder tự hiện lại - không cần JS.
        var chars = '\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0';
        for (var code = 0x1EA0; code <= 0x1EF9; code++) {
            chars += String.fromCharCode(code);
        }
        for (var i = 0; i < chars.length; i++) {
            placeholderSelectors.push('html.gt-guard-on [placeholder*="' + chars.charAt(i) + '"]::placeholder');
        }

        var css = '' +
            '::highlight(' + HIGHLIGHT_NAME + '){color:transparent;text-shadow:none;}' +
            placeholderSelectors.join(',') + '{color:transparent!important;}' +
            // Dự phòng cho trình duyệt chưa hỗ trợ CSS Custom Highlight API.
            'html.gt-guard-fallback-hide #root *{color:transparent!important;text-shadow:none!important;}';

        var style = document.createElement('style');
        style.setAttribute('data-gt-guard', '');
        style.textContent = css;
        (document.head || root).appendChild(style);
    }

    /* -------------------------------------------------------------- detection */

    function needsHiding(node) {
        var text = node.nodeValue;
        if (!text || !BROAD_RE.test(text)) {
            return false;
        }
        var parent = node.parentElement;
        if (!parent || SKIP_TAGS[parent.tagName] || parent.closest(SKIP_SELECTOR) || parent.closest(LIVE_SELECTOR)) {
            return false;
        }
        if (givenUp.get(node) === text) {
            return false;
        }
        // GTranslate bọc bản dịch trong <font>. Bên trong <font> chỉ coi là "chưa dịch" khi còn
        // ký tự đặc trưng tiếng Việt (VD: React vừa ghi nội dung tiếng Việt mới vào node đã dịch).
        if (parent.closest('font')) {
            return STRICT_RE.test(text);
        }
        return true;
    }

    function consider(node) {
        if (needsHiding(node)) {
            if (!pending.has(node)) {
                pending.set(node, { since: null });
                dirty = true;
            }
        } else if (pending.delete(node)) {
            dirty = true;
        }
    }

    function scan(element) {
        if (element.nodeType === 3) {
            consider(element);
            return;
        }
        if (element.nodeType !== 1 && element.nodeType !== 9 && element.nodeType !== 11) {
            return;
        }
        var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        var node;
        while ((node = walker.nextNode())) {
            consider(node);
        }
    }

    /* -------------------------------------------------------------- rendering */

    function render() {
        dirty = false;
        if (highlight) {
            highlight.clear();
            pending.forEach(function (_info, node) {
                var range = document.createRange();
                range.selectNodeContents(node);
                highlight.add(range);
            });
            if (highlight.size) {
                CSS.highlights.set(HIGHLIGHT_NAME, highlight);
            } else {
                CSS.highlights.delete(HIGHLIGHT_NAME);
            }
        } else {
            root.classList.toggle('gt-guard-fallback-hide', pending.size > 0);
        }
    }

    function isNearViewport(node) {
        var range = document.createRange();
        range.selectNodeContents(node);
        var rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) {
            return false; // Đang bị ẩn (display:none, dropdown đóng...): GTranslate chỉ dịch khi hiện ra.
        }
        var vh = window.innerHeight || root.clientHeight;
        var vw = window.innerWidth || root.clientWidth;
        return rect.bottom > -VIEWPORT_MARGIN && rect.top < vh + VIEWPORT_MARGIN &&
            rect.right > -VIEWPORT_MARGIN && rect.left < vw + VIEWPORT_MARGIN;
    }

    function tick() {
        tickTimer = null;
        if (!active) {
            return;
        }
        var now = Date.now();
        pending.forEach(function (info, node) {
            if (!node.isConnected || !needsHiding(node)) {
                pending.delete(node);
                dirty = true;
                return;
            }
            if (!isNearViewport(node)) {
                info.since = null;
                return;
            }
            if (info.since === null) {
                info.since = now;
            } else if (now - info.since > (updated.has(node) ? UPDATED_TEXT_WAIT : MAX_VISIBLE_WAIT)) {
                // Không được dịch (tên riêng, đoạn chữ GTranslate bỏ qua...) -> hiện lại.
                givenUp.set(node, node.nodeValue);
                pending.delete(node);
                dirty = true;
            }
        });
        if (dirty) {
            render();
        }
        scheduleTick();
    }

    function scheduleTick() {
        if (active && pending.size && tickTimer === null) {
            tickTimer = setTimeout(tick, TICK_MS);
        }
    }

    /* ---------------------------------------------------------------- observe */

    var observer = new MutationObserver(function (records) {
        if (!active) {
            return;
        }
        for (var i = 0; i < records.length; i++) {
            var record = records[i];
            if (record.type === 'characterData') {
                consider(record.target);
            } else {
                for (var j = 0; j < record.addedNodes.length; j++) {
                    scan(record.addedNodes[j]);
                }
            }
        }
        // MutationObserver chạy trong microtask, trước khi trình duyệt vẽ lại, nên chữ tiếng Việt
        // mới chèn vào sẽ được ẩn ngay từ khung hình đầu tiên, và bản dịch hiện ngay khi gắn vào.
        if (dirty) {
            render();
        }
        scheduleTick();
    });

    function setActive(lang) {
        currentLang = lang || DEFAULT_LANG;
        var on = currentLang !== DEFAULT_LANG;
        if (on === active) {
            return;
        }
        active = on;
        root.classList.toggle('gt-guard-on', on);
        if (on) {
            observer.observe(root, { childList: true, subtree: true, characterData: true });
            scan(root);
            render();
            scheduleTick();
        } else {
            observer.disconnect();
            pending.clear();
            if (tickTimer !== null) {
                clearTimeout(tickTimer);
                tickTimer = null;
            }
            render();
        }
    }

    /* ------------------------------------------------------- language switch */

    document.addEventListener('click', function (evt) {
        var target = evt.target;
        var link = target && target.closest && target.closest('.gtranslate_wrapper a[data-gt-lang]');
        if (!link) {
            return;
        }
        var lang = link.getAttribute('data-gt-lang');
        if (!lang || lang === currentLang) {
            return;
        }
        if (currentLang !== DEFAULT_LANG) {
            // Đang ở bản dịch -> tải lại trang để dịch từ nội dung gốc, sạch sẽ, không lẫn chữ cũ.
            evt.preventDefault();
            evt.stopImmediatePropagation();
            writeStoredLang(lang);
            setActive(lang);
            window.location.reload();
            return;
        }
        // Tiếng Việt -> ngôn ngữ khác: dịch tại chỗ, ẩn ngay chữ tiếng Việt trong lúc chờ.
        setActive(lang);
    }, true);

    // Trang được khôi phục từ bfcache có thể đang mang trạng thái ngôn ngữ cũ. Ngoài ra lib.min.js
    // của GTranslate khôi phục chữ gốc khi trang vào bfcache (pagehide) và không dịch lại khi
    // trang quay lại, nên trang đang dịch cũng phải tải lại.
    window.addEventListener('pageshow', function (evt) {
        if (evt.persisted && (active || readStoredLang() !== currentLang)) {
            window.location.reload();
        }
    });

    /* ---------------------------------------------------------------- preload */

    function preloadTranslator() {
        if (window.gt_translate_script) {
            return;
        }
        var wrapper = document.querySelector('.gtranslate_wrapper');
        if (wrapper) {
            // float.js chỉ tải lib.min.js khi người dùng rê chuột/focus vào widget.
            wrapper.dispatchEvent(new Event('focusin'));
        }
    }

    window.addEventListener('load', function () {
        if (window.requestIdleCallback) {
            window.requestIdleCallback(preloadTranslator, { timeout: 3000 });
        } else {
            setTimeout(preloadTranslator, 1500);
        }
    });

    /* ------------------------------------------------- React + <font> safety */

    // lib.min.js của GTranslate (engine Google Translate) không dịch tại chỗ: nó cloneNode() text node,
    // ghi bản dịch vào bản sao nằm trong <font>, rồi GỠ node gốc khỏi trang (trình dịch khác có thể
    // chuyển chính node gốc vào <font>). React vẫn giữ tham chiếu tới node gốc, nên:
    //  1. removeChild/insertBefore trên node không còn là con trực tiếp -> NotFoundError, trắng trang
    //     (https://github.com/facebook/react/issues/11538);
    //  2. React ghi chữ mới (VD: "0 bài" -> "7 bài") vào node đã bị gỡ: trang vẫn hiện bản dịch CŨ,
    //     sai số liệu mà không có lỗi nào;
    //  3. React gỡ node đã bị thay: bản dịch của nó ở lại trên trang (chữ "ma").
    // Vì vậy ghi lại bản sao của từng node gốc (cloneNode) và nơi engine gỡ nó (removeChild):
    //  - React ghi chữ mới -> đặt node gốc trở lại chỗ bản dịch, bỏ bản dịch cũ; GTranslate dịch lại
    //    (trong lúc chờ, phần ẩn chữ ở trên vẫn áp dụng);
    //  - React gỡ node -> gỡ luôn bản dịch của nó;
    //  - React chèn trước node -> chèn trước bản dịch của nó, đúng thứ tự trên màn hình.
    // Ngoài ra bản dịch về trễ: engine gom chữ, gửi đi dịch, vài trăm ms sau mới ghi bản dịch. Nếu
    // trong lúc chờ React đã đổi chữ (VD: "Người dùng" -> tên thật, "0 bài" -> "7 bài"), engine vẫn
    // ghi bản dịch của chữ CŨ. Guard so chữ hiện tại với các chuỗi đã gửi đi dịch để nhận ra việc này.
    var originalRemoveChild = Node.prototype.removeChild;
    var originalInsertBefore = Node.prototype.insertBefore;
    var originalCloneNode = Node.prototype.cloneNode;
    var setNodeValue = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeValue').set;
    var replaced = new WeakMap(); // Text node gốc -> { clones: bản sao chứa bản dịch, parent: nơi bị gỡ }
    var clonedElements = new WeakSet(); // Thẻ engine nhân bản để bọc bản dịch (VD: <b> trong câu)
    var lateFixes = new WeakMap(); // Text node -> số lần đã bỏ bản dịch về trễ (chặn vòng lặp)
    // Engine nhân bản rồi gỡ node gốc trong cùng một lượt chạy đồng bộ. Lần gỡ ở lượt khác (của
    // React) là gỡ thật, kéo theo bản dịch.
    var engineBatch = false;
    var TRANSLATE_HOST = 'translate-pa.googleapis.com';
    var MAX_SOURCES = 600;
    var sentSources = []; // Chuỗi nguồn (đã chuẩn hóa) của các lần gửi đi dịch gần đây

    // Chuỗi gửi đi dịch đánh dấu thẻ nội dòng bằng <a i=N>...</a> và escape HTML.
    function normalizeText(text) {
        return String(text).replace(/<\/?a(?:\s+i=\d+)?>/g, '')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&#39;/g, '\'').replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ').trim();
    }

    function rememberSources(body) {
        try {
            var texts = JSON.parse(body)[0][0];
            for (var i = 0; i < texts.length; i++) {
                sentSources.push(normalizeText(texts[i]));
            }
            if (sentSources.length > MAX_SOURCES) {
                sentSources.splice(0, sentSources.length - MAX_SOURCES);
            }
        } catch (e) { /* Định dạng khác: không kiểm tra bản dịch về trễ */ }
    }

    // Không chắc (chưa thấy request nào) thì coi như chữ đã được gửi đi dịch.
    function sentForTranslation(text) {
        text = normalizeText(text);
        if (!text || !sentSources.length) {
            return true;
        }
        for (var i = sentSources.length - 1; i >= 0; i--) {
            if (sentSources[i].indexOf(text) >= 0) {
                return true;
            }
        }
        return false;
    }

    if (window.XMLHttpRequest) {
        var originalOpen = XMLHttpRequest.prototype.open;
        var originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this.gtGuardTranslate = String(url).indexOf(TRANSLATE_HOST) >= 0;
            return originalOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (body) {
            if (this.gtGuardTranslate && typeof body === 'string') {
                rememberSources(body);
            }
            return originalSend.apply(this, arguments);
        };
    }

    function markEngineBatch() {
        if (!engineBatch) {
            engineBatch = true;
            Promise.resolve().then(function () {
                engineBatch = false;
            });
        }
    }

    // Con trực tiếp của parent có chứa node, hoặc null.
    function childOf(parent, node) {
        while (node && node.parentNode !== parent) {
            node = node.parentNode;
        }
        return node || null;
    }

    // Gỡ một bản sao và các thẻ bọc đã rỗng (<font> của engine hoặc thẻ engine nhân bản).
    function prune(node) {
        var parent = node.parentNode;
        if (parent) {
            originalRemoveChild.call(parent, node);
        }
        while (parent && parent.nodeType === 1 && !parent.firstChild && parent.parentNode &&
            (parent.tagName === 'FONT' || clonedElements.has(parent))) {
            node = parent;
            parent = parent.parentNode;
            originalRemoveChild.call(parent, node);
        }
    }

    function dropTranslation(node, info) {
        replaced.delete(node);
        for (var i = 0; i < info.clones.length; i++) {
            prune(info.clones[i]);
        }
    }

    // Chỗ trên màn hình đang hiển thị node: trước bản dịch đầu tiên của nó, hoặc trước thẻ
    // <font> đang bọc nó. null nghĩa là cuối parent.
    function anchorFor(parent, node) {
        var info = replaced.get(node);
        if (info) {
            for (var i = 0; i < info.clones.length; i++) {
                var top = childOf(parent, info.clones[i]);
                if (top) {
                    return top;
                }
            }
        }
        return childOf(parent, node);
    }

    // Đặt node gốc (đang mang chữ React mới nhất) trở lại chỗ bản dịch của nó.
    function restoreOriginal(node, info) {
        var parent = info.parent;
        if (parent.isConnected) {
            // Bản dịch giữ khoảng trắng ở ranh giới (VD: "7 " + "normal posts"): giữ lại để chữ
            // không dính vào phần dịch bên cạnh.
            var shown = info.clones.length ? info.clones[0].nodeValue || '' : '';
            var text = node.nodeValue || '';
            if (/^\s/.test(shown) && !/^\s/.test(text)) {
                text = ' ' + text;
            }
            if (/\s$/.test(shown) && !/\s$/.test(text)) {
                text += ' ';
            }
            if (text !== node.nodeValue) {
                setNodeValue.call(node, text);
            }
            originalInsertBefore.call(parent, node, anchorFor(parent, node));
            updated.add(node);
        }
        dropTranslation(node, info);
    }

    // Engine vừa thay node bằng bản dịch của chữ cũ: hoàn tác ngay để trang hiện chữ hiện tại,
    // GTranslate sẽ dịch lại chữ mới. Tối đa 2 lần mỗi node để không dịch đi dịch lại mãi.
    function undoLateTranslation(node, info) {
        var count = lateFixes.get(node) || 0;
        if (count >= 2 || sentForTranslation(node.nodeValue)) {
            return;
        }
        lateFixes.set(node, count + 1);
        Promise.resolve().then(function () {
            if (replaced.get(node) === info && !node.parentNode) {
                restoreOriginal(node, info);
            }
        });
    }

    Node.prototype.cloneNode = function () {
        var copy = originalCloneNode.apply(this, arguments);
        if (active) {
            if (this.nodeType === 3) {
                var info = replaced.get(this);
                if (!info) {
                    info = { clones: [], parent: null };
                    replaced.set(this, info);
                }
                info.clones.push(copy);
                markEngineBatch();
            } else if (this.nodeType === 1) {
                clonedElements.add(copy);
            }
        }
        return copy;
    };

    Node.prototype.removeChild = function (child) {
        if (child && child.parentNode !== this) {
            var info = replaced.get(child);
            if (info && !child.parentNode) {
                dropTranslation(child, info);
                return child;
            }
            if (child.parentNode) {
                return originalRemoveChild.call(child.parentNode, child);
            }
            return child;
        }
        var result = originalRemoveChild.apply(this, arguments);
        var traced = child && child.nodeType === 3 && replaced.get(child);
        if (traced) {
            if (engineBatch && !traced.parent) {
                traced.parent = this;
                undoLateTranslation(child, traced);
            } else {
                dropTranslation(child, traced);
            }
        }
        return result;
    };

    Node.prototype.insertBefore = function (newNode, referenceNode) {
        if (referenceNode && referenceNode.parentNode !== this) {
            return originalInsertBefore.call(this, newNode, anchorFor(this, referenceNode));
        }
        return originalInsertBefore.apply(this, arguments);
    };

    // React cập nhật chữ bằng textNode.nodeValue = ...
    function traceTextWrites(proto, name) {
        var descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (!descriptor || !descriptor.set || !descriptor.configurable) {
            return;
        }
        Object.defineProperty(proto, name, {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: descriptor.get,
            set: function (value) {
                descriptor.set.call(this, value);
                if (this.nodeType === 3 && !this.parentNode) {
                    var info = replaced.get(this);
                    if (info && info.parent) {
                        restoreOriginal(this, info);
                    }
                }
            }
        });
    }
    traceTextWrites(Node.prototype, 'nodeValue');
    traceTextWrites(CharacterData.prototype, 'data');

    /* ------------------------------------------------------------------- init */

    injectStyles();
    setActive(currentLang);
})();
