import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false });
const allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'A', 'CODE', 'PRE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'HR']);
const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEMPLATE']);
const escapeText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Rebuild editor formatting without executable attributes, embeds or URLs.
export function safeJobHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const output = document.createElement('div');
    const copy = (node, parent) => {
        if (node.nodeType === 3) { parent.appendChild(document.createTextNode(node.textContent)); return; }
        if (node.nodeType !== 1 || blocked.has(node.tagName)) return;
        const target = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : parent;
        if (target !== parent) {
            if (node.tagName === 'A') {
                const href = (node.getAttribute('href') || '').trim();
                if (/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href)) {
                    target.setAttribute('href', href);
                    target.setAttribute('rel', 'noopener noreferrer');
                }
            }
            parent.appendChild(target);
        }
        Array.from(node.childNodes).forEach(child => copy(child, target));
    };
    Array.from(doc.body.childNodes).forEach(node => copy(node, output));
    return output.innerHTML;
}

const headingKind = node => {
    if (node.nodeType !== 1 || !/^(H[1-6]|P|STRONG|B)$/.test(node.tagName)) return null;
    const title = node.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd')
        .replace(/^\s*(?:\d+|[ivx]+)[.)\s-]+/, '').replace(/[:\s]+$/g, '').trim();
    if (/^(mo ta( cong viec)?|job description|responsibilities|trach nhiem cong viec)$/.test(title)) return 'description';
    if (/^(yeu cau( ung vien| cong viec)?|requirements|qualifications)$/.test(title)) return 'requirements';
    if (/^(quyen loi( duoc huong)?|phuc loi|benefits|che do dai ngo)$/.test(title)) return 'benefits';
    return null;
};

export function getJobSections(detail = {}) {
    const html = safeJobHtml(detail.descriptionHTML || markdown.render(detail.descriptionMarkdown || ''));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sections = { description: '', requirements: '', benefits: '' };
    let current = 'description';
    Array.from(doc.body.childNodes).forEach(node => {
        const kind = headingKind(node);
        if (kind) { current = kind; return; }
        sections[current] += node.nodeType === 1 ? node.outerHTML : escapeText(node.textContent);
    });
    const benefitsDoc = new DOMParser().parseFromString(sections.benefits, 'text/html');
    const benefits = Array.from(benefitsDoc.body.childNodes).flatMap(node => {
        if (node.nodeType === 1 && /^(UL|OL)$/.test(node.tagName)) return Array.from(node.children).filter(item => item.textContent.trim()).map(item => item.innerHTML);
        return node.textContent.trim() ? [node.nodeType === 1 ? node.outerHTML : escapeText(node.textContent)] : [];
    });
    return { ...sections, benefits };
}

export const jobTimestamp = value => {
    if (value === null || value === undefined || value === '') return null;
    const timestamp = /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
};
