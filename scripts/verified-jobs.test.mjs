import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readCatalog, validateVerifiedJobs, coverageAt } from './check-verified-jobs.mjs';
import { detailsPath, splitCatalog } from './external-jobs/catalog-io.mjs';

const catalog = readCatalog();
test('the detail file matches the index version and holds every source excerpt', () => {
  const details = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
  assert.equal(details.version, catalog.version);
  assert.deepEqual(splitCatalog(catalog).details, details);
});
test('curated vacancies have unique sources and valid dates, filters, and province mappings', () => {
  assert.deepEqual(validateVerifiedJobs(catalog), []);
});
test('verified snapshot covers all 34 current provinces with unexpired source vacancies', () => {
  const coverage = coverageAt(catalog, catalog.checkedAt);
  assert.equal(Object.keys(coverage).length, 34);
  assert.deepEqual(Object.keys(coverage).filter(code => !coverage[code]), []);
});
test('future coverage report excludes expired vacancies rather than extending their deadline', () => {
  const jobs = [{provinceCodes:['Hà Nội'], deadline:'2026-09-30'}, {provinceCodes:['Hồ Chí Minh'],deadline:null}];
  assert.equal(coverageAt({jobs}, '2026-09-30')['Hà Nội'], 1);
  assert.equal(coverageAt({jobs}, '2026-10-01')['Hà Nội'], 0);
  assert.equal(coverageAt({jobs}, '2026-10-01')['Hồ Chí Minh'], 1);
});
