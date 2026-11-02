import { PAGINATION } from '../../util/constant';
import { getCachedSearchLabels, loadSearchLabels, loadSearchPage, searchMode } from '../../service/searchWorkspace';
import { preloadAllCode } from '../../util/fetch';
import { getListPostService } from '../../service/userService';
import { searchJobs } from '../../service/aiSearchService';
import { buildJobQuerySnapshotKey, readJobQuerySnapshot, saveJobQuerySnapshot } from './jobSearchHistory';

const FILTER_ALLCODE_TYPES = ['JOBTYPE', 'JOBLEVEL', 'SALARYTYPE', 'EXPTYPE', 'WORKTYPE', 'PROVINCE'];
const pendingPrefetches = new Map();

export const prefetchJobLanding = ({ categoryJobCode = '', search = '' } = {}) => {
    const mode = searchMode();
    if (mode === 'core' && typeof searchJobs !== 'function') return Promise.resolve(null);
    if (mode !== 'core' && typeof getListPostService !== 'function') return Promise.resolve(null);

    preloadAllCode(FILTER_ALLCODE_TYPES);

    const limit = PAGINATION.pagerow;
    const params = {
        limit,
        offset: 0,
        categoryJobCode,
        addressCode: '',
        salaryJobCode: [],
        categoryJoblevelCode: [],
        categoryWorktypeCode: [],
        experienceJobCode: [],
        search,
        sortName: undefined,
    };
    const snapshotKey = buildJobQuerySnapshotKey(params, mode);
    const existing = readJobQuerySnapshot(snapshotKey);
    if (existing) return Promise.resolve(existing);
    if (pendingPrefetches.has(snapshotKey)) return pendingPrefetches.get(snapshotKey);

    const cachedLabels = mode === 'core' ? getCachedSearchLabels() : {};
    const labelsSource = mode === 'core' ? (cachedLabels || loadSearchLabels()) : {};

    const request = Promise.all([
        loadSearchPage(params, mode, labelsSource, { includeExternal: true }),
        Promise.resolve(labelsSource),
    ]).then(([result, resolvedLabels]) => {
        const available = mode === 'core' ? Math.min(result.count, 10000) : result.count;
        const snapshot = {
            post: result.data,
            count: result.count,
            countPage: Math.ceil(available / limit),
            labels: resolvedLabels || {},
            labelsReady: true,
        };
        saveJobQuerySnapshot(snapshotKey, snapshot);
        return snapshot;
    }).catch(() => null).finally(() => {
        if (pendingPrefetches.get(snapshotKey) === request) pendingPrefetches.delete(snapshotKey);
    });

    pendingPrefetches.set(snapshotKey, request);
    return request;
};
