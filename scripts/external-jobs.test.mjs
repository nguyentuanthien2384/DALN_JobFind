import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanItem, isoDates, lastDate, normalizeSalary, normalizeQuantity, sentenceCase, splitSections, summaryFrom, valueAfter, LIMITS } from './external-jobs/extract.mjs';
import { SITES, siteFor } from './external-jobs/sites.mjs';
import { mergeVacancy } from './sync-external-jobs.mjs';
import { categoryOf, experienceOf, levelOf, provinceFromAddress, provincesFromList, salaryCodeOf, workTypeOf } from './external-jobs/classify.mjs';
import { buildVacancy, vacancyId } from './discover-external-jobs.mjs';
import { splitCatalog } from './external-jobs/catalog-io.mjs';

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

test('workplaces map to current provinces, including unaccented, former and city names', () => {
    assert.deepEqual(provincesFromList('Lam Dong, Quang Ngai, Quang Ninh, Gia Lai'), ['Lâm Đồng', 'Quảng Ngãi', 'Quảng Ninh', 'Gia Lai']);
    assert.deepEqual(provincesFromList('Vung Tau, Tay Ninh, Binh Duong - Ho Chi Minh'), ['Hồ Chí Minh', 'Tây Ninh']);
    assert.deepEqual(provincesFromList('Bến Tre'), ['Vĩnh Long']);
    assert.deepEqual(provincesFromList('Hà Nội/Quảng Ninh'), ['Hà Nội', 'Quảng Ninh']);
    assert.equal(provincesFromList('Toàn Quốc'), null);
    assert.equal(provincesFromList('Hà Nội, Nơi nào đó'), null);
    assert.equal(provinceFromAddress('77 Trần Hưng Đạo, Đoàn Kết, TP Lai Châu, Lai Châu'), 'Lai Châu');
});

test('filter codes come only from explicit source wording', () => {
    assert.equal(categoryOf('Kỹ sư DataOps'), 'cong-nghe-thong-tin');
    assert.equal(categoryOf('Category Procurement Specialist (IT/HR/ Legal)'), 'kinh-te');
    assert.equal(categoryOf('[Sóc Trăng] Nhân viên cửa hàng'), null);
    assert.equal(categoryOf('Giảng viên Luật'), 'giao-vien');
    assert.equal(levelOf('Customer Services Senior Officer'), 'chuyen-vien-cao-cap');
    assert.equal(levelOf('Kỹ sư lập trình'), null);
    assert.equal(workTypeOf('Toàn thời gian'), 'fulltime');
    assert.equal(workTypeOf('Part-time & Full-time'), null);
    assert.equal(salaryCodeOf('10 - 15 Triệu'), '10-15tr');
    assert.equal(salaryCodeOf('6.000.000 - 9.000.000 VNĐ'), null);
    assert.equal(salaryCodeOf('Thương lượng'), 'thoa-thuan');
    assert.equal(experienceOf('Không yêu cầu kinh nghiệm'), 'khong-yeu-cau');
    assert.equal(experienceOf(null, ['Tối thiểu 1 năm kinh nghiệm với Oracle']), '1-nam');
    assert.equal(experienceOf(null, ['Từ 3-5 năm kinh nghiệm']), null);
});

const discoverSite = { key: 'test', media: { logo: { file: 'logos/a.png' }, cover: null }, profile: { employer: 'Doanh nghiệp', sourceName: 'Nguồn' } };
const page = { title: 'Nhân viên kinh doanh', deadline: '2026-10-31', location: { text: 'Hà Nội', provinces: ['Hà Nội'] }, facts: [],
    workTypeText: 'Toàn thời gian', salaryText: 'Thỏa thuận',
    sections: [{ title: 'Mô tả công việc', items: ['Tư vấn giải pháp cho khách hàng doanh nghiệp'], truncated: false }] };

test('a discovered page becomes an open vacancy with a stable id and conservative codes', () => {
    const url = 'https://careers.example.test/jobs/1';
    const { job } = buildVacancy({ site: discoverSite, url, result: page, today: '2026-09-30' });
    assert.equal(job.id, vacancyId(url));
    assert.match(job.id, /^external-[0-9a-f]{12}$/);
    assert.deepEqual([job.categoryJobCode, job.categoryJoblevelCode, job.categoryWorktypeCode, job.salaryJobCode],
        ['kinh-te', 'nhan-vien', 'fulltime', 'thoa-thuan']);
    assert.equal(job.employer, 'Doanh nghiệp');
    assert.equal(job.sourceStatus, 'open');
    assert.equal(job.summary, 'Tư vấn giải pháp cho khách hàng doanh nghiệp');
});

test('pages without a deadline, a mappable workplace or a description are not added', () => {
    const skip = result => buildVacancy({ site: discoverSite, url: 'https://careers.example.test/jobs/2', result, today: '2026-09-30' }).reason;
    assert.match(skip({ ...page, deadline: null }), /deadline/);
    assert.match(skip({ ...page, deadline: '2026-09-01' }), /deadline passed/);
    assert.match(skip({ ...page, location: { text: 'Toàn quốc', provinces: null } }), /not mappable/);
    assert.match(skip({ ...page, sections: [{ title: 'Phúc lợi', items: ['Thưởng tháng 13'], truncated: false }] }), /no job description/);
});

test('the catalogue splits into a light index and a lazily loaded detail file', () => {
    const { index, details } = splitCatalog({ version: 'v', jobs: [{ id: 'external-a', title: 'A', sections: [{ title: 'S', items: ['x'], truncated: false }], facts: [] }] });
    assert.deepEqual(index.jobs, [{ id: 'external-a', title: 'A' }]);
    assert.deepEqual(details, { version: 'v', jobs: { 'external-a': { sections: [{ title: 'S', items: ['x'], truncated: false }], facts: [] } } });
});
