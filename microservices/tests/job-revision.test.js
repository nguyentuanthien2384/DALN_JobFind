import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { jobRevision, isJobRevision } from '../shared/jobRevision.js';
import { assertJobRevision } from '../job-core-service/src/libs/jobEdit.js';

const post = { id: 12, detailPostId: 31, userId: 7, statusCode: 'PS1', timeEnd: '1700000000000', isHot: 0 };
const detail = { id: 31, name: 'Kỹ sư', descriptionHTML: '<p>Work</p>', descriptionMarkdown: 'Work',
    categoryJobCode: 'IT', addressCode: null, salaryJobCode: 'S1', amount: 2,
    categoryJoblevelCode: 'JL1', categoryWorktypeCode: 'WT1', experienceJobCode: 'EX1', genderPostCode: null };

it('keeps legacy and core fingerprint protocol byte-identical and canonical across SQL/ORM/read shapes', async () => {
    const [core, legacy] = await Promise.all([
        readFile(new URL('../shared/jobRevision.js', import.meta.url), 'utf8'),
        readFile(new URL('../../backend/src/utils/jobRevision.js', import.meta.url), 'utf8')
    ]);
    expect(core.replace(/\r\n/g, '\n')).toBe(legacy.replace(/\r\n/g, '\n'));
    const expected = jobRevision(post, detail);
    expect(isJobRevision(expected)).toBe(true);
    expect(jobRevision({ ...detail, ...post })).toBe(expected);
    expect(jobRevision({ ...post, detailPostId: undefined }, detail)).toBe(expected);
    expect(jobRevision({ ...post, id: '12', detailPostId: '31', userId: '7', timeEnd: 1700000000000, isHot: false },
        { ...detail, amount: '2' })).toBe(expected);
    expect(jobRevision({ ...post, updatedAt: new Date(), companyName: 'Changed' }, { ...detail, createdAt: 'old' })).toBe(expected);
});

it.each([
    ...['id', 'detailPostId', 'userId', 'statusCode', 'timeEnd', 'isHot'].map(field => ['post', field]),
    ...Object.keys(detail).filter(field => field !== 'id').map(field => ['detail', field])
])('detects changed %s.%s, including detail pointer for copy-on-write content ABA', (scope, field) => {
    const changed = field === 'amount' || field === 'isHot' ? 3 : field === 'id' || field === 'detailPostId' ? 44 : 'changed';
    expect(jobRevision(scope === 'post' ? { ...post, [field]: changed } : post,
        scope === 'detail' ? { ...detail, [field]: changed } : detail)).not.toBe(jobRevision(post, detail));
});

it('distinguishes null/empty, returns no usable token for missing pointer and does not use delimiter concatenation', () => {
    expect(jobRevision(post, { ...detail, addressCode: '' })).not.toBe(jobRevision(post, detail));
    expect(jobRevision({ ...post, detailPostId: undefined })).toBeNull();
    expect(jobRevision(post, { ...detail, name: 'a|b', descriptionHTML: 'c' }))
        .not.toBe(jobRevision(post, { ...detail, name: 'a', descriptionHTML: 'b|c' }));
});

it.each([null, undefined, '', {}, [], 'jv1-' + 'A'.repeat(64), 'jv2-' + 'a'.repeat(64), 'jv1-' + 'a'.repeat(63)])('rejects malformed supplied revision %j even on a no-op', expectedRevision => {
    expect(isJobRevision(expectedRevision)).toBe(false);
    expect(() => assertJobRevision(post, detail, { expectedRevision })).toThrow(expect.objectContaining({ statusCode: 400 }));
});

it('allows matching revision and old unguarded requests but never a stale no-op', () => {
    expect(() => assertJobRevision(post, detail, {})).not.toThrow();
    expect(() => assertJobRevision(post, detail, { expectedRevision: jobRevision(post, detail) })).not.toThrow();
    expect(() => assertJobRevision(post, detail, { name: detail.name, expectedRevision: 'jv1-' + '0'.repeat(64) }))
        .toThrow(expect.objectContaining({ statusCode: 409, conflict: true }));
});
