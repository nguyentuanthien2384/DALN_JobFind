import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanItem, isoDates, lastDate, normalizeSalary, normalizeQuantity, sentenceCase, splitSections, summaryFrom, valueAfter, LIMITS } from './external-jobs/extract.mjs';
import { SITES, siteFor } from './external-jobs/sites.mjs';
import { mergeVacancy } from './sync-external-jobs.mjs';

test('dates are read in Vietnamese day-first order and invalid dates are ignored', () => {
    assert.deepEqual(isoDates('Hạn nộp hồ sơ: 22/08 — 30/11/2026'), ['2026-11-30']);
    assert.equal(lastDate('Ngày đăng - Ngày hết hạn: 18/09/2026 - 31/12/2026'), '2026-12-31');
    assert.equal(lastDate('30-09-2026'), '2026-09-30');
    assert.equal(lastDate('31/02/2026'), null);
});

test('labelled values are found on the same line or the next one', () => {
    const lines = ['Số lượng: 4', 'Hạn nộp hồ sơ', '08/10/2026'];
    assert.equal(valueAfter(lines, /^Số lượng/i), '4');
    assert.equal(valueAfter(lines, /^Hạn nộp hồ sơ$/i), '08/10/2026');
    assert.equal(valueAfter(lines, /^Mức lương/i), null);
});

test('sections keep the source headings, drop contact details and cap long lists', () => {
    const lines = ['Regular Crew Leader', 'YÊU CẦU CÔNG VIỆC', '- Tốt nghiệp THPT', '📍 Quyền lợi dành cho bạn:',
        '• Thu nhập đến 28k/giờ', 'Hotline tuyển dụng: 090 248 1533', 'Email: hr@example.test',
        'Liên hệ', 'Ms Hạnh 0905 786 896', ...Array.from({ length: LIMITS.items + 2 }, (_, i) => `Mục ${i}`)];
    const sections = splitSections(lines);
    assert.deepEqual(sections.map(section => section.title), ['Mô tả công việc', 'Yêu cầu công việc', 'Quyền lợi dành cho bạn']);
    assert.deepEqual(sections[1].items, ['Tốt nghiệp THPT']);
    assert.deepEqual(sections[2].items, ['Thu nhập đến 28k/giờ']);
    assert.ok(sections.every(section => section.items.every(item => !/090|@|0905/.test(item))));
});

test('long sections are capped and flagged so the page links to the full source', () => {
    const lines = ['Mô tả công việc', ...Array.from({ length: LIMITS.items + 3 }, (_, i) => `Nhiệm vụ số ${i}`)];
    const [section] = splitSections(lines);
    assert.equal(section.items.length, LIMITS.items);
    assert.equal(section.truncated, true);
});

test('bilingual lines merge, shouting sub-headings become labels, compounds are not split', () => {
    const [section] = splitSections(['Key Accountabilities', 'Report daily sales to RD.', '(Báo cáo kết quả hàng ngày cho RD)',
        'THU NHẬP', '- Lương cứng', '- Kinh tế - Luật là ngành phù hợp.', '- Có kinh nghiệm. - Có năng lực giảng dạy']);
    assert.deepEqual(section.items, ['Report daily sales to RD. (Báo cáo kết quả hàng ngày cho RD)', 'Thu nhập:', 'Lương cứng',
        'Kinh tế - Luật là ngành phù hợp.', 'Có kinh nghiệm.', 'Có năng lực giảng dạy']);
    assert.equal(sentenceCase('MÔ TẢ CÔNG VIỆC'), 'Mô tả công việc');
    assert.equal(cleanItem('Nhập thông tin để xem phúc lợi'), null);
});

test('salary, head count and summary keep the source wording', () => {
    assert.equal(normalizeSalary('Lương: Thỏa Thuận'), 'Thỏa thuận');
    assert.equal(normalizeSalary('Thương lượng'), 'Thương lượng');
    assert.equal(normalizeSalary('Nhập thông tin để xem lương'), null);
    assert.equal(normalizeQuantity('Số lượng: 4'), '4');
    assert.equal(normalizeQuantity('0'), null);
    assert.equal(summaryFrom([{ title: 'Mô tả', items: ['Vai trò:', 'Tư vấn sản phẩm cho khách hàng tại cửa hàng'] }]),
        'Tư vấn sản phẩm cho khách hàng tại cửa hàng');
});

test('every source host has one extractor', () => {
    const hosts = SITES.flatMap(site => site.hosts);
    assert.equal(new Set(hosts).size, hosts.length);
    assert.equal(siteFor('https://tuyendung.vnpt.vn/tim-viec-lam/x.html').key, 'vnpt');
    assert.equal(siteFor('https://unknown.example.test/job'), null);
});

const job = { id: 'external-test', title: 'Tiêu đề cũ', deadline: '2026-09-30', salaryText: null, summary: 'Tóm tắt cũ',
    responsibilities: ['Diễn giải'], requirements: ['Diễn giải'], sourceStatus: 'open', checkedAt: '2026-09-29' };
const site = { media: { logo: { file: 'logos/a.png' }, cover: null } };

test('a sync replaces paraphrases with source facts and keeps curated fields', () => {
    const { job: next, changes } = mergeVacancy(job, { title: 'Tiêu đề nguồn', deadline: '2026-10-31', quantity: '4', facts: [],
        sections: [{ title: 'Mô tả công việc', items: ['Làm việc với khách hàng doanh nghiệp'], truncated: false }] },
    { today: '2026-09-30', site, override: {} });
    assert.equal(next.title, 'Tiêu đề nguồn');
    assert.equal(next.deadline, '2026-10-31');
    assert.equal(next.summary, 'Làm việc với khách hàng doanh nghiệp');
    assert.equal(next.logo, '/external-jobs/logos/a.png');
    assert.equal(next.sourceStatus, 'open');
    assert.equal(next.checkedAt, '2026-09-30');
    assert.ok(!('responsibilities' in next) && !('requirements' in next));
    assert.ok(changes.includes('deadline'));
});

test('overrides keep a more specific title and drop campaign-wide head counts', () => {
    const { job: next } = mergeVacancy(job, { title: 'Thông báo chung', quantity: '744', facts: [], sections: [{ title: 'A', items: ['Nội dung đủ dài để tóm tắt'], truncated: false }] },
        { today: '2026-09-30', site, override: { keepTitle: true, omit: ['quantity'], facts: [{ label: 'Chỉ tiêu', value: '5' }] } });
    assert.equal(next.title, 'Tiêu đề cũ');
    assert.equal(next.quantity ?? null, null);
    assert.deepEqual(next.facts, [{ label: 'Chỉ tiêu', value: '5' }]);
});

test('a missing source page or a passed deadline takes the vacancy out of listings', () => {
    assert.equal(mergeVacancy(job, {}, { today: '2026-09-30', site, status: 'removed' }).job.sourceStatus, 'removed');
    const closed = mergeVacancy(job, { deadline: '2026-09-15', facts: [], sections: [{ title: 'A', items: ['Nội dung đủ dài để tóm tắt'], truncated: false }] },
        { today: '2026-09-30', site, override: {} }).job;
    assert.equal(closed.sourceStatus, 'closed');
});
