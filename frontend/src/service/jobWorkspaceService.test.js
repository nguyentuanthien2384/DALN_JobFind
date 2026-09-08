import axios from '../axios';
import { jobWorkspaceMode, workspaceSelection, listManagedJobs, getManagedJobReview, readManagedJobList, readManagedJobReview, reviewStateLabel } from './jobWorkspaceService';
jest.mock('../axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
const user = { id: 7, companyId: 3, roleCode: 'EMPLOYER' };
const row = () => ({ id: 55, name: 'Job', statusCode: 'PS3', timeEnd: '1700000000000', isHot: 1,
    updatedAt: '2026-09-08T00:00:00Z', userId: 8, companyId: 3, authorFirstName: 'Lan', authorLastName: null });
const list = () => ({ errCode: 0, data: [row()], count: 1 });
const review = () => ({ errCode: 0, data: { job: { id: 55, name: 'Job', companyId: 3, statusCode: 'PS3', reviewState: 'ai_requested' },
    notes: [{ id: 1, authorId: 88, authorFirstName: null, authorLastName: null, note: 'Manual note', createdAt: '2026-09-08T00:00:00Z' }], count: 1 } });
let originalMode;
beforeEach(() => {
    originalMode = process.env.REACT_APP_JOB_WORKSPACE_MODE; delete process.env.REACT_APP_JOB_WORKSPACE_MODE;
    localStorage.clear(); localStorage.setItem('userData', JSON.stringify(user)); axios.get.mockReset();
});
afterEach(() => { if (originalMode === undefined) delete process.env.REACT_APP_JOB_WORKSPACE_MODE; else process.env.REACT_APP_JOB_WORKSPACE_MODE = originalMode; });
test('default legacy, exact opt-in, ADMIN always stays manual even with invalid flag', () => {
    expect(jobWorkspaceMode(user)).toBe('legacy'); process.env.REACT_APP_JOB_WORKSPACE_MODE = 'core'; expect(jobWorkspaceMode(user)).toBe('core');
    process.env.REACT_APP_JOB_WORKSPACE_MODE = 'CORE'; expect(workspaceSelection(user)).toMatchObject({ mode: null, error: expect.any(String) });
    expect(jobWorkspaceMode({ id: 88, roleCode: 'ADMIN' })).toBe('legacy');
    expect(() => jobWorkspaceMode({ ...user, roleCode: 'CANDIDATE' })).toThrow();
});
test('encodes search and sends only private GET query fields with bounded timeout and optional abort', async () => {
    const controller = new AbortController(); await listManagedJobs({ search: 'x & %_!', statusCode: 'PS3', limit: 5, offset: 10 }, controller.signal);
    const [path, options] = axios.get.mock.calls[0]; const url = new URL(path, 'http://test.local');
    expect(url.pathname).toBe('/api/jobs/manage'); expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '5', offset: '10', search: 'x & %_!', statusCode: 'PS3' });
    expect(options).toEqual({ timeout: 15000, signal: controller.signal });
    await getManagedJobReview(55, { limit: 5, offset: 5 }); expect(axios.get).toHaveBeenLastCalledWith('/api/jobs/55/review?limit=5&offset=5', { timeout: 15000 });
});
test.each([{ limit: 0 }, { limit: 51 }, { limit: '5' }, { offset: -1 }, { offset: 1000001 }, { companyId: 99 },
    { statusCode: 'PS5' }, { search: ['x'] }, { search: 'x'.repeat(256) }])('unsafe list query %j never reaches HTTP', query => {
    expect(() => listManagedJobs(query)).toThrow(); expect(axios.get).not.toHaveBeenCalled();
});
test.each([0, '01', '1e2', 'x', true, 9007199254740992])('unsafe note ID %j never reaches HTTP', id => {
    expect(() => getManagedJobReview(id)).toThrow(); expect(axios.get).not.toHaveBeenCalled();
});
test('flattens a private list into the existing table without inventing edit revision or public status', () => {
    const result = readManagedJobList(list(), user, { limit: 5, offset: 0 });
    expect(result).toMatchObject({ count: 1, data: [{ id: 55, postDetailData: { name: 'Job' }, statusPostData: { code: 'PS3', value: 'Chờ kiểm duyệt' } }] });
    expect(result.data[0]).not.toHaveProperty('editRevision');
    const historic = list(); historic.data[0] = { ...row(), name: null, statusCode: null, timeEnd: 'bad', updatedAt: null, isHot: null };
    expect(readManagedJobList(historic, user).data[0].postDetailData.name).toBeNull();
});
test.each(['id', 'userId', 'companyId', 'name', 'statusCode', 'timeEnd', 'updatedAt', 'isHot', 'authorFirstName', 'authorLastName'])('missing list field %s fails the whole page', field => {
    const response = list(); delete response.data[0][field]; expect(() => readManagedJobList(response, user)).toThrow();
});
test.each([{ count: -1 }, { count: '1' }, { count: 0 }, { data: [row(), row()], count: 2 }, { data: null }, { errCode: 503 }])('malformed list %j cannot become a valid empty list', patch => {
    expect(() => readManagedJobList({ ...list(), ...patch }, user)).toThrow();
});
test('wrong tenant, oversized/out-of-range response and account switch fail closed', () => {
    const response = list(); response.data[0].companyId = 4; expect(() => readManagedJobList(response, user)).toThrow();
    expect(() => readManagedJobList(list(), user, { offset: 5 })).toThrow();
    const tooMany = { ...list(), count: 6, data: Array.from({ length: 6 }, (_, i) => ({ ...row(), id: i + 1 })) };
    expect(() => readManagedJobList(tooMany, user)).toThrow();
    expect(readManagedJobList({ errCode: 0, data: [], count: 7 }, user, { offset: 20 })).toEqual({ data: [], count: 7 });
    localStorage.setItem('userData', JSON.stringify({ ...user, companyId: 4 })); expect(() => readManagedJobList(list(), user)).toThrow();
    expect(() => readManagedJobReview(review(), 55, user)).toThrow();
});
test('manual notes and current summary stay separate; removed note author does not hide history', () => {
    const result = readManagedJobReview(review(), 55, user); expect(result.job.reviewState).toBe('ai_requested');
    expect(result.notes[0].userNoteData).toEqual({ id: 88, firstName: null, lastName: null });
    expect(reviewStateLabel('ai_requested')).toContain('chưa xác nhận worker'); expect(reviewStateLabel('ai_failed')).toContain('không phải quyết định từ chối');
    const empty = review(); empty.data.notes = []; empty.data.count = 0; expect(readManagedJobReview(empty, 55, user).notes).toEqual([]);
});
test.each([{ id: 56 }, { companyId: 4 }, { reviewState: 'toString' }, { reviewState: 'running' }, { reviewState: null },
    { statusCode: 'PS1' }, { reviewState: 'ai_applied' }, { name: undefined }])('unsafe/inconsistent summary %j is rejected', patch => {
    const response = review(); Object.assign(response.data.job, patch); expect(() => readManagedJobReview(response, 55, user)).toThrow();
});
test.each(['id', 'authorId', 'authorFirstName', 'authorLastName', 'note', 'createdAt'])('missing note %s rejects the response', field => {
    const response = review(); delete response.data.notes[0][field]; expect(() => readManagedJobReview(response, 55, user)).toThrow();
});
test('invalid note timestamp, duplicate row, invalid count and missing job fail closed', () => {
    const response = review(); response.data.notes[0].createdAt = 'bad'; expect(() => readManagedJobReview(response, 55, user)).toThrow();
    expect(() => readManagedJobReview({ errCode: 0, data: { ...review().data, notes: [review().data.notes[0], review().data.notes[0]], count: 2 } }, 55, user)).toThrow();
    expect(() => readManagedJobReview({ errCode: 0, data: { ...review().data, count: '1' } }, 55, user)).toThrow();
    expect(() => readManagedJobReview({ errCode: 0, data: {} }, 55, user)).toThrow();
});
