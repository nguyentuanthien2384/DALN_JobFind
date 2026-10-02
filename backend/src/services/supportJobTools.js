// Whitelisted, read-only tools. Nothing here returns applicants, CVs, emails or private jobs.
// Queries run against the same legacy MySQL models as the public JobFind pages, plus the
// reviewed external catalogue that /job also lists (see supportExternalJobs.js).
const getDatabase = () => require('../models');
const getOperators = () => require('sequelize').Op;
const external = require('./supportExternalJobs');

const MAX_RESULTS = 5;
const DECLARATIONS = [
    {
        name: 'search_jobs',
        description: 'Tìm các tin tuyển dụng đang mở, đã được duyệt trên JobFind. Sử dụng khi người dùng hỏi tìm việc, việc đang tuyển, mức lương hoặc địa điểm. Không tự bịa tin tuyển dụng.',
        parameters: {
            type: 'OBJECT',
            properties: {
                query: { type: 'STRING', description: 'Từ khóa trong tên việc làm, ví dụ React, kế toán, thực tập. Nếu người dùng chỉ hỏi các việc mới thì để trống.' },
                location: { type: 'STRING', description: 'Tên tỉnh/thành cần tìm, ví dụ Hà Nội; để trống nếu không nêu địa điểm.' }
            }
        }
    },
    {
        name: 'get_job_details',
        description: 'Đọc thông tin công khai của một tin tuyển dụng JobFind theo ID số nguyên, ví dụ 123. Chỉ gọi khi biết ID.',
        parameters: { type: 'OBJECT', properties: { job_id: { type: 'INTEGER', description: 'ID tin tuyển dụng trong JobFind' } }, required: ['job_id'] }
    }
];

const cleanKeyword = (value) => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > 120) throw new Error('Từ khóa tìm kiếm không hợp lệ.');
    return value.trim().replace(/[%_\\]/g, '').slice(0, 70);
};
const positiveId = (value) => {
    if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
};
const publicIncludes = (query, location, db, Op) => [{
    model: db.DetailPost, as: 'postDetailData', required: true,
    attributes: ['name', 'descriptionMarkdown', 'salaryJobCode', 'addressCode', 'amount', 'categoryWorktypeCode'],
    ...(query ? { where: { name: { [Op.like]: `%${query}%` } } } : {}),
    include: [
        { model: db.Allcode, as: 'salaryTypePostData', required: false, attributes: ['value'] },
        { model: db.Allcode, as: 'provincePostData', required: Boolean(location), attributes: ['value'],
            ...(location ? { where: { value: { [Op.like]: `%${location}%` } } } : {}) },
        { model: db.Allcode, as: 'workTypePostData', required: false, attributes: ['value'] }
    ]
}, {
    model: db.User, as: 'userPostData', required: true, attributes: ['id'],
    include: [
        { model: db.Account, as: 'userAccountData', required: true,
            attributes: [], where: { statusCode: 'S1' } },
        { model: db.Company, as: 'userCompanyData', required: true,
            attributes: ['name'], where: { statusCode: 'S1', censorCode: 'CS1' } }
    ]
}];

const safeJob = (row, details = false) => {
    const data = row.postDetailData || {};
    const owner = row.userPostData || {};
    const result = {
        id: row.id,
        name: String(data.name || '').slice(0, 180),
        company: String(owner.userCompanyData?.name || '').slice(0, 120),
        location: String(data.provincePostData?.value || '').slice(0, 80),
        salary: String(data.salaryTypePostData?.value || 'Chưa công bố').slice(0, 80),
        workType: String(data.workTypePostData?.value || '').slice(0, 80),
        // timeEnd is the last open millisecond; show it as a Vietnamese calendar date.
        deadline: new Date(Number(row.timeEnd) + 7 * 3600000).toISOString().slice(0, 10),
        source: 'jobfind',
        url: `/detail-job/${row.id}`
    };
    if (details) {
        const description = String(data.descriptionMarkdown || '')
            .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        result.description = description.slice(0, 6000);
        result.descriptionTruncated = description.length > 6000;
    }
    return result;
};
const isOpen = (row, now) => Number.isFinite(Number(row.timeEnd)) && Number(row.timeEnd) >= now;
const externalSource = (context) => context.external || external;

