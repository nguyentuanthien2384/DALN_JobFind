// Refreshes the external vacancy catalogue from each vacancy's official source page.
//
//   npm run jobs:sync                 fetch every source and update verifiedJobs.json
//   npm run jobs:sync -- --dry-run    report what would change without writing
//   npm run jobs:sync -- --only=external-a16a0d2c3e4e,external-0642f260a509
//   npm run jobs:sync -- --cache=DIR  read DIR/<id>.html instead of fetching (offline review)
//   npm run jobs:sync -- --save-html=DIR   keep the fetched pages for review
//   npm run jobs:sync -- --download-images  fetch configured logos/banners that are missing locally
//
// The script only republishes what the source shows: title, deadline, salary, head count,
// work type, a few labelled facts and a capped excerpt of the source's own sections.
// Province mapping and search filter codes stay curated by hand (see docs/verified-jobs.md).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { summaryFrom } from './external-jobs/extract.mjs';
import { JOB_OVERRIDES, siteFor } from './external-jobs/sites.mjs';
import { validateVerifiedJobs } from './check-verified-jobs.mjs';
import { catalogPath, readCatalog, writeCatalog } from './external-jobs/catalog-io.mjs';

export const publicDir = fileURLToPath(new URL('../frontend/public/', import.meta.url));
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 JobFinderSourceCheck/1.0';

export const vietnamToday = (now = new Date()) => new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

export function loadJsdom() {
    try {
        return createRequire(new URL('../frontend/package.json', import.meta.url))('jsdom').JSDOM;
    } catch {
        throw new Error('jsdom is missing. Run "npm --prefix frontend install" first.');
    }
}

export async function fetchPage(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
        const response = await fetch(url, { redirect: 'follow', signal: controller.signal,
            headers: { 'user-agent': USER_AGENT, 'accept-language': 'vi-VN,vi;q=0.9,en;q=0.6', accept: 'text/html,application/xhtml+xml' } });
        return { status: response.status, html: response.ok ? await response.text() : '' };
    } finally { clearTimeout(timer); }
}

export async function downloadImage(origin, target) {
    const response = await fetch(encodeURI(decodeURI(origin)), { headers: { 'user-agent': USER_AGENT } });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !/^image\//.test(type)) throw new Error(`HTTP ${response.status} ${type}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    return bytes.length;
}

const publicPath = file => `/external-jobs/${file}`;
export const localFile = file => path.join(publicDir, 'external-jobs', file);

/** Applies an extraction result to a catalogue entry. Pure: returns the new entry and a change list. */
export function mergeVacancy(job, result, { today, site, override = {}, status }) {
    const next = { ...job };
    const changes = [];
    const set = (field, value) => {
        if (JSON.stringify(next[field] ?? null) === JSON.stringify(value ?? null)) return;
        changes.push(field);
        next[field] = value ?? null;
    };
    next.checkedAt = today;
    // Earlier catalogue versions stored hand-written paraphrases; source sections replace them.
    for (const field of ['responsibilities', 'requirements']) if (field in next) { delete next[field]; changes.push(field); }
    if (status === 'removed') {
        set('sourceStatus', 'removed');
        set('summary', null);
        set('sections', []);
        return { job: next, changes };
    }
    const omitted = new Set(override.omit || []);
    if (result.title && !override.keepTitle) set('title', result.title);
    if (result.deadline) set('deadline', result.deadline);
    if (result.salaryText) set('salaryText', result.salaryText);
    set('quantity', omitted.has('quantity') ? null : result.quantity ?? null);
    set('workTypeText', result.workTypeText ?? null);
    set('facts', [...(result.facts || []), ...(override.facts || [])]);
    if (result.sections?.length) set('sections', result.sections);
    set('companyIntro', result.companyIntro ?? null);
    set('summary', summaryFrom(next.sections || [], next.summary));
    const logo = result.logo || site.media.logo;
    set('logo', logo ? publicPath(logo.file) : null);
    set('logoBackground', site.media.logoBackground ?? null);
    set('coverImage', site.media.cover ? publicPath(site.media.cover.file) : null);
    set('jobImage', override.jobImage ? { src: publicPath(override.jobImage.file), alt: override.jobImage.alt } : null);
    const deadlineStatus = !next.deadline ? 'deadline-not-published' : next.deadline < today ? 'closed' : 'open';
    set('sourceStatus', deadlineStatus);
    return { job: next, changes };
}

