// Read-only access to the reviewed external job catalogue that /job already shows
// (frontend/src/data/verifiedJobs.json). The chatbot uses it so a job question can
// be answered even when no internal post is open. Only listing fields are returned;
// contact details were never imported (see docs/verified-jobs.md).
const fs = require('fs');
const path = require('path');

const DATA_DIR = () => process.env.VERIFIED_JOBS_DIR || path.resolve(__dirname, '../../../frontend/src/data');
const EXTERNAL_ID = /^external-[a-f0-9]{6,32}$/;
const ASSET = /^\/external-jobs\/[\w./-]+$/;
const CATEGORY_LABELS = {
    'cong-nghe-thong-tin': 'Công nghệ thông tin', 'giao-vien': 'Giáo viên', 'kinh-te': 'Kinh tế',
    logistics: 'Logistics / Chuỗi cung ứng', 'bat-dong-san': 'Bất động sản', 'truyen-thong': 'Truyền thông',
    'quan-ly-nhan-su': 'Quản lý nhân sự', luat: 'Luật'
};
// Common abbreviations users type for a category; matched as whole words only.
const CATEGORY_ALIASES = { 'cong-nghe-thong-tin': 'it cntt' };
// Words that describe the request rather than the job ("tìm việc làm đang tuyển").
const STOP_WORDS = new Set(['tim', 'viec', 'lam', 'tuyen', 'dung', 'dang', 'cac', 'nhung', 'tai', 'o', 'cho', 'toi', 'minh', 'can', 'muon', 'vi', 'tri']);

