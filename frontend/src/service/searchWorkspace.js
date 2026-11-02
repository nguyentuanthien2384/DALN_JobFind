import { searchJobs } from './aiSearchService';
import { getListPostService } from './userService';
import { filterExternalJobs, externalJobCard } from './externalJobs';
import { fetchAllCode, getCachedAllCode } from '../util/fetch';

export const searchMode = () => process.env.REACT_APP_JOB_SEARCH_MODE === 'core' ? 'core' : 'legacy';
const labelTypes = ['JOBLEVEL', 'PROVINCE', 'SALARYTYPE', 'WORKTYPE'];

const toLabelMap = rows =>
    Array.isArray(rows)
        ? Object.fromEntries(
            rows
                .filter(row => typeof row.code === 'string' && typeof row.value === 'string')
                .map(row => [row.code, row.value])
        )
        : {};

export const getCachedSearchLabels = () => {
    const entries = [];
    for (const type of labelTypes) {
        const cached = getCachedAllCode(type);
        if (!Array.isArray(cached)) return null;
        entries.push([type, toLabelMap(cached)]);
    }
    return Object.fromEntries(entries);
};

export const loadSearchLabels = async () => {
    const cached = getCachedSearchLabels();
    if (cached) return cached;
    const entries = await Promise.all(labelTypes.map(async type => {
        try {
            const existing = getCachedAllCode(type);
            if (Array.isArray(existing)) return [type, toLabelMap(existing)];
            const response = await fetchAllCode(type, { retain: true });
            return [type, response?.errCode === 0 && Array.isArray(response.data)
                ? toLabelMap(response.data) : {}];
        } catch { return [type, {}]; }
    }));
    return Object.fromEntries(entries);
};

export const searchCard = (job, labels = {}) => {
    if (!job || !Number.isSafeInteger(job.id) || job.id <= 0 || typeof job.name !== 'string' || job.statusCode !== 'PS1') {
        throw new Error('Dữ liệu tìm kiếm không hợp lệ');
    }
    const label = (type, code) => ({ value: labels[type]?.[code] || code || 'Chưa cập nhật' });
    return { id: job.id, timePost: job.timePost,
        userPostData: { userCompanyData: { name: job.companyName || '', thumbnail: job.companyLogo || '' } },
        postDetailData: { name: job.name, jobLevelPostData: label('JOBLEVEL', job.categoryJoblevelCode),
            provincePostData: label('PROVINCE', job.addressCode), salaryTypePostData: label('SALARYTYPE', job.salaryJobCode),
            workTypePostData: label('WORKTYPE', job.categoryWorktypeCode) } };
};

export const loadSearchPage = async (params, mode, labels, { includeExternal = false } = {}) => {
    // Candidate AI requires native numeric job IDs for its CV workflows.
    // Public search opts in to independently sourced external vacancies.
    const external = includeExternal ? filterExternalJobs(params) : [];
    const offset = Number(params.offset) || 0;
    const limit = Number(params.limit) || 5;
    const { search, sortName, ...filters } = params;
    const searchPromise = mode === 'core'
        ? searchJobs({ ...filters, q: search, sort: 'relevance' })
        : getListPostService(params);
    const [response, resolvedLabels] = await Promise.all([
        searchPromise,
        Promise.resolve(labels || {}),
    ]);
    if (response?.errCode !== 0 || response.httpStatus >= 400 || !Array.isArray(response.data)
        || !Number.isSafeInteger(response.count) || response.count < 0) {
        throw new Error(response?.errMessage || 'Không tải được kết quả tìm kiếm. Vui lòng thử lại.');
    }
    const native = mode === 'core' ? response.data.map(job => searchCard(job, resolvedLabels)) : response.data;
    // JobFind vacancies (the ones candidates can apply to here) lead; external ones form one
    // stable suffix after the last native result, so pages never repeat or skip a job.
    const externalPage = external.slice(Math.max(0, offset - response.count), Math.max(0, offset + limit - response.count));
    return { count: response.count + external.length, data: [...native, ...externalPage.map(externalJobCard)] };
};
