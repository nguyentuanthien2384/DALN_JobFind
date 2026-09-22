import { clearApplicationIntent, getApplicationReturnPath, readApplicationIntent, rememberApplicationIntent } from './applicationIntent';

const KEY = 'jobfind:application-intent';
beforeEach(() => sessionStorage.clear());
afterEach(() => jest.restoreAllMocks());

it('remembers only navigation context and returns to the job after authentication', () => {
    expect(rememberApplicationIntent({ jobId: 42, jobTitle: 'Lập trình viên' })).toBe(true);
    expect(readApplicationIntent()).toEqual({ jobId: '42', jobTitle: 'Lập trình viên', createdAt: expect.any(Number) });
    expect(getApplicationReturnPath(null)).toBeNull();
    expect(getApplicationReturnPath({ roleCode: 'CANDIDATE' })).toBe('/detail-job/42');
    expect(getApplicationReturnPath({ roleCode: 'EMPLOYER' })).toBe('/detail-job/42');
    clearApplicationIntent();
    expect(getApplicationReturnPath({ roleCode: 'CANDIDATE' })).toBeNull();
});

it('expires abandoned applications after thirty minutes', () => {
    const now = Date.now();
    rememberApplicationIntent({ jobId: 42, jobTitle: 'Lập trình viên' });
    jest.spyOn(Date, 'now').mockReturnValue(now + 30 * 60 * 1000 + 1);
    expect(readApplicationIntent()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
});

it.each(['https://outside.test', '../login', '42?redirect=https://outside.test', '0', '-1'])('rejects a job id that is not a positive id: %s', jobId => {
    expect(rememberApplicationIntent({ jobId, jobTitle: 'Tin' })).toBe(false);
    expect(getApplicationReturnPath({ roleCode: 'CANDIDATE' })).toBeNull();
});

it.each(['invalid json', JSON.stringify({ jobId: '42', jobTitle: 'Tin', createdAt: 'today' }),
    JSON.stringify({ jobId: '42', jobTitle: 'Tin', createdAt: Date.now() + 86400000 })])('discards corrupt or future-dated context', value => {
    sessionStorage.setItem(KEY, value);
    expect(readApplicationIntent()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
});

it('does not block viewing the job when browser storage is unavailable', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled'); });
    expect(rememberApplicationIntent({ jobId: 42, jobTitle: 'Tin' })).toBe(false);
});