async function searchJobs(args = {}, context = {}) {
    const database = context.database || getDatabase();
    const Op = context.operators || getOperators();
    const now = context.now === undefined ? Date.now() : context.now;
    const source = externalSource(context);
    const query = cleanKeyword(args.query);
    const location = cleanKeyword(args.location);
    // "Sài Gòn"/"HCM" become the province name both catalogues store.
    const province = location ? source.canonicalLocation(location) : '';
    const rows = await database.Post.findAll({
        where: { statusCode: 'PS1', timeEnd: { [Op.gte]: String(now) } },
        attributes: ['id', 'timeEnd'], include: publicIncludes(query, province, database, Op),
        order: [['timePost', 'DESC']], limit: 20, raw: true, nest: true
    });
    const internal = rows.filter((row) => isOpen(row, now)).map((row) => safeJob(row));
    const outside = source.searchExternalJobs({ query, location: province }, { now });
    const jobs = [...internal, ...outside.jobs].slice(0, MAX_RESULTS);
    const total = internal.length + outside.total;
    let note = jobs.length
        ? `Có ${total} tin đang mở phù hợp; thẻ tin hiển thị ${jobs.length} tin đầu. Tin source=external được tổng hợp từ trang tuyển dụng chính thức của doanh nghiệp, ứng viên nộp hồ sơ tại trang gốc.`
        : 'Chưa tìm thấy tin đang mở phù hợp.';
    if (!jobs.length && outside.unknownLocation) note += ` Không nhận ra tỉnh/thành "${location}".`;
    return { jobs, count: jobs.length, total, note };
}
async function getJobDetails(args = {}, context = {}) {
    const database = context.database || getDatabase();
    const Op = context.operators || getOperators();
    const now = context.now === undefined ? Date.now() : context.now;
    if (typeof args.job_id === 'string' && args.job_id.startsWith('external-')) {
        const job = externalSource(context).externalJobDetails(args.job_id, { now });
        return job ? { job } : { error: 'Không tìm thấy tin tuyển dụng công khai đang mở.' };
    }
    const id = positiveId(args.job_id);
    if (!id) return { error: 'ID tin tuyển dụng không hợp lệ.' };
    const row = await database.Post.findOne({
        where: { id, statusCode: 'PS1', timeEnd: { [Op.gte]: String(now) } },
        attributes: ['id', 'timeEnd'], include: publicIncludes('', '', database, Op), raw: true, nest: true
    });
    if (!row || !isOpen(row, now)) return { error: 'Không tìm thấy tin tuyển dụng công khai đang mở.' };
    return { job: safeJob(row, true) };
}
const ranking = (values, limit) => [...values.reduce((counts, value) => {
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
}, new Map())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi')).slice(0, limit)
    .map(([name, count]) => ({ name: String(name).slice(0, 120), count }));
// Aggregate counts only: no job, company or applicant record leaves this function.
async function jobMarketOverview(args = {}, context = {}) {
    const database = context.database || getDatabase();
    const Op = context.operators || getOperators();
    const now = context.now === undefined ? Date.now() : context.now;
    const source = externalSource(context);
    const location = cleanKeyword(args.location);
    const province = location ? source.canonicalLocation(location) : '';
    const rows = await database.Post.findAll({
        where: { statusCode: 'PS1', timeEnd: { [Op.gte]: String(now) } },
        attributes: ['id', 'timeEnd'], include: publicIncludes('', province, database, Op),
        limit: 500, raw: true, nest: true
    });
    const internal = rows.filter((row) => isOpen(row, now)).map((row) => safeJob(row));
    const outside = source.externalOverview({ location: province }, { now });
    const total = internal.length + outside.jobs.length;
    return {
        ...(province ? { location: province } : {}),
        total, jobfindPosts: internal.length, externalPosts: outside.jobs.length,
        topLocations: province ? [] : ranking([...internal.map((job) => job.location), ...outside.jobs.flatMap((job) => job.provinces)], 8),
        topEmployers: ranking([...internal.map((job) => job.company), ...outside.jobs.map((job) => job.employer)], 8),
        topCategories: ranking(outside.jobs.map((job) => job.category), 8),
        note: total
            ? 'Số liệu đếm tin đang mở tại thời điểm tra cứu; một tin tuyển nhiều tỉnh được đếm ở mỗi tỉnh trong topLocations. Ngành nghề chỉ có ở tin nguồn ngoài.'
            : `Chưa có tin đang mở${outside.unknownLocation ? ` hoặc không nhận ra tỉnh/thành "${location}"` : ''}.`
    };
}
async function executeSupportTool(name, args, context = {}) {
    if (!args || Array.isArray(args) || typeof args !== 'object') return { error: 'Tham số công cụ không hợp lệ.' };
    if (name === 'search_jobs') return searchJobs(args, context);
    if (name === 'get_job_details') return getJobDetails(args, context);
    if (name === 'job_market_overview') return jobMarketOverview(args, context);
    return { error: 'Công cụ không được cấp quyền.' };
}
const PUBLIC_TOOL_NAMES = ['search_jobs', 'get_job_details', 'job_market_overview'];
module.exports = { DECLARATIONS, PUBLIC_TOOL_NAMES, executeSupportTool, searchJobs, getJobDetails, jobMarketOverview, cleanKeyword, positiveId };
