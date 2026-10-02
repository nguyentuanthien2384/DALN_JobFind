const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { searchJobs, getJobDetails, jobMarketOverview, executeSupportTool, positiveId } = require('../../src/services/supportJobTools');
const externalCatalog = require('../../src/services/supportExternalJobs');
const Op = { gte: Symbol('gte'), like: Symbol('like') };
// Internal-only tests must not depend on the real external catalogue.
const noExternal = { canonicalLocation: (value) => value, searchExternalJobs: () => ({ jobs: [], total: 0, unknownLocation: false }),
    externalJobDetails: () => null, externalOverview: () => ({ jobs: [], unknownLocation: false }) };
const row = (id, overrides = {}) => ({
    id, timeEnd: '1900000000000',
    postDetailData: { name: `Lập trình viên ${id}`, descriptionMarkdown: '<p>mô tả</p>',
        salaryTypePostData: { value: 'Thỏa thuận' }, provincePostData: { value: 'Hà Nội' },
        workTypePostData: { value: 'Toàn thời gian' } },
    userPostData: { userCompanyData: { name: 'Doanh nghiệp đã duyệt' } }, ...overrides
});
test('search returns bounded public, active, approved jobs and only whitelisted fields', async () => {
    let options;
    const database = { Post: { findAll: async (query) => { options = query; return [row(1), row(2, { timeEnd: '100' }), row(3)]; } },
        DetailPost: {}, User: {}, Account: {}, Company: {}, Allcode: {} };
    const result = await searchJobs({ query: 'React', location: 'Hà Nội' }, { database, operators: Op, now: 1700000000000, external: noExternal });
    assert.deepEqual(result.jobs.map((job) => job.id), [1, 3]);
    assert.equal(result.jobs[0].url, '/detail-job/1');
    assert.equal(result.jobs[0].description, undefined);
    assert.equal(result.jobs[1].description, undefined);
    assert.equal(result.jobs[0].file, undefined);
    assert.equal(options.where.statusCode, 'PS1');
    assert.equal(options.where.timeEnd[Op.gte], '1700000000000');
    assert.equal(options.limit, 20);
    assert.equal(options.include[1].include[0].where.statusCode, 'S1');
    assert.equal(options.include[1].include[1].where.censorCode, 'CS1');
    assert.equal(options.include[0].include[1].where.value[Op.like], '%Hà Nội%');
    assert.equal(options.include[0].where.name[Op.like], '%React%');
});
test('detail is read-only, rejects invalid/nonpublic IDs and sanitizes descriptions', async () => {
    let options;
    const database = { Post: { findOne: async (query) => { options = query; return row(9); } },
        DetailPost: {}, User: {}, Account: {}, Company: {}, Allcode: {} };
    assert.equal(positiveId('1; DROP TABLE Post'), null);
    assert.equal(positiveId(true), null);
    assert.equal(positiveId([9]), null);
    assert.deepEqual(await getJobDetails({ job_id: -7 }, { database, operators: Op }), { error: 'ID tin tuyển dụng không hợp lệ.' });
    assert.equal((await getJobDetails({ job_id: '9' }, { database, operators: Op, now: 1700000000000 })).job.description, ' mô tả ' .trim());
    assert.equal(options.where.id, 9);
    assert.equal(options.where.statusCode, 'PS1');
    const missing = { ...database, Post: { findOne: async () => null } };
    assert.match((await getJobDetails({ job_id: 2 }, { database: missing, operators: Op })).error, /Không tìm thấy/);
});
test('never executes arbitrary tool names or oversized search query', async () => {
    assert.deepEqual(await executeSupportTool('delete_user', { id: 1 }), { error: 'Công cụ không được cấp quyền.' });
    await assert.rejects(searchJobs({ query: 'a'.repeat(121) }, { database: {}, operators: Op }), /không hợp lệ/);
});

const externalJob = (id, overrides = {}) => ({ id: `external-${id}`, title: `Kỹ sư ${id}`, employer: 'Doanh nghiệp nguồn', provinceCodes: ['Hồ Chí Minh'],
    sourceLocation: 'Hồ Chí Minh', salaryText: null, deadline: '2026-10-10', sourceStatus: 'open', summary: 'Mô tả ngắn', categoryJobCode: null,
    logo: '/external-jobs/logos/a.png', sourceUrl: 'https://example.com/job', ...overrides });
const withCatalog = (jobs, details = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobfind-catalog-'));
    fs.writeFileSync(path.join(dir, 'verifiedJobs.json'), JSON.stringify({ version: 't', provinces: [
        { code: 'Hà Nội', value: 'Hà Nội', previousNames: [] }, { code: 'Hồ Chí Minh', value: 'Hồ Chí Minh', previousNames: [] },
        { code: 'Tuyên Quang', value: 'Tuyên Quang', previousNames: ['Hà Giang'] }], jobs }));
    fs.writeFileSync(path.join(dir, 'verifiedJobDetails.json'), JSON.stringify({ jobs: details }));
    process.env.VERIFIED_JOBS_DIR = dir;
};
afterEach(() => { delete process.env.VERIFIED_JOBS_DIR; });
const october = Date.parse('2026-10-02T03:00:00Z');

