import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import recruitmentCatalog from '../microservices/shared/recruitmentCatalog.cjs';

export const catalogPath = fileURLToPath(new URL('../frontend/src/data/verifiedJobs.json', import.meta.url));
const fields = {
  categoryJobCode: ['bat-dong-san', 'cong-nghe-thong-tin', 'giao-vien', 'kinh-te', 'logistics', 'luat', 'quan-ly-nhan-su', 'truyen-thong'],
  categoryWorktypeCode: ['fulltime', 'part-time', 'remote', 'thuc-tap'],
  categoryJoblevelCode: recruitmentCatalog.JOB_LEVELS.map(row => row.code),
  experienceJobCode: ['1-nam', '2-nam', '3nam', 'khong-yeu-cau', 'tren-5-nam'],
  salaryJobCode: ['10-15tr', '15-20tr', '20-30tr', '3-5tr', '5-10tr', 'thoa-thuan', 'tren-30tr'],
};
const STATUSES = ['open', 'deadline-not-published', 'closed', 'removed'];
const publicDir = fileURLToPath(new URL('../frontend/public/', import.meta.url));
const assetExists = src => typeof src === 'string' && /^\/external-jobs\/[a-z0-9/_.-]+$/.test(src)
  && fs.existsSync(path.join(publicDir, src));
const validText = value => typeof value === 'string' && value.trim().length > 0;
export const isListed = job => job.sourceStatus === 'open' || job.sourceStatus === 'deadline-not-published';
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function validateVerifiedJobs(catalog) {
  const errors = [];
  const requiredText = ['title', 'employer', 'sourceLocation', 'sourceUrl', 'sourceName'];
  const provinceCodes = recruitmentCatalog.PROVINCES.map(row => row.code);
  const ids = new Set();
  const urls = new Set();
  if (typeof catalog.version !== 'string' || !catalog.version.trim()) errors.push('Missing catalog version');
  if (!validDate(catalog.checkedAt)) errors.push('Invalid catalog checkedAt');
  if (JSON.stringify(catalog.provinces) !== JSON.stringify(recruitmentCatalog.PROVINCES)) errors.push('Province references differ from recruitment catalog');
  if (!Array.isArray(catalog.jobs) || catalog.jobs.length === 0) return [...errors, 'No sourced vacancies'];
  for (const job of catalog.jobs) {
    const label = job.id || 'missing id';
    const fail = message => errors.push(`${label}: ${message}`);
    if (!/^external-[a-z0-9-]+$/.test(job.id) || ids.has(job.id)) fail('invalid/duplicate ID');
    ids.add(job.id);
    for (const field of requiredText) if (typeof job[field] !== 'string' || !job[field].trim()) fail(`missing ${field}`);
    try {
      const url = new URL(job.sourceUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost') fail('unsafe source URL');
      url.hash = '';
      if (urls.has(url.href)) fail('duplicate source vacancy (merge its provinces instead)');
      urls.add(url.href);
    } catch { fail('invalid source URL'); }
    if (!Array.isArray(job.provinceCodes) || !job.provinceCodes.length
      || new Set(job.provinceCodes).size !== job.provinceCodes.length
      || job.provinceCodes.some(code => !provinceCodes.includes(code))) fail('invalid provinceCodes');
    if (!validDate(job.checkedAt) || job.checkedAt > catalog.checkedAt) fail('invalid checkedAt');
    if (job.deadline !== null && !validDate(job.deadline)) fail('invalid deadline');
    if (!STATUSES.includes(job.sourceStatus)) fail('invalid sourceStatus');
    else if (job.sourceStatus === 'open' && !(job.deadline && job.deadline >= job.checkedAt)) fail('open vacancy needs a deadline on or after checkedAt');
    else if (job.sourceStatus === 'deadline-not-published' && job.deadline !== null) fail('sourceStatus does not match deadline');
    else if (job.sourceStatus === 'closed' && !(job.deadline && job.deadline < job.checkedAt)) fail('closed vacancy needs a deadline before checkedAt');
    if (job.postedAt !== null && (!validDate(job.postedAt) || job.postedAt > job.checkedAt)) fail('invalid postedAt');
    if (job.salaryText !== null && !validText(job.salaryText)) fail('invalid salaryText');
    for (const field of ['quantity', 'workTypeText', 'companyIntro', 'logoBackground']) {
      if (job[field] != null && !validText(job[field])) fail(`invalid ${field}`);
    }
    if (job.logoBackground != null && !/^#[0-9a-f]{6}$/i.test(job.logoBackground)) fail('invalid logoBackground');
    for (const field of ['logo', 'coverImage']) if (job[field] != null && !assetExists(job[field])) fail(`missing ${field} file`);
    if (job.jobImage != null && (!assetExists(job.jobImage.src) || !validText(job.jobImage.alt))) fail('invalid jobImage');
    if (!Array.isArray(job.facts ?? []) || (job.facts ?? []).some(entry => !validText(entry?.label) || !validText(entry?.value))) fail('invalid facts');
    if ('responsibilities' in job || 'requirements' in job) fail('paraphrased fields are replaced by source sections');
    if (isListed(job)) {
      if (!validText(job.summary)) fail('missing summary');
      if (!Array.isArray(job.sections) || !job.sections.length) fail('listed vacancy needs source sections');
    }
    for (const section of job.sections ?? []) {
      if (!validText(section?.title) || !Array.isArray(section.items) || !section.items.length
        || section.items.some(item => !validText(item)) || typeof section.truncated !== 'boolean') fail('invalid section');
    }
    for (const [field, codes] of Object.entries(fields)) if (job[field] !== null && !codes.includes(job[field])) fail(`invalid ${field}`);
  }
  return errors;
}

export function coverageAt(catalog, date) {
  const active = catalog.jobs.filter(job => (!job.sourceStatus || isListed(job)) && (!job.deadline || job.deadline >= date));
  return Object.fromEntries(recruitmentCatalog.PROVINCES.map(province => [province.code, active.filter(job => job.provinceCodes.includes(province.code)).length]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const errors = validateVerifiedJobs(catalog);
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const coverage = coverageAt(catalog, today);
  console.log(JSON.stringify({checkedAt: catalog.checkedAt, total: catalog.jobs.length, asOf: today,
    coveredProvinces: Object.values(coverage).filter(Boolean).length,
    missingProvinces: Object.keys(coverage).filter(code => !coverage[code]), errors}, null, 2));
  if (errors.length) process.exitCode = 1;
}
