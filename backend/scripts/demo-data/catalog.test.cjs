'use strict';
const test = globalThis.test || require('node:test');
const assert = require('node:assert/strict');
const { buildCatalog, createResume } = require('./catalog.cjs');
const { PDFExtract } = require('pdf.js-extract');
const now = new Date('2026-09-27T09:00:00Z');

test('catalog covers eight domains with unique accounts and strongly matching profiles for every job', () => {
    const catalog = buildCatalog(now);
    assert.deepEqual(buildCatalog(now), catalog);
    assert.equal(catalog.companies.length, 8);
    assert.equal(catalog.jobs.length, 48);
    assert.equal(catalog.candidates.length, 72);
    const codes = new Map(catalog.allcodes.map(code => [code.code, code.type]));
    const phones = [...catalog.companies.map(c => c.recruiter.phone), ...catalog.candidates.map(c => c.phone)];
    assert.equal(new Set(phones).size, phones.length);
    for (const job of catalog.jobs) {
        assert.equal(codes.get(job.categoryJobCode), 'JOBTYPE');
        assert.equal(codes.get(job.addressCode), 'PROVINCE');
        assert.equal(codes.get(job.salaryJobCode), 'SALARYTYPE');
        assert.ok(Number(job.timePost) <= now.getTime() && Number(job.timeEnd) > now.getTime());
        const candidate = catalog.candidates.find(c => c.targetJobKey === job.key && c.demoMatchScenario === 'strong-match');
        assert.ok(candidate);
        assert.equal(candidate.setting.addressCode, job.addressCode);
        assert.equal(candidate.setting.salaryJobCode, job.salaryJobCode);
        assert.equal(candidate.setting.experienceJobCode, job.experienceJobCode);
        assert.ok(job.skills.every(skill => candidate.skills.includes(skill)));
    }
    assert.ok(catalog.candidates.some(c => c.demoMatchScenario === 'partial-match'));
    assert.ok(catalog.candidates.every(c => c.email.endsWith('@example.test') && c.setting.isTakeMail === 0));
});

test('every generated PDF is readable and contains candidate-specific experience, skills and education', async () => {
    const extractor = new PDFExtract();
    for (const candidate of buildCatalog(now).candidates) {
        const source = await createResume(candidate);
        const bytes = Buffer.from(source.split(',')[1], 'base64');
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        const parsed = await extractor.extractBuffer(bytes, {});
        const text = parsed.pages.flatMap(page => page.content.map(item => item.str)).join(' ');
        assert.ok(parsed.pages.length >= 1 && parsed.pages.length <= 3);
        assert.ok(text.includes(candidate.email), candidate.key);
        assert.ok(text.includes(candidate.phone), candidate.key);
        assert.ok(text.includes('HOC VAN') && text.includes('DU AN TIEU BIEU') && text.includes('KINH NGHIEM'), candidate.key);
        assert.ok(text.includes(candidate.skills[0]), candidate.key);
    }
});
