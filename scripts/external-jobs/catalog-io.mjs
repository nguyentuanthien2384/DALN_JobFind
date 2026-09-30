// The external catalogue is stored as two files so the job search only ships what cards and
// filters need: verifiedJobs.json (index) and verifiedJobDetails.json (source excerpts, loaded
// by the detail page on demand). Scripts always work on the merged form.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const catalogPath = fileURLToPath(new URL('../../frontend/src/data/verifiedJobs.json', import.meta.url));
export const detailsPath = fileURLToPath(new URL('../../frontend/src/data/verifiedJobDetails.json', import.meta.url));
export const DETAIL_FIELDS = ['sections', 'facts', 'companyIntro', 'jobImage'];

export function readCatalog() {
    const index = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const details = fs.existsSync(detailsPath) ? JSON.parse(fs.readFileSync(detailsPath, 'utf8')).jobs || {} : {};
    return { ...index, jobs: index.jobs.map(job => ({ ...job, ...(details[job.id] || {}) })) };
}

export function splitCatalog(catalog) {
    const details = {};
    const jobs = catalog.jobs.map(job => {
        const heavy = Object.fromEntries(DETAIL_FIELDS.filter(field => job[field] != null).map(field => [field, job[field]]));
        if (Object.keys(heavy).length) details[job.id] = heavy;
        return Object.fromEntries(Object.entries(job).filter(([field]) => !DETAIL_FIELDS.includes(field)));
    });
    return { index: { ...catalog, jobs }, details: { version: catalog.version, jobs: details } };
}

export function writeCatalog(catalog) {
    const { index, details } = splitCatalog(catalog);
    fs.writeFileSync(catalogPath, `${JSON.stringify(index, null, 2)}\n`);
    fs.writeFileSync(detailsPath, `${JSON.stringify(details, null, 2)}\n`);
}
