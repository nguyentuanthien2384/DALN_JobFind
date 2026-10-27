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
 *  4. Chống lỗi removeChild/insertBefore của React khi Google Translate bọc chữ trong <font>.
 *
 * Script phải được nạp đồng bộ trong <head>, trước React và trước float.js của GTranslate.
 */
(function () {
    'use strict';

    if (typeof window === 'undefined' || !window.MutationObserver || !window.Map || !window.WeakMap ||
        !Element.prototype.closest || !document.createRange) {
        return;
    }

    var DEFAULT_LANG = 'vi';
    var STORAGE_KEY = '__GT_TRANSLATE_LANGS';
    var HIGHLIGHT_NAME = 'gt-pending';
    // Thời gian tối đa (ms) một đoạn chữ ĐANG NẰM TRONG VÙNG NHÌN được phép ẩn để chờ dịch.
    // Quá thời gian này (VD: tên riêng không cần dịch) thì hiện lại để không mất nội dung.
    var MAX_VISIBLE_WAIT = 4000;
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

    var root = document.documentElement;
    var supportsHighlight = typeof CSS !== 'undefined' && !!CSS.highlights && typeof window.Highlight === 'function';
    var highlight = supportsHighlight ? new window.Highlight() : null;

    var currentLang = readStoredLang();
    var active = false;
    var pending = new Map(); // Text node -> { since: thời điểm bắt đầu hiển thị trong viewport }
    var givenUp = new WeakMap(); // Text node -> nội dung lúc bỏ cuộc chờ dịch
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
        if (!parent || SKIP_TAGS[parent.tagName] || parent.closest(SKIP_SELECTOR)) {
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
            } else if (now - info.since > MAX_VISIBLE_WAIT) {
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

    // Trang được khôi phục từ bfcache có thể đang mang trạng thái ngôn ngữ cũ.
    window.addEventListener('pageshow', function (evt) {
        if (evt.persisted && readStoredLang() !== currentLang) {
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

    // Google Translate di chuyển text node vào thẻ <font>, khiến React gọi removeChild/insertBefore
    // trên node không còn là con trực tiếp -> ném lỗi NotFoundError và làm trắng trang.
    // Xem https://github.com/facebook/react/issues/11538
    if (typeof Node === 'function' && Node.prototype) {
        var originalRemoveChild = Node.prototype.removeChild;
        Node.prototype.removeChild = function (child) {
            if (child && child.parentNode !== this) {
                if (child.parentNode) {
                    return originalRemoveChild.call(child.parentNode, child);
                }
                return child;
            }
            return originalRemoveChild.apply(this, arguments);
        };

        var originalInsertBefore = Node.prototype.insertBefore;
        Node.prototype.insertBefore = function (newNode, referenceNode) {
            if (referenceNode && referenceNode.parentNode !== this) {
                return originalInsertBefore.call(this, newNode, null);
            }
            return originalInsertBefore.apply(this, arguments);
        };
    }

    /* ------------------------------------------------------------------- init */

    injectStyles();
    setActive(currentLang);
})();
