import { JOB_CLASSIFICATIONS, jobToForm, jobDeadlineDate, jobClassificationOptions,
    jobStatusLabel, buildJobCreate, buildJobUpdate } from './jobFormAdapter';

const flat = () => ({ id: 12, name: 'Developer', descriptionHTML: '<p>Work</p>', descriptionMarkdown: 'Work', amount: 2,
    categoryJobCode: 'IT', addressCode: 'HN', genderPostCode: null, salaryJobCode: null,
    categoryJoblevelCode: null, categoryWorktypeCode: null, experienceJobCode: null,
    timeEnd: '1700000000000', statusCode: 'PS3', isHot: 1, editRevision: 'jv1-' + 'a'.repeat(64) });
const future = () => new Date(Date.now() + 86400000);
test('maps flat and nested legacy records to exactly the same form without mutating either', () => {
    const job = flat(), nested = { id: job.id, timeEnd: job.timeEnd, isHot: job.isHot, statusCode: job.statusCode, editRevision: job.editRevision,
        postDetailData: { name: job.name, descriptionHTML: job.descriptionHTML, descriptionMarkdown: job.descriptionMarkdown, amount: job.amount,
            ...Object.fromEntries(JOB_CLASSIFICATIONS.map(([, raw, association]) => [association, job[raw] ? { code: job[raw] } : null])) } };
    const before = JSON.stringify(nested);
    expect(jobToForm(job)).toEqual(jobToForm(nested));
    expect(jobToForm(job)).toMatchObject({ genderCode: '', amount: '2', timeEnd: job.timeEnd, statusCode: 'PS3', isActionADD: false });
    expect(JSON.stringify(nested)).toBe(before);
});
test.each(JOB_CLASSIFICATIONS)('keeps raw %s code even when its label is deleted or contradictory', (field, raw, association) => {
    const nested = { ...flat(), postDetailData: { name: 'Dev', [raw]: 'OLD-CODE', [association]: null } };
    expect(jobToForm(nested)[field]).toBe('OLD-CODE');
    nested.postDetailData[association] = { code: 'WRONG' };
    expect(jobToForm(nested)[field]).toBe('OLD-CODE');
    nested.postDetailData[raw] = null;
    expect(jobToForm(nested)[field]).toBe('');
});
test.each([null, {}, { id: 12, postDetailData: null }, { id: [12], name: 'Dev' }])('rejects missing/malformed job data %j', job => {
    expect(() => jobToForm(job)).toThrow();
});
test('dropdowns preserve missing/unknown codes without inventing an Allcode entry or mutating the list', () => {
    const items = [{ code: 'IT', value: 'Công nghệ' }, { code: 'IT', value: 'Công nghệ' }, null];
    expect(jobClassificationOptions(items, 'OLD')).toEqual([{ code: 'OLD', value: 'Mã đang lưu: OLD (không có trong danh mục)' }, { code: 'IT', value: 'Công nghệ' }]);
    expect(jobClassificationOptions(undefined, '')).toEqual([{ code: '', value: 'Chưa chọn' }]);
    expect(jobClassificationOptions(items, 'IT')).toHaveLength(1);
    expect(items).toHaveLength(3);
});
test.each([null, '', 'bad', '2027-01-01', true, 0, -1, '9007199254740992'])('never displays a guessed date for %j', value => {
    expect(jobDeadlineDate(value)).toBeNull();
});
test('keeps millisecond dates, including expired historical values', () => {
    expect(jobDeadlineDate('1700000000000').getTime()).toBe(1700000000000);
    expect(jobDeadlineDate(1700000000000).getTime()).toBe(1700000000000);
});
test.each([['PS1', 'Đã duyệt'], ['PS2', 'Bị từ chối'], ['PS3', 'Chờ kiểm duyệt'], ['PS4', 'Đã gỡ hoặc bị chặn'], [null, 'Chưa xác định'], ['constructor', 'Chưa xác định']])('labels %s without claiming AI processing/public visibility', (code, label) => {
    expect(jobStatusLabel(code)).toBe(label);
});
test('builds an immutable create intent with API codes and typed values, never identity/status/UI state', () => {
    const form = { ...jobToForm(flat()), userId: 999, companyId: 999, unknown: 'do not send' };
    const date = future(), result = buildJobCreate(form, date);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).toMatchObject({ amount: 2, isHot: 1, timeEnd: String(date.getTime()), genderPostCode: null, addressCode: 'HN' });
    for (const field of ['id', 'userId', 'companyId', 'statusCode', 'isActionADD', 'genderCode', 'unknown']) expect(result).not.toHaveProperty(field);
    expect(form.amount).toBe('2');
});
test.each(['', '0', '1.5', '1e2', '100001', false, null])('rejects invalid amount %j', amount => {
    expect(() => buildJobCreate({ ...jobToForm(flat()), amount }, future())).toThrow('Số lượng');
});
test.each(['name', 'descriptionHTML', 'categoryJobCode'])('requires %s without silently trimming content', field => {
    expect(() => buildJobCreate({ ...jobToForm(flat()), [field]: ' ' }, future())).toThrow();
});
test.each([null, '', '1700000000000', new Date('invalid')])('rejects invalid/past new deadline %j', date => {
    expect(() => buildJobCreate(jobToForm(flat()), date)).toThrow('Ngày kết thúc');
});
test('only sends changed fields, handles explicit clear and skips no-op even for expired/null legacy values', () => {
    const initial = jobToForm(flat());
    expect(buildJobUpdate({ ...initial, amount: 2 }, initial)).toBeNull();
    expect(buildJobUpdate({ ...initial, descriptionMarkdown: '', addressCode: '', genderCode: 'G1' }, initial))
        .toEqual({ descriptionMarkdown: '', addressCode: null, genderPostCode: 'G1', expectedRevision: initial.editRevision });
    expect(buildJobUpdate({ ...initial, name: 'Changed', userId: 99, statusCode: 'PS1' }, initial)).toEqual({ name: 'Changed', expectedRevision: initial.editRevision });
});
test.each([{ timeEnd: '2000000000000' }, { isHot: 0 }, { id: 13 }])('rejects paid-field or loaded-record mismatch %j', patch => {
    const initial = jobToForm(flat());
    expect(() => buildJobUpdate({ ...initial, ...patch }, initial)).toThrow();
});
test('requires a valid loaded baseline and validates changed fields without rewriting historical values', () => {
    expect(() => buildJobUpdate({}, {})).toThrow();
    const initial = jobToForm(flat());
    expect(() => buildJobUpdate({ ...initial, amount: '0' }, initial)).toThrow();
    expect(() => buildJobCreate({ ...initial, name: 'x'.repeat(256) }, future())).toThrow();
    expect(buildJobUpdate({ ...initial, name: ' Text ' }, initial)).toEqual({ name: ' Text ', expectedRevision: initial.editRevision });
});

test.each([undefined, null, '', 'jv1-' + 'A'.repeat(64), 'jv2-' + 'a'.repeat(64), {}])('blocks changed edits without a valid loaded revision: %j', editRevision => {
    const initial = jobToForm({ ...flat(), editRevision });
    expect(initial.editRevision).toBeNull();
    expect(buildJobUpdate(initial, initial)).toBeNull();
    expect(() => buildJobUpdate({ ...initial, name: 'Changed', editRevision: flat().editRevision }, initial)).toThrow('phiên bản');
    expect(buildJobCreate(initial, future())).not.toHaveProperty('editRevision');
});
