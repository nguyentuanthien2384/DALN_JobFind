import createListCache, { clearListCaches } from './listCache';

describe('createListCache', () => {
    let now;
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('token_user', 'account-a');
        now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    });
    afterEach(() => now.mockRestore());

    it('remembers a value for five minutes by default', () => {
        const cache = createListCache();
        cache.save('page-1', { rows: [1] });
        expect(cache.read('page-1')).toEqual({ value: { rows: [1] }, savedAt: 1_000_000 });
        now.mockReturnValue(1_000_000 + 5 * 60 * 1000 - 1);
        expect(cache.read('page-1').value).toEqual({ rows: [1] });
        now.mockReturnValue(1_000_000 + 5 * 60 * 1000);
        expect(cache.read('page-1')).toBeNull();
    });

    it('keeps at most `limit` lists, dropping the least recently saved', () => {
        const cache = createListCache({ limit: 2 });
        cache.save('a', 1);
        cache.save('b', 2);
        cache.save('a', 3);
        cache.save('c', 4);
        expect(cache.read('b')).toBeNull();
        expect(cache.read('a').value).toBe(3);
        expect(cache.read('c').value).toBe(4);
    });

    it('never shows one account the lists remembered for another', () => {
        const cache = createListCache();
        cache.save('page-1', 'private to A');
        localStorage.setItem('token_user', 'account-b');
        expect(cache.read('page-1')).toBeNull();
        localStorage.setItem('token_user', 'account-a');
        expect(cache.read('page-1')).toBeNull();
    });

    it('shares one request between callers and reuses a fresh result', async () => {
        const cache = createListCache();
        const fetchList = jest.fn().mockResolvedValue('rows');
        const first = cache.load('page-1', fetchList, { reuseFor: 15_000 });
        const second = cache.load('page-1', fetchList, { reuseFor: 15_000 });
        expect(fetchList).toHaveBeenCalledTimes(1);
        await expect(first).resolves.toBe('rows');
        await expect(second).resolves.toBe('rows');
        await expect(cache.load('page-1', fetchList, { reuseFor: 15_000 })).resolves.toBe('rows');
        expect(fetchList).toHaveBeenCalledTimes(1);
        now.mockReturnValue(1_000_000 + 15_000);
        await cache.load('page-1', fetchList, { reuseFor: 15_000 });
        expect(fetchList).toHaveBeenCalledTimes(2);
    });

    it('does not remember a failed request or a response that arrives after the account changed', async () => {
        const cache = createListCache();
        await expect(cache.load('page-1', () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
        expect(cache.read('page-1')).toBeNull();
        let finish;
        const late = cache.load('page-2', () => new Promise(resolve => { finish = resolve; }));
        localStorage.setItem('token_user', 'account-b');
        finish('rows of A');
        await expect(late).resolves.toBe('rows of A');
        expect(cache.read('page-2')).toBeNull();
    });

    it('can be cleared all at once', () => {
        const one = createListCache();
        const two = createListCache();
        one.save('x', 1);
        two.save('y', 2);
        clearListCaches();
        expect(one.read('x')).toBeNull();
        expect(two.read('y')).toBeNull();
    });
});
