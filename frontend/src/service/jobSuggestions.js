import { suggestJobs } from './aiSearchService';
import { filterExternalJobs, getExternalJob, isExternalJobExpired } from './externalJobs';

const MAX_SUGGESTIONS = 8;
const normalize = value => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
const text = value => typeof value === 'string' ? value.trim() : '';

// Suggestions search all public vacancies, just like the existing native
// autocomplete. Each row points to a vacancy rather than another text search.
export const loadJobSuggestions = async keyword => {
    const query = text(keyword).replace(/\s+/g, ' ');
    if (query.length < 2) return { data: [], unavailable: false };

    const words = normalize(query).split(/\s+/).filter(Boolean);
    const external = filterExternalJobs({ search: query }).flatMap(candidate => {
        // Resolve the checked-in entry before deriving a route or display text.
        const job = typeof candidate?.id === 'string' && /^external-[a-z0-9-]+$/.test(candidate.id)
            ? getExternalJob(candidate.id) : null;
        if (!job || isExternalJobExpired(job) || !text(job.title)
            || !words.every(word => normalize(job.title).includes(word))) return [];
        return [{ id: job.id, name: job.title, companyName: text(job.employer),
            addressText: job.provinceCodes.filter(value => typeof value === 'string').join(', '),
            detailPath: `/external-job/${encodeURIComponent(job.id)}`, listingSource: 'external' }];
    });

    let native = [];
    let unavailable = false;
    try {
        const response = await suggestJobs(query);
        if (response?.errCode !== 0 || response.httpStatus >= 400 || !Array.isArray(response.data)) {
            unavailable = true;
        } else {
            native = response.data.flatMap(job => {
                if (!Number.isSafeInteger(job?.id) || job.id <= 0 || !text(job.name)) return [];
                return [{ id: job.id, name: text(job.name), companyName: text(job.companyName),
                    addressText: text(job.addressCode), detailPath: `/detail-job/${job.id}`, listingSource: 'native' }];
            });
        }
    } catch {
        unavailable = true;
    }

    const seen = new Set();
    const data = [...external, ...native].filter(job => {
        if (seen.has(job.id)) return false;
        seen.add(job.id);
        return true;
    }).slice(0, MAX_SUGGESTIONS);
    return { data, unavailable };
};
