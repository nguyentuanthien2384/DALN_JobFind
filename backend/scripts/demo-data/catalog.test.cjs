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

test('every demo profile and company points to its own portrait, logo and cover image', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const publicDir = path.join(__dirname, '../../../frontend/public');
    const catalog = buildCatalog(now);
    const images = [...catalog.candidates.map(c => c.avatar), ...catalog.companies.flatMap(c => [c.logo, c.cover])];
    assert.equal(new Set(images).size, images.length);
    for (const image of images) assert.ok(fs.existsSync(path.join(publicDir, image)), image);
    const gender = name => catalog.candidates.find(c => c.fullName === name).genderCode;
    assert.equal(gender('Đỗ Khánh Vân'), 'FE');
    assert.equal(gender('Nguyễn Hữu Phước'), 'M');
    assert.equal(gender('Trần Minh Thư'), 'FE');
    assert.equal(gender('Đỗ Quốc Bảo'), 'M');
    assert.equal(catalog.candidates.filter(c => c.genderCode === 'FE').length, 36);
});

test('demo catalogs seed 34 current provinces and 12 levels while keeping historical aliases out of province choices', async () => {
    const { PROVINCES, JOB_LEVELS } = require('../../../microservices/shared/recruitmentCatalog.cjs');
    let seedRows;
    const allcodeSeeder = require('../../src/seeders/20250101000001-demo-allcodes.js');
    await allcodeSeeder.up({ bulkInsert: async (table, rows) => { assert.equal(table, 'Allcodes'); seedRows = rows; } });
    for (const rows of [buildCatalog(now).allcodes, seedRows]) {
        assert.equal(new Set(rows.map(row => row.code)).size, rows.length);
        assert.deepEqual(rows.filter(row => row.type === 'PROVINCE').map(({ code, value }) => ({ code, value })),
            PROVINCES.map(({ code, value }) => ({ code, value })));
        assert.equal(rows.filter(row => row.type === 'PROVINCE').length, 34);
        assert.deepEqual(rows.filter(row => row.type === 'JOBLEVEL').map(({ code, value }) => ({ code, value })), JOB_LEVELS);
        assert.equal(rows.filter(row => row.type === 'JOBLEVEL').length, 12);
        for (const code of ['Bà Rịa – Vũng Tàu', 'Thừa Thiên Huế', 'Bắc Giang', 'Bình Dương']) {
            assert.equal(rows.find(row => row.code === code)?.type, 'PROVINCE_LEGACY');
        }
    }
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