function parseArgs(argv) {
    const flag = name => argv.includes(`--${name}`);
    const option = name => argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
    return {
        dryRun: flag('dry-run'),
        downloadImages: flag('download-images'),
        only: option('only')?.split(',').filter(Boolean),
        cache: option('cache'),
        saveHtml: option('save-html'),
        today: option('date') || vietnamToday(),
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const JSDOM = loadJsdom();
    const catalog = readCatalog();
    const report = [];
    let failures = 0;
    for (const [index, job] of catalog.jobs.entries()) {
        if (args.only && !args.only.includes(job.id)) continue;
        const site = siteFor(job.sourceUrl);
        if (!site) { report.push({ id: job.id, result: 'no extractor for this host' }); failures += 1; continue; }
        let page;
        try {
            const cached = args.cache && path.join(args.cache, `${job.id}.html`);
            page = cached && fs.existsSync(cached) ? { status: 200, html: fs.readFileSync(cached, 'utf8') } : await fetchPage(job.sourceUrl);
        } catch (error) {
            report.push({ id: job.id, result: `unreachable (${error.name}); left unchanged` });
            failures += 1;
            continue;
        }
        if (args.saveHtml && page.html) {
            fs.mkdirSync(args.saveHtml, { recursive: true });
            fs.writeFileSync(path.join(args.saveHtml, `${job.id}.html`), page.html);
        }
        const override = JOB_OVERRIDES[job.id] || {};
        if (page.status === 404 || page.status === 410) {
            const merged = mergeVacancy(job, {}, { today: args.today, site, override, status: 'removed' });
            catalog.jobs[index] = merged.job;
            report.push({ id: job.id, result: `source returned HTTP ${page.status}: marked removed` });
            continue;
        }
        if (page.status !== 200) {
            report.push({ id: job.id, result: `HTTP ${page.status}; left unchanged` });
            failures += 1;
            continue;
        }
        const document = new JSDOM(page.html, { url: job.sourceUrl }).window.document;
        const result = site.extract(document);
        if (!result.sections?.length) {
            report.push({ id: job.id, result: 'page layout not recognised (no sections); left unchanged' });
            failures += 1;
            continue;
        }
        const before = { deadline: job.deadline, title: job.title };
        const merged = mergeVacancy(job, result, { today: args.today, site, override });
        catalog.jobs[index] = merged.job;
        const notes = [];
        if (before.deadline !== merged.job.deadline) notes.push(`deadline ${before.deadline} → ${merged.job.deadline}`);
        if (merged.job.sourceStatus === 'closed') notes.push('deadline passed: closed');
        report.push({ id: job.id, result: `${merged.job.sections.length} sections; ${merged.changes.join(', ') || 'no change'}${notes.length ? ` (${notes.join('; ')})` : ''}` });
        for (const image of [result.logo || site.media.logo, site.media.cover, override.jobImage].filter(Boolean)) {
            const target = localFile(image.file);
            if (fs.existsSync(target)) continue;
            if (!args.downloadImages) { report.push({ id: job.id, result: `missing image ${image.file} (run with --download-images)` }); failures += 1; continue; }
            try { const size = await downloadImage(image.origin, target); report.push({ id: job.id, result: `downloaded ${image.file} (${Math.round(size / 1024)} KB, review and resize large files)` }); }
            catch (error) { report.push({ id: job.id, result: `image ${image.file} failed: ${error.message}` }); failures += 1; }
        }
    }
    catalog.checkedAt = args.today;
    const sameDay = String(catalog.version).startsWith(`${args.today}.`);
    catalog.version = `${args.today}.${sameDay ? Number(String(catalog.version).split('.').pop()) + 1 : 1}`;
    for (const row of report) console.log(`${row.id}  ${row.result}`);
    const errors = validateVerifiedJobs(catalog);
    if (errors.length) {
        console.error(`\nCatalogue would be invalid; nothing written:\n- ${errors.join('\n- ')}`);
        process.exitCode = 1;
        return;
    }
    if (args.dryRun) { console.log('\nDry run: catalogue not written.'); return; }
    writeCatalog(catalog);
    console.log(`\nWrote ${path.relative(process.cwd(), catalogPath)} (version ${catalog.version}).`);
    if (failures) { console.warn(`${failures} source(s) need attention; see the lines above.`); process.exitCode = 2; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error); process.exitCode = 1; });
}