test('search lists internal posts first, then external ones, capped at five with the full total', async () => {
    const database = { Post: { findAll: async () => [row(1), row(2)] }, DetailPost: {}, User: {}, Account: {}, Company: {}, Allcode: {} };
    const outside = { ...noExternal, searchExternalJobs: () => ({ jobs: [1, 2, 3, 4].map((id) => ({ id: `external-00000${id}`, source: 'external' })), total: 9, unknownLocation: false }) };
    const result = await searchJobs({ query: '' }, { database, operators: Op, now: 1700000000000, external: outside });
    assert.deepEqual(result.jobs.map((job) => job.id), [1, 2, 'external-000001', 'external-000002', 'external-000003']);
    assert.equal(result.total, 11);
    assert.equal(result.jobs[0].source, 'jobfind');
    assert.match(result.note, /Có 11 tin/);
});
test('external search matches whole short words, location aliases, and skips closed or expired jobs', () => {
    withCatalog([
        externalJob('a00001', { title: 'Lập trình viên Java', categoryJobCode: 'cong-nghe-thong-tin' }),
        externalJob('a00002', { title: 'Digital marketing' }),
        externalJob('a00003', { title: 'Lập trình viên PHP', deadline: '2026-10-01', categoryJobCode: 'cong-nghe-thong-tin' }),
        externalJob('a00004', { title: 'Lập trình viên Go', sourceStatus: 'removed', categoryJobCode: 'cong-nghe-thong-tin' }),
        externalJob('a00005', { title: 'Lập trình viên Python', provinceCodes: ['Hà Nội'], sourceLocation: 'Hà Nội', categoryJobCode: 'cong-nghe-thong-tin' })
    ]);
    const it = externalCatalog.searchExternalJobs({ query: 'việc IT' }, { now: october });
    assert.deepEqual(it.jobs.map((job) => job.id), ['external-a00001', 'external-a00005']);
    const saigon = externalCatalog.searchExternalJobs({ query: 'lập trình', location: 'TP. Sài Gòn' }, { now: october });
    assert.deepEqual(saigon.jobs.map((job) => job.id), ['external-a00001']);
    assert.deepEqual(saigon.jobs[0], { id: 'external-a00001', name: 'Lập trình viên Java', company: 'Doanh nghiệp nguồn', location: 'Hồ Chí Minh',
        salary: 'Chưa công bố', workType: '', deadline: '2026-10-10', logo: '/external-jobs/logos/a.png', source: 'external', url: '/external-job/external-a00001' });
    assert.equal(externalCatalog.canonicalLocation('hcm'), 'Hồ Chí Minh');
    assert.equal(externalCatalog.canonicalLocation('Hà Giang'), 'Tuyên Quang');
    assert.equal(externalCatalog.searchExternalJobs({ location: 'Atlantis' }, { now: october }).unknownLocation, true);
});
test('external details expose reviewed excerpts only and reject unknown or malformed IDs', async () => {
    withCatalog([externalJob('b00001', { quantity: '3' })], { 'external-b00001': {
        sections: [{ title: 'Yêu cầu', items: ['Tốt nghiệp đại học'] }], facts: [{ label: 'Ngành nghề', value: 'Quản lí' }], companyIntro: 'Doanh nghiệp lớn.' } });
    const { job } = await getJobDetails({ job_id: 'external-b00001' }, { database: {}, operators: Op, now: october });
    assert.match(job.description, /Yêu cầu:\n- Tốt nghiệp đại học/);
    assert.match(job.description, /Ngành nghề: Quản lí/);
    assert.equal(job.quantity, '3');
    assert.equal(job.sourceUrl, undefined);
    assert.match((await getJobDetails({ job_id: 'external-zzz' }, { database: {}, operators: Op, now: october })).error, /Không tìm thấy/);
    assert.match((await getJobDetails({ job_id: 'external-c00009' }, { database: {}, operators: Op, now: october })).error, /Không tìm thấy/);
});
test('a missing external catalogue leaves internal search working', async () => {
    process.env.VERIFIED_JOBS_DIR = path.join(os.tmpdir(), 'jobfind-catalog-missing');
    const database = { Post: { findAll: async () => [row(4)] }, DetailPost: {}, User: {}, Account: {}, Company: {}, Allcode: {} };
    const result = await searchJobs({ query: 'React' }, { database, operators: Op, now: 1700000000000 });
    assert.deepEqual(result.jobs.map((job) => job.id), [4]);
});
test('market overview returns aggregate counts only', async () => {
    withCatalog([externalJob('d00001', { categoryJobCode: 'kinh-te' }), externalJob('d00002', { employer: 'Công ty B', provinceCodes: ['Hà Nội', 'Hồ Chí Minh'] })]);
    const database = { Post: { findAll: async () => [row(5)] }, DetailPost: {}, User: {}, Account: {}, Company: {}, Allcode: {} };
    const result = await executeSupportTool('job_market_overview', {}, { database, operators: Op, now: october });
    assert.equal(result.total, 3);
    assert.deepEqual(result.topLocations, [{ name: 'Hà Nội', count: 2 }, { name: 'Hồ Chí Minh', count: 2 }]);
    assert.deepEqual(result.topEmployers.map((item) => item.name), ['Công ty B', 'Doanh nghiệp đã duyệt', 'Doanh nghiệp nguồn']);
    assert.deepEqual(result.topCategories, [{ name: 'Kinh tế', count: 1 }]);
    assert.equal(JSON.stringify(result).includes('external-'), false);
    const hanoi = await jobMarketOverview({ location: 'HN' }, { database: { ...database, Post: { findAll: async () => [] } }, operators: Op, now: october });
    assert.deepEqual([hanoi.location, hanoi.total], ['Hà Nội', 1]);
});
