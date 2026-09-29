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
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function validateVerifiedJobs(catalog) {
  const errors = [];
  const requiredText = ['title', 'employer', 'sourceLocation', 'sourceUrl', 'sourceName', 'summary'];
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
    if (job.deadline !== null && (!validDate(job.deadline) || job.deadline < job.checkedAt)) fail('deadline was already expired when checked');
    if (job.postedAt !== null && (!validDate(job.postedAt) || job.postedAt > job.checkedAt)) fail('invalid postedAt');
    if (job.sourceStatus !== (job.deadline ? 'open' : 'deadline-not-published')) fail('sourceStatus does not match deadline');
    if (job.salaryText !== null && (typeof job.salaryText !== 'string' || !job.salaryText.trim())) fail('invalid salaryText');
    for (const field of ['responsibilities', 'requirements']) {
      if (!Array.isArray(job[field]) || job[field].some(item => typeof item !== 'string' || !item.trim())) fail(`invalid ${field}`);
    }
    for (const [field, codes] of Object.entries(fields)) if (job[field] !== null && !codes.includes(job[field])) fail(`invalid ${field}`);
  }
  return errors;
}

export function coverageAt(catalog, date) {
  const active = catalog.jobs.filter(job => !job.deadline || job.deadline >= date);
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
