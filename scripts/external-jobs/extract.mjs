// Turns a source job page into the short, factual excerpt Job Finder shows.
// Everything here works on plain text lines so it can be unit-tested without a DOM.

export const LIMITS = { sections: 5, items: 8, itemLength: 320, introLength: 480, summaryLength: 220 };

const BLOCK = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|SECTION|TABLE|TBODY|TD|TH|THEAD|TR|UL)$/;
const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|SVG|IFRAME|SELECT|OPTION|INPUT|TEXTAREA|BUTTON|IMG|VIDEO|CANVAS|TEMPLATE)$/;
const BULLET = /^(?:[•●▪◦·*+\-–—]|\d{1,2}[.)](?!\d))\s*/;

export const squash = value => String(value ?? '').replace(/[ ​﻿]/g, ' ').replace(/\s+/g, ' ').trim();

/** Block-aware text lines of a DOM node; list items are flagged so they stay separate bullets. */
export function domLines(root) {
    const lines = [];
    let current = '';
    let inItem = false;
    const flush = () => {
        const text = squash(current);
        if (text) lines.push({ text, item: inItem });
        current = '';
    };
    const walk = node => {
        for (const child of node.childNodes || []) {
            if (child.nodeType === 3) { current += child.textContent; continue; }
            if (child.nodeType !== 1 || SKIP.test(child.tagName)) continue;
            const block = BLOCK.test(child.tagName);
            if (!block) { walk(child); continue; }
            flush();
            const wasItem = inItem;
            if (child.tagName === 'LI') inItem = true;
            walk(child);
            flush();
            inItem = wasItem;
        }
    };
    if (root) walk(root);
    flush();
    return lines;
}

export const texts = lines => lines.map(line => typeof line === 'string' ? line : line.text);

const pad = value => String(value).padStart(2, '0');
/** All dd/mm/yyyy (or dd-mm-yyyy, dd.mm.yyyy) dates in a string, as ISO dates. */
export function isoDates(value) {
    const found = [];
    for (const match of String(value || '').matchAll(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/g)) {
        const [, d, m, y] = match.map(Number);
        const iso = `${y}-${pad(m)}-${pad(d)}`;
        const date = new Date(`${iso}T00:00:00Z`);
        if (m >= 1 && m <= 12 && date.toISOString().slice(0, 10) === iso) found.push(iso);
    }
    return found;
}
export const lastDate = value => isoDates(value).at(-1) || null;

const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelPattern = label => label instanceof RegExp ? label : new RegExp(`^${escapeRe(label)}`, 'i');

/**
 * Value printed for a label: "Label: value" on the same line or the next line when the
 * label stands alone. Returns null when the label is absent.
 */
export function valueAfter(lines, labels, { maxLookahead = 1 } = {}) {
    const all = texts(lines);
    for (const label of [].concat(labels)) {
        const re = labelPattern(label);
        for (let index = 0; index < all.length; index += 1) {
            const match = re.exec(all[index]);
            if (!match) continue;
            const rest = squash(all[index].slice(match.index + match[0].length).replace(/^\s*[:：]\s*/, ''));
            if (rest) return rest;
            for (let next = index + 1; next <= index + maxLookahead && next < all.length; next += 1) {
                if (all[next]) return all[next];
            }
        }
    }
    return null;
}

/** Lines from the first line matching `start` (exclusive unless includeStart) up to `stop`. */
export function between(lines, start, stop, { includeStart = false } = {}) {
    let from = 0;
    if (start) {
        const index = lines.findIndex(line => start.test(typeof line === 'string' ? line : line.text));
        if (index < 0) return [];
        from = includeStart ? index : index + 1;
    }
    const rest = lines.slice(from);
    if (!stop) return rest;
    const end = rest.findIndex(line => stop.test(typeof line === 'string' ? line : line.text));
    return end < 0 ? rest : rest.slice(0, end);
}

const HEADINGS = [
    /^(mô tả công việc|chi tiết công việc|mô tả|nội dung công việc|trách nhiệm công việc|nhiệm vụ|job description|key accountabilities)$/i,
    /^(yêu cầu( công việc| ứng viên| tuyển dụng| chung)?|job requirements?( \(yêu cầu tuyển dụng\))?|requirements)$/i,
    /^(quyền lợi( được hưởng| dành cho bạn)?|phúc lợi|chế độ đãi ngộ|chế độ phúc lợi|benefits?|thông tin khác)$/i,
    /^(địa điểm làm việc|nơi làm việc)$/i,
    /^(tổ chức thi tuyển|yêu cầu hồ sơ|hồ sơ dự tuyển)$/i,
    /^(thông tin tham khảo|thông tin liên hệ|liên hệ|cách thức ứng tuyển|thời gian, địa điểm tiếp nhận hồ sơ.*)$/i,
];
const OMIT_SECTION = /(liên hệ|contact|cách thức ứng tuyển|nộp hồ sơ|thông tin tham khảo|ứng tuyển)/i;
const PRIVATE = /(@|\bhttps?:\/\/|\bwww\.|(?:\+?84|0)(?:[\s.-]?\d){8,10}\b|hotline|zalo|sđt|điện thoại)/i;
const GATED = /^(nhập thông tin để xem|đăng nhập để xem)/i;

