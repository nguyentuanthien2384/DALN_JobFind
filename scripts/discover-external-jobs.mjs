// Finds open vacancies on the supported official career sites and adds them to the
// external catalogue with the same source excerpts, logos and banners as `jobs:sync`.
//
//   npm run jobs:discover -- --dry-run            list what would be added, write nothing
//   npm run jobs:discover -- --site=vnpt,sapo     only these sources (keys in external-jobs/sites.mjs)
//   npm run jobs:discover -- --limit=12           at most 12 new vacancies per source (default 12)
//   npm run jobs:discover -- --save-html=DIR / --cache=DIR   keep or reuse fetched pages
//
// A vacancy is added only when its own page shows a future deadline, at least one content
// section and a workplace that maps to the current 34 provinces. Filter codes are taken only
// from the source's own words (see external-jobs/classify.mjs); anything unclear stays null.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SITES, JOB_OVERRIDES } from './external-jobs/sites.mjs';
import { categoryOf, experienceOf, fold, levelOf, salaryCodeOf, workTypeOf } from './external-jobs/classify.mjs';
import { validateVerifiedJobs } from './check-verified-jobs.mjs';
import { readCatalog, writeCatalog } from './external-jobs/catalog-io.mjs';
import { downloadImage, fetchPage, loadJsdom, localFile, mergeVacancy, vietnamToday } from './sync-external-jobs.mjs';

export const vacancyId = url => `external-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)}`;

/** Builds a catalogue entry from one extracted page, or explains why the page is skipped. */
export function buildVacancy({ site, url, result, today }) {
    if (!result?.title) return { reason: 'no title' };
    if (!result.deadline) return { reason: 'no published deadline' };
    if (result.deadline < today) return { reason: `deadline passed (${result.deadline})` };
    if (!result.sections?.some(section => !/quyền lợi|phúc lợi|đãi ngộ|benefit/i.test(section.title))) return { reason: 'no job description' };
    if (!result.location?.provinces?.length) return { reason: `workplace not mappable: ${result.location?.text || 'missing'}` };
    const facts = result.facts || [];
    const factValue = pattern => facts.find(entry => pattern.test(entry.label))?.value;
    const requirements = result.sections.filter(section => /yêu cầu|requirement/i.test(section.title)).flatMap(section => section.items);
    const id = vacancyId(url);
    const draft = {
        postedAt: result.postedAt && result.postedAt <= today ? result.postedAt : null,
        salaryText: result.salaryText || null,
        categoryJobCode: categoryOf(result.title) || categoryOf(factValue(/ngành nghề|phòng ban|công việc/i)),
        categoryJoblevelCode: levelOf(result.title),
        categoryWorktypeCode: workTypeOf(result.workTypeText),
        salaryJobCode: salaryCodeOf(result.salaryText),
        experienceJobCode: experienceOf(factValue(/kinh nghiệm/i), requirements),
        title: result.title,
        employer: result.employer || site.profile.employer,
        provinceCodes: result.location.provinces,
        sourceLocation: result.location.text,
        sourceUrl: url,
        sourceName: site.profile.sourceName,
        deadline: result.deadline,
        checkedAt: today,
        sourceStatus: 'open',
        summary: '',
        id,
    };
    return { job: mergeVacancy(draft, result, { today, site, override: JOB_OVERRIDES[id] || {} }).job };
}

function parseArgs(argv) {
    const option = name => argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
    return {
        dryRun: argv.includes('--dry-run'),
        verbose: argv.includes('--verbose'),
        sites: option('site')?.split(',').filter(Boolean),
        limit: Number(option('limit') || 12),
        cache: option('cache'),
        saveHtml: option('save-html'),
        today: option('date') || vietnamToday(),
    };
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const JSDOM = loadJsdom();
    const catalog = readCatalog();
    const known = new Set(catalog.jobs.map(job => job.sourceUrl));
    const cacheName = url => url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 180);
    const get = async url => {
        const cached = args.cache && path.join(args.cache, `${cacheName(url)}.html`);
        if (cached && fs.existsSync(cached)) return fs.readFileSync(cached, 'utf8');
        await pause(350);
        const page = await fetchPage(url);
        if (page.status !== 200) throw new Error(`HTTP ${page.status}`);
        if (args.saveHtml) { fs.mkdirSync(args.saveHtml, { recursive: true }); fs.writeFileSync(path.join(args.saveHtml, `${cacheName(url)}.html`), page.html); }
        return page.html;
    };
    const added = [];
    const skipped = {};
    for (const site of SITES.filter(entry => entry.discover && (!args.sites || args.sites.includes(entry.key)))) {
        let urls = [];
        try { urls = await site.discover(get); } catch (error) { console.warn(`${site.key}: listing unavailable (${error.message})`); continue; }
        const seenTitles = new Set();
        let count = 0;
        for (const url of urls) {
            if (count >= args.limit) break;
            if (known.has(url)) continue;
            known.add(url);
            let result;
            try {
                const document = new JSDOM(await get(url), { url }).window.document;
                result = site.extract(document);
            } catch (error) {
                skipped[url] = `fetch failed (${error.message})`;
                continue;
            }
            const built = buildVacancy({ site, url, result, today: args.today });
            if (!built.job) { skipped[url] = built.reason; continue; }
            // Chains repeat one store role across many towns; keep one per title and province set.
            const signature = `${fold(built.job.title).replace(/\[[^\]]*\]/g, '').trim()}|${built.job.provinceCodes.join(',')}`;
            if (seenTitles.has(signature)) { skipped[url] = 'duplicate role'; continue; }
            seenTitles.add(signature);
            const logo = result.logo;
            if (logo && !fs.existsSync(localFile(logo.file)) && !args.dryRun) {
                try { await downloadImage(logo.origin, localFile(logo.file)); }
                catch (error) { skipped[url] = `logo unavailable (${error.message})`; continue; }
            }
            added.push(built.job);
            count += 1;
            console.log(`+ ${site.key}  ${built.job.title}  [${built.job.provinceCodes.join(', ')}]  ${built.job.categoryJobCode || '-'} / ${built.job.deadline}`);
        }
        console.log(`${site.key}: ${count} added from ${urls.length} listed`);
    }
    if (args.verbose) for (const [url, reason] of Object.entries(skipped)) console.log(`- ${url}  ${reason}`);
    const reasons = Object.values(skipped).reduce((total, reason) => ({ ...total, [reason.replace(/:.*/, '')]: (total[reason.replace(/:.*/, '')] || 0) + 1 }), {});
    console.log(`\nSkipped: ${JSON.stringify(reasons)}`);
    if (!added.length) { console.log('Nothing to add.'); return; }
    const next = { ...catalog, jobs: [...catalog.jobs, ...added], checkedAt: args.today };
    const sameDay = String(catalog.version).startsWith(`${args.today}.`);
    next.version = `${args.today}.${sameDay ? Number(String(catalog.version).split('.').pop()) + 1 : 1}`;
    // A dry run downloads no logos, so missing new logo files are expected there.
    const errors = validateVerifiedJobs(next).filter(error => !(args.dryRun && /missing logo file/.test(error)));
    if (errors.length) { console.error(`\nCatalogue would be invalid; nothing written:\n- ${errors.join('\n- ')}`); process.exitCode = 1; return; }
    if (args.dryRun) { console.log(`\nDry run: ${added.length} vacancies would be added.`); return; }
    writeCatalog(next);
    console.log(`\nAdded ${added.length} vacancies; catalogue version ${next.version}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error); process.exitCode = 1; });
}
