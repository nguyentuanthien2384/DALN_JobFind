import { suggestJobs } from './aiSearchService';
import * as externalJobs from './externalJobs';
import { loadJobSuggestions } from './jobSuggestions';

jest.mock('./aiSearchService', () => ({ suggestJobs: jest.fn() }));

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-29T05:00:00Z'));
    suggestJobs.mockReset().mockResolvedValue({ errCode: 0, data: [] });
});
afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

test.each(['', ' ', 'P', null, undefined])('does not request suggestions for a short keyword: %s', async keyword => {
    expect(await loadJobSuggestions(keyword)).toEqual({ data: [], unavailable: false });
    expect(suggestJobs).not.toHaveBeenCalled();
});

test('PL finds the sourced PL/SQL vacancy and links to its actual detail page', async () => {
    const result = await loadJobSuggestions('  PL  ');
    expect(suggestJobs).toHaveBeenCalledWith('PL');
    const plsql = result.data.find(job => job.name === 'Lập trình PL/SQL');
    expect(plsql).toMatchObject({ companyName: 'Công ty Công nghệ thông tin VNPT', listingSource: 'external' });
    expect(plsql.detailPath).toBe(`/external-job/${plsql.id}`);
    expect(externalJobs.getExternalJob(plsql.id).title).toBe(plsql.name);
    expect(plsql.addressText).toContain('Hà Nội');
    expect(result.unavailable).toBe(false);
});

test('matches Vietnamese titles without accents but excludes description-only matches', async () => {
    expect((await loadJobSuggestions('lap trinh')).data.some(job => job.name === 'Lập trình PL/SQL')).toBe(true);
    const result = await loadJobSuggestions('ETL');
    expect(result.data).toEqual([]);
});

test('expired external jobs disappear from suggestions', async () => {
    jest.setSystemTime(new Date('2026-10-06T05:00:00Z'));
    expect((await loadJobSuggestions('PL')).data.some(job => job.name === 'Lập trình PL/SQL')).toBe(false);
});

test('only catalog external IDs and safe positive native IDs become detail links', async () => {
    jest.spyOn(externalJobs, 'filterExternalJobs').mockReturnValue([
        { id: 'external-unknown' }, { id: '../bad' }, { id: 17 }, null,
    ]);
    suggestJobs.mockResolvedValue({ errCode: 0, data: [
        null, { id: 0, name: 'React' }, { id: -1, name: 'React' }, { id: 2.5, name: 'React' },
        { id: Number.MAX_SAFE_INTEGER + 1, name: 'React' }, { id: '7', name: 'React' },
        { id: 8, name: '' }, { id: 9, name: null },
        { id: 10, name: ' React Developer ', companyName: 'Acme', addressCode: 'Hà Nội' },
    ] });
    expect(await loadJobSuggestions('React')).toEqual({ unavailable: false, data: [
        { id: 10, name: 'React Developer', companyName: 'Acme', addressText: 'Hà Nội',
            detailPath: '/detail-job/10', listingSource: 'native' },
    ] });
});

test('deduplicates IDs while retaining identical titles from distinct employers', async () => {
    suggestJobs.mockResolvedValue({ errCode: 0, data: [
        { id: 1, name: 'React Developer', companyName: 'Acme' },
        { id: 1, name: 'React Developer', companyName: 'Acme' },
        { id: 2, name: 'React Developer', companyName: 'Second company' },
    ] });
    expect((await loadJobSuggestions('React')).data.map(job => [job.id, job.companyName])).toEqual([
        [1, 'Acme'], [2, 'Second company'],
    ]);
});

test('limits results to eight with external vacancies before native vacancies', async () => {
    suggestJobs.mockResolvedValue({ errCode: 0, data: Array.from({ length: 10 }, (_, index) => ({
        id: index + 1, name: `PL/SQL Developer ${index + 1}`,
    })) });
    // A query only one sourced vacancy matches, so the catalogue can grow without changing the test.
    const result = await loadJobSuggestions('PL/SQL');
    expect(result.data).toHaveLength(8);
    expect(result.data[0]).toMatchObject({ name: 'Lập trình PL/SQL', listingSource: 'external' });
    expect(result.data.slice(1).every(job => job.listingSource === 'native')).toBe(true);
});

test.each([
    { errCode: -1 }, { errCode: 0, data: [], httpStatus: 503 }, { errCode: 0, data: null },
])('keeps sourced matches and reports unavailable native suggestions on invalid response %j', async response => {
    suggestJobs.mockResolvedValue(response);
    const result = await loadJobSuggestions('PL');
    expect(result.unavailable).toBe(true);
    expect(result.data.some(job => job.name === 'Lập trình PL/SQL')).toBe(true);
});

test('keeps sourced matches when the native request rejects', async () => {
    suggestJobs.mockRejectedValue(new Error('offline'));
    const result = await loadJobSuggestions('PL');
    expect(result.unavailable).toBe(true);
    expect(result.data.some(job => job.name === 'Lập trình PL/SQL')).toBe(true);
});
