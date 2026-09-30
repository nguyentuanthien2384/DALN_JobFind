import catalog from '../data/verifiedJobs.json';

// The source's deadline is a calendar date in Vietnam, inclusive through that day.
export const vietnamDate = (now = new Date()) => new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
export const externalCatalogVersion = catalog.version;
export const isExternalJobExpired = (job, now = new Date()) => Boolean(job?.deadline && job.deadline < vietnamDate(now));
// "removed": the source page no longer exists; "closed": the source's own deadline had passed when checked.
export const isExternalJobWithdrawn = job => job?.sourceStatus === 'removed' || job?.sourceStatus === 'closed';
export const externalJobCard = job => ({ ...job, listingSource: 'external' });
export const getExternalJob = id => catalog.jobs.find(job => job.id === id);
// Source excerpts (sections, facts, company intro, job image) live in a separate chunk that only
// the detail page downloads; search and cards use the index above.
let detailsRequest;
export const loadExternalJobDetails = id => {
    detailsRequest ||= import('../data/verifiedJobDetails.json').then(module => module.default?.jobs || module.jobs || {})
        .catch(error => { detailsRequest = undefined; throw error; });
    return detailsRequest.then(jobs => jobs[id] || {});
};
// Logos and banners are copies of the source's own images served from /public/external-jobs.
export const externalAssetUrl = path => (typeof path === 'string' && /^\/external-jobs\/[\w./-]+$/.test(path) && !path.includes('..')
    ? `${process.env.PUBLIC_URL || ''}${path}` : null);

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const provinceNames = new Map(catalog.provinces.flatMap(province =>
    [province.code, ...province.previousNames].map(name => [normalize(name), province.code])));
const provinceCode = value => provinceNames.get(normalize(value).replace(/^(tinh|thanh pho|tp\.?)\s+/, '')) || value;
const selections = value => (Array.isArray(value) ? value : [value]).filter(value => typeof value === 'string' && value.length > 0);
const filterFields = ['categoryJobCode', 'categoryWorktypeCode', 'categoryJoblevelCode', 'experienceJobCode', 'salaryJobCode'];

export const filterExternalJobs = (params = {}, now = new Date(), jobs = catalog.jobs) => {
    const locations = selections(params.addressCode).map(provinceCode);
    const words = normalize(params.search).split(/\s+/).filter(Boolean);
    return jobs.filter(job => {
        if (isExternalJobWithdrawn(job) || isExternalJobExpired(job, now)) return false;
        if (locations.length && !locations.some(location => job.provinceCodes.includes(location))) return false;
        if (filterFields.some(field => {
            const selected = selections(params[field]);
            return selected.length && !selected.includes(job[field]);
        })) return false;
        const text = normalize([job.title, job.employer, job.sourceLocation, ...job.provinceCodes, job.summary].join(' '));
        return words.every(word => text.includes(word));
    });
};
