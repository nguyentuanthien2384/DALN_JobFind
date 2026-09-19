const test = require('node:test');
const assert = require('node:assert/strict');
const { searchJobs, getJobDetails, executeSupportTool, positiveId } = require('../../src/services/supportJobTools');
const Op = { gte: Symbol('gte'), like: Symbol('like') };
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
    const result = await searchJobs({ query: 'React', location: 'Hà Nội' }, { database, operators: Op, now: 1700000000000 });
    assert.deepEqual(result.jobs.map((job) => job.id), [1, 3]);
    assert.equal(result.jobs[0].url, '/detail-job/1');
    assert.equal(result.jobs[0].description, undefined);
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