const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const wordsOf = (value) => normalize(value).match(/[a-z0-9+#]+/g) || [];
// Lower-case words that keep Vietnamese tone marks: "toán" and "toàn" stay different.
const markedWordsOf = (value) => String(value || '').normalize('NFC').toLowerCase().match(/[\p{L}\p{N}+#]+/gu) || [];
const hasMarks = (value) => normalize(value) !== String(value || '').normalize('NFC').toLowerCase().trim();
// Deadlines are Vietnamese calendar dates, open through the whole day.
const vietnamDate = (now) => new Date(now + 7 * 3600000).toISOString().slice(0, 10);

const cache = new Map();
function readJson(file) {
    const full = path.join(DATA_DIR(), file);
    const stat = fs.statSync(full);
    const hit = cache.get(full);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.value;
    const value = JSON.parse(fs.readFileSync(full, 'utf8'));
    cache.set(full, { mtimeMs: stat.mtimeMs, value });
    return value;
}
// A missing or unreadable catalogue only removes external results; internal search still works.
function loadCatalog() {
    try {
        const catalog = readJson('verifiedJobs.json');
        if (!Array.isArray(catalog?.jobs) || !Array.isArray(catalog?.provinces)) return null;
        if (!catalog.provinceIndex) {
            const index = new Map();
            for (const province of catalog.provinces) {
                for (const name of [province.code, province.value, ...(province.previousNames || [])]) index.set(normalize(name), province.code);
            }
            Object.defineProperty(catalog, 'provinceIndex', { value: index });
        }
        return catalog;
    } catch { return null; }
}
// Names people type in chat that are not province names in the catalogue.
const LOCATION_ALIASES = { hcm: 'Hồ Chí Minh', tphcm: 'Hồ Chí Minh', 'sai gon': 'Hồ Chí Minh', 'saigon': 'Hồ Chí Minh', hn: 'Hà Nội', 'ha noi': 'Hà Nội', 'da nang': 'Đà Nẵng' };
const provinceOf = (catalog, value) => {
    const key = normalize(value).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(tinh|thanh pho|tp)\s+/, '');
    return catalog.provinceIndex.get(key) || catalog.provinceIndex.get(normalize(LOCATION_ALIASES[key])) || null;
};
// The province name both catalogues store, or the input unchanged when it is not a known province.
function canonicalLocation(value) {
    const catalog = loadCatalog();
    return (catalog && provinceOf(catalog, value)) || value;
}
const isOpen = (job, now) => job && job.sourceStatus !== 'removed' && job.sourceStatus !== 'closed'
    && EXTERNAL_ID.test(job.id) && !(job.deadline && job.deadline < vietnamDate(now));
const clip = (value, size) => String(value || '').slice(0, size);

const externalCard = (job) => ({
    id: job.id,
    name: clip(job.title, 180),
    company: clip(job.employer, 120),
    location: clip(job.sourceLocation || job.provinceCodes.join(', '), 80),
    salary: clip(job.salaryText || 'Chưa công bố', 80),
    workType: clip(job.workTypeText, 80),
    ...(job.deadline ? { deadline: job.deadline } : {}),
    ...(ASSET.test(job.logo || '') && !job.logo.includes('..') ? { logo: job.logo } : {}),
    source: 'external',
    url: `/external-job/${job.id}`
});

// A query typed with tone marks is matched with marks, so "kế toán" does not match
// "thiết kế ... an toàn"; an unmarked query ("ke toan") is matched without them.
function jobWords(job, marked) {
    const text = [job.title, job.employer, job.sourceLocation, job.summary,
        CATEGORY_LABELS[job.categoryJobCode], CATEGORY_ALIASES[job.categoryJobCode]].join(' ');
    return marked ? markedWordsOf(text) : wordsOf(text);
}
const hasPhrase = (words, phrase) => ` ${words.join(' ')} `.includes(` ${phrase.join(' ')} `);
// Short words ("it") must match whole words; longer ones may start a word ("react" in "reactjs").
const hasWord = (words, word) => words.some((item) => item === word || (word.length >= 4 && item.startsWith(word)));

function searchExternalJobs({ query = '', location = '' } = {}, { now = Date.now() } = {}) {
    const catalog = loadCatalog();
    if (!catalog) return { jobs: [], total: 0, unknownLocation: false };
    const province = location ? provinceOf(catalog, location) : null;
    if (location && !province) return { jobs: [], total: 0, unknownLocation: true };
    const marked = hasMarks(query);
    const words = (marked ? markedWordsOf(query) : wordsOf(query)).filter((word) => !STOP_WORDS.has(normalize(word)));
    const open = catalog.jobs.filter((job) => isOpen(job, now) && (!province || job.provinceCodes.includes(province)))
        .map((job) => ({ job, words: jobWords(job, marked) }));
    // Prefer the typed phrase; fall back to every word in any order ("lập trình java").
    let matches = words.length ? open.filter((item) => hasPhrase(item.words, words)) : open;
    if (!matches.length) matches = open.filter((item) => words.every((word) => hasWord(item.words, word)));
    // Soonest deadline first so applicants see what closes next; no published deadline last.
    matches.sort((a, b) => (a.job.deadline || '9999').localeCompare(b.job.deadline || '9999'));
    return { jobs: matches.map((item) => externalCard(item.job)), total: matches.length, unknownLocation: false };
}

function externalJobDetails(id, { now = Date.now() } = {}) {
    if (typeof id !== 'string' || !EXTERNAL_ID.test(id)) return null;
    const catalog = loadCatalog();
    const job = catalog?.jobs.find((item) => item.id === id);
    if (!job || !isOpen(job, now)) return null;
    let details = {};
    try { details = readJson('verifiedJobDetails.json').jobs?.[id] || {}; } catch { /* Listing fields are still useful. */ }
    const sections = (Array.isArray(details.sections) ? details.sections : []).slice(0, 5).map((section) =>
        `${clip(section.title, 80)}:\n${(section.items || []).slice(0, 8).map((item) => `- ${clip(item, 320)}`).join('\n')}`);
    const facts = (Array.isArray(details.facts) ? details.facts : []).slice(0, 10)
        .map((fact) => `${clip(fact.label, 60)}: ${clip(fact.value, 160)}`);
    const intro = typeof details.companyIntro === 'string' ? `Giới thiệu doanh nghiệp: ${clip(details.companyIntro, 500)}` : '';
    const description = [clip(job.summary, 600), ...facts, ...sections, intro].filter(Boolean).join('\n\n');
    return {
        ...externalCard(job),
        ...(job.quantity ? { quantity: clip(job.quantity, 40) } : {}),
        sourceName: clip(job.sourceName, 120),
        description: description.slice(0, 6000),
        descriptionTruncated: description.length > 6000,
        note: 'Tin tổng hợp từ trang tuyển dụng chính thức của doanh nghiệp; ứng viên nộp hồ sơ tại trang gốc qua nút trên trang chi tiết.'
    };
}

// Counts for market questions ("công ty nào tuyển nhiều", "Đà Nẵng có bao nhiêu việc").
function externalOverview({ location = '' } = {}, { now = Date.now() } = {}) {
    const catalog = loadCatalog();
    if (!catalog) return { jobs: [], unknownLocation: false };
    const province = location ? provinceOf(catalog, location) : null;
    if (location && !province) return { jobs: [], unknownLocation: true };
    return {
        jobs: catalog.jobs.filter((job) => isOpen(job, now) && (!province || job.provinceCodes.includes(province)))
            .map((job) => ({ provinces: job.provinceCodes, employer: job.employer, category: CATEGORY_LABELS[job.categoryJobCode] || null })),
        unknownLocation: false
    };
}

module.exports = { searchExternalJobs, externalJobDetails, externalOverview, canonicalLocation, EXTERNAL_ID, normalize };
