import { searchJobs } from './aiSearchService';
import { getListPostService, getAllCodeService } from './userService';

export const searchMode = () => process.env.REACT_APP_JOB_SEARCH_MODE === 'core' ? 'core' : 'legacy';
const labelTypes = ['JOBLEVEL', 'PROVINCE', 'SALARYTYPE', 'WORKTYPE'];
export const loadSearchLabels = async () => {
    const entries = await Promise.all(labelTypes.map(async type => {
        try {
            const response = await getAllCodeService(type);
            if (response?.errCode !== 0 || response.stale || response.httpStatus >= 400 || !Array.isArray(response.data)) return [type, null];
            return [type, Object.fromEntries(response.data
                .filter(row => typeof row.code === 'string' && typeof row.value === 'string')
                .map(row => [row.code, row.value]).sort(([left], [right]) => left.localeCompare(right)))];
        } catch { return [type, null]; }
    }));
    // Omit failed types so consumers can retain their last successful labels;
    // a successful empty catalog must still replace its previous values.
    return {
        labels: Object.fromEntries(entries.filter(([, values]) => values !== null)),
        failedTypes: entries.filter(([, values]) => values === null).map(([type]) => type),
    };
};
export const searchCard = (job, labels = {}) => {
    if (!job || !Number.isSafeInteger(job.id) || job.id <= 0 || typeof job.name !== 'string' || job.statusCode !== 'PS1') {
        throw new Error('Dữ liệu tìm kiếm không hợp lệ');
    }
    const label = (type, code) => ({ code, value: labels[type]?.[code] || code || 'Chưa cập nhật' });
    return { id: job.id, timePost: job.timePost,
        userPostData: { userCompanyData: { name: job.companyName || '', thumbnail: job.companyLogo || '' } },
        postDetailData: { name: job.name, jobLevelPostData: label('JOBLEVEL', job.categoryJoblevelCode),
            provincePostData: label('PROVINCE', job.addressCode), salaryTypePostData: label('SALARYTYPE', job.salaryJobCode),
            workTypePostData: label('WORKTYPE', job.categoryWorktypeCode) } };
};
export const loadSearchPage = async (params, mode, labels) => {
    const { search, sortName, ...filters } = params;
    const response = mode === 'core'
        ? await searchJobs({ ...filters, q: search, sort: 'relevance' })
        : await getListPostService(params);
    if (response?.errCode !== 0 || response.httpStatus >= 400 || !Array.isArray(response.data)
        || !Number.isSafeInteger(response.count) || response.count < 0) {
        throw new Error(response?.errMessage || 'Không tải được kết quả tìm kiếm. Vui lòng thử lại.');
    }
    return { count: response.count, data: mode === 'core' ? response.data.map(job => searchCard(job, labels)) : response.data };
};