const PICTOGRAPHS = /^[\p{Extended_Pictographic}️\s]+/u;
const headingKey = value => squash(value).replace(PICTOGRAPHS, '').replace(/^([IVX]+|\d{1,2})[.)]\s*/i, '').replace(/\s*[:：]\s*$/, '');
export const isHeading = value => HEADINGS.some(re => re.test(headingKey(value)));

const letters = value => value.replace(/[^\p{L}]/gu, '');
const isShouting = value => letters(value).length >= 4 && letters(value) === letters(value).toLocaleUpperCase('vi');
/** "MÔ TẢ CÔNG VIỆC" → "Mô tả công việc"; mixed-case source text is kept as written. */
export function sentenceCase(value) {
    const text = squash(value);
    if (!isShouting(text)) return text;
    const lower = text.toLocaleLowerCase('vi');
    return lower.charAt(0).toLocaleUpperCase('vi') + lower.slice(1);
}

export function clip(value, length) {
    const text = squash(value);
    if (text.length <= length) return text;
    const cut = text.slice(0, length - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > length * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}

/** Normalises one content line into a display item, or null when it must not be republished. */
export function cleanItem(value) {
    let text = squash(value).replace(PICTOGRAPHS, '').replace(BULLET, '').replace(BULLET, '');
    if (!text || text.length < 2 || GATED.test(text) || PRIVATE.test(text)) return null;
    if (isShouting(text) && text.length <= 70) text = `${sentenceCase(text).replace(/[:：]\s*$/, '')}:`;
    return clip(text, LIMITS.itemLength);
}

/**
 * Splits content lines into the source's own sections. Unknown sub-headings stay as items
 * (they end with ":" and the UI shows them as labels). Contact/application sections and
 * lines with phone numbers, e-mails or links are dropped: candidates apply at the source.
 */
export function splitSections(lines, { defaultTitle = 'Mô tả công việc', headings = [] } = {}) {
    const extra = headings.map(labelPattern);
    const sections = [];
    let current = null;
    for (const raw of texts(lines)) {
        const key = headingKey(raw);
        if (key && key.length <= 60 && (isHeading(raw) || extra.some(re => re.test(key)))) {
            current = { title: sentenceCase(key), items: [] };
            sections.push(current);
            continue;
        }
        if (!current) { current = { title: defaultTitle, items: [] }; sections.push(current); }
        // Bilingual sources put the Vietnamese translation on its own "(...)" line.
        if (/^\(/.test(squash(raw)) && current.items.length) current.items[current.items.length - 1] += ` ${squash(raw)}`;
        else current.items.push(raw);
    }
    return finalizeSections(sections);
}

export function finalizeSections(sections) {
    const merged = [];
    for (const section of sections) {
        if (OMIT_SECTION.test(section.title)) continue;
        const items = [];
        for (const raw of section.items) {
            // Some sources write several "- point." items on one line; split only after a full stop
            // so ranges and compounds such as "Kinh tế - Luật" stay intact.
            const parts = /^[-–]\s/.test(squash(raw)) ? squash(raw).split(/(?<=[.;!?])\s+(?=[-–]\s)/) : [raw];
            for (const part of parts) {
                const item = cleanItem(part);
                if (item && !items.includes(item)) items.push(item);
            }
        }
        while (items.length && /:$/.test(items.at(-1))) items.pop();
        if (!items.length) continue;
        const existing = merged.find(entry => entry.title.toLocaleLowerCase('vi') === section.title.toLocaleLowerCase('vi'));
        if (existing) { existing.items.push(...items); continue; }
        merged.push({ title: section.title, items });
    }
    return merged.slice(0, LIMITS.sections).map(section => {
        const items = section.items.slice(0, LIMITS.items);
        while (items.length > 1 && /:$/.test(items.at(-1))) items.pop();
        return { title: section.title, items, truncated: items.length < section.items.length };
    });
}

/** Short real excerpt used for search and previews: the first description item. */
export function summaryFrom(sections, fallback = '') {
    const first = sections.flatMap(section => section.items).find(item => !/:$/.test(item) && item.length > 20);
    return clip(first || fallback, LIMITS.summaryLength);
}

export function introFrom(lines) {
    const text = squash(texts(lines).filter(line => !PRIVATE.test(line)).join(' '));
    return text ? clip(text, LIMITS.introLength) : null;
}

const NEGOTIABLE = /^(thỏa thuận|thoả thuận|thương lượng|negotiable|lương thỏa thuận|theo thỏa thuận)$/i;
export function normalizeSalary(value) {
    const text = squash(value).replace(/^(lương|mức lương|thu nhập)\s*[:：]\s*/i, '');
    if (!text || GATED.test(text)) return null;
    if (NEGOTIABLE.test(text)) return firstUpper(text.toLocaleLowerCase('vi'));
    return clip(text, 90);
}

export function normalizeQuantity(value) {
    const text = squash(value).replace(/^số lượng( tuyển( dụng)?| cần tuyển)?\s*[:：]?\s*/i, '');
    if (!/\d/.test(text) || /^0+(\s|$)/.test(text)) return null;
    return clip(text, 40);
}

export const firstUpper = value => {
    const text = squash(value);
    return text.charAt(0).toLocaleUpperCase('vi') + text.slice(1);
};
