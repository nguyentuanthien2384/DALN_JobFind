import { prepareSupportHistory, streamSupportReply } from './supportChatService';
import { TextDecoder } from 'util';
global.TextDecoder = TextDecoder;
const mockGetAccessToken = jest.fn();
jest.mock('../auth/authClient', () => ({ getAccessToken: (...args) => mockGetAccessToken(...args) }));

describe('guest conversation identity', () => {
    const previousFetch = global.fetch;
    const key = 'jobfind-support-guest';
    const freshClient = () => {
        let client;
        jest.isolateModules(() => { client = require('./supportChatService'); });
        return client;
    };
    const response = (token, data = []) => ({
        ok: true,
        headers: { get: name => name === 'X-Support-Guest' ? token : null },
        json: async () => ({ errCode: 0, data })
    });
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        mockGetAccessToken.mockReset().mockResolvedValue(null);
        global.fetch = jest.fn(async () => response());
    });
    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        global.fetch = previousFetch;
    });

    test('reopens server history after the browser session is recreated without storing conversation text', async () => {
        global.fetch.mockResolvedValueOnce(response('guest-capability', [{ id: 'thread-1', title: 'My private question' }]));
        await freshClient().supportApi.list();
        expect(localStorage.getItem(key)).toBe('guest-capability');
        expect(localStorage).toHaveLength(1);
        expect(sessionStorage.getItem(key)).toBeNull();

        sessionStorage.clear();
        await freshClient().supportApi.list();
        expect(global.fetch.mock.calls[1][1].headers['X-Support-Guest']).toBe('guest-capability');
    });

    test('migrates an existing tab identity without creating a new history owner', async () => {
        sessionStorage.setItem(key, 'existing-history');
        await freshClient().supportApi.list();
        expect(global.fetch.mock.calls[0][1].headers['X-Support-Guest']).toBe('existing-history');
        expect(localStorage.getItem(key)).toBe('existing-history');
        expect(sessionStorage.getItem(key)).toBeNull();
    });

    test('prefers the persistent identity over stale tab identities and follows shared changes', async () => {
        localStorage.setItem(key, 'shared-history');
        sessionStorage.setItem(key, 'stale-tab-history');
        const client = freshClient();
        await client.supportApi.list();
        expect(global.fetch.mock.calls[0][1].headers['X-Support-Guest']).toBe('shared-history');
        expect(sessionStorage.getItem(key)).toBeNull();
        localStorage.setItem(key, 'new-shared-history');
        await client.supportApi.list();
        expect(global.fetch.mock.calls[1][1].headers['X-Support-Guest']).toBe('new-shared-history');
    });

    test('falls back to tab storage when persistent writes are blocked', async () => {
        const setItem = Storage.prototype.setItem;
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (name, value) {
            if (this === localStorage) throw new DOMException('Storage is full', 'QuotaExceededError');
            return setItem.call(this, name, value);
        });
        global.fetch.mockResolvedValueOnce(response('tab-history'));
        await freshClient().supportApi.list();
        expect(sessionStorage.getItem(key)).toBe('tab-history');
        await freshClient().supportApi.list();
        expect(global.fetch.mock.calls[1][1].headers['X-Support-Guest']).toBe('tab-history');
    });

    test('continues in memory and can reset when all browser storage is blocked', async () => {
        const denied = () => { throw new DOMException('Storage is blocked', 'SecurityError'); };
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
        jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied);
        mockGetAccessToken.mockRejectedValue(new DOMException('Storage is blocked', 'SecurityError'));
        global.fetch.mockResolvedValueOnce(response('memory-history'));
        const client = freshClient();
        await client.supportApi.list();
        await client.supportApi.list();
        expect(global.fetch.mock.calls[1][1].headers['X-Support-Guest']).toBe('memory-history');
        client.supportApi.resetGuest();
        await client.supportApi.list();
        expect(global.fetch.mock.calls[2][1].headers).not.toHaveProperty('X-Support-Guest');
    });

    test('reset clears both stores and late responses cannot restore the old identity', async () => {
        localStorage.setItem(key, 'old-history');
        sessionStorage.setItem(key, 'old-tab-history');
        const client = freshClient();
        let finish;
        let started;
        const requestStarted = new Promise(resolve => { started = resolve; });
        global.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; started(); }));
        const pending = client.supportApi.list();
        await requestStarted;
        client.supportApi.resetGuest();
        finish(response('old-history'));
        await pending;
        expect(localStorage.getItem(key)).toBeNull();
        expect(sessionStorage.getItem(key)).toBeNull();
        await client.supportApi.list();
        expect(global.fetch.mock.calls[1][1].headers).not.toHaveProperty('X-Support-Guest');
    });

    test('does not replace a newer shared identity with a delayed response', async () => {
        localStorage.setItem(key, 'original-history');
        global.fetch.mockImplementationOnce(async () => {
            localStorage.setItem(key, 'new-shared-history');
            return response('original-history');
        });
        await freshClient().supportApi.list();
        expect(localStorage.getItem(key)).toBe('new-shared-history');
    });

    test('preserves history identity on network and expiry errors until explicit reset', async () => {
        localStorage.setItem(key, 'saved-history');
        const client = freshClient();
        global.fetch.mockRejectedValueOnce(new Error('Network offline'));
        await expect(client.supportApi.list()).rejects.toThrow('Network offline');
        global.fetch.mockResolvedValueOnce({ ok: false, status: 401,
            json: async () => ({ errCode: 1, errMessage: 'Phiên hỗ trợ đã hết hạn.' }) });
        await expect(client.supportApi.list()).rejects.toThrow('Phiên hỗ trợ đã hết hạn.');
        expect(localStorage.getItem(key)).toBe('saved-history');
    });

    test('keeps authenticated requests separate and does not mask authentication failures', async () => {
        localStorage.setItem(key, 'guest-history');
        mockGetAccessToken.mockResolvedValueOnce('account-token');
        global.fetch.mockResolvedValueOnce(response('unexpected-guest'));
        const client = freshClient();
        await client.supportApi.list();
        expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer account-token');
        expect(global.fetch.mock.calls[0][1].headers).not.toHaveProperty('X-Support-Guest');
        expect(localStorage.getItem(key)).toBe('guest-history');
        mockGetAccessToken.mockRejectedValueOnce(new Error('Session expired'));
        await expect(client.supportApi.list()).rejects.toThrow('Session expired');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('also persists the guest identity issued by a streamed first message', async () => {
        const chunks = [Buffer.from('event: token\ndata: {"text":"Xin chào"}\n\nevent: done\ndata: {}\n\n')];
        global.fetch.mockResolvedValueOnce({ ...response('stream-history'), body: { getReader: () => ({
            read: async () => chunks.length ? { value: chunks.shift(), done: false } : { done: true },
            cancel: async () => {}, releaseLock: () => {}
        }) } });
        await freshClient().streamSupportReply([], { turn: { text: 'Xin chào' }, onText: () => {} });
        expect(localStorage.getItem(key)).toBe('stream-history');
        await freshClient().supportApi.list();
        expect(global.fetch.mock.calls[1][1].headers['X-Support-Guest']).toBe('stream-history');
    });
});

describe('public assistant SSE adapter', () => {
    const previousFetch = global.fetch;
    afterEach(() => { global.fetch = previousFetch; });

    test('never sends unfinished assistant responses or extra client-side fields', () => {
        expect(prepareSupportHistory([
            { role: 'user', text: ' hello ', privateId: 3 },
            { role: 'assistant', text: 'unfinished', status: 'cancelled' },
            { role: 'user', text: 'question', status: 'complete' }
        ])).toEqual([{ role: 'user', text: 'question' }]);
    });

    test('trims whole old turns to the server budget and retains job IDs for follow-up', () => {
        const history = prepareSupportHistory([
            { role: 'user', text: 'a'.repeat(1400) },
            { role: 'assistant', text: 'b'.repeat(6000) },
            { role: 'user', text: 'c'.repeat(1400) },
            { role: 'assistant', text: 'd'.repeat(3000), cards: [{ id: 42 }] },
            { role: 'user', text: 'Cho xem chi tiết tin đầu tiên' }
        ]);
        expect(history).toHaveLength(3);
        expect(history[1].text).toContain('#42');
        expect(history.reduce((size, item) => size + item.text.length, 0)).toBeLessThanOrEqual(8500);
    });

    test('never reuses failed answers in future model context', () => {
        expect(prepareSupportHistory([
            { role: 'user', text: 'Câu hỏi trước' },
            { role: 'assistant', text: 'Câu trả lời chưa hoàn tất', status: 'failed' },
            { role: 'user', text: 'Câu hỏi mới' }
        ])).toEqual([{ role: 'user', text: 'Câu hỏi mới' }]);
    });

    test('rejects truncated streams and releases the reader', async () => {
        const cancel = jest.fn(async () => {});
        const chunks = [Buffer.from('event: token\ndata: {"text":"partial"}\n\n')];
        global.fetch = jest.fn(async () => ({ ok: true, body: { getReader: () => ({
            read: async () => chunks.length ? { value: chunks.shift(), done: false } : { done: true },
            cancel, releaseLock: () => {}
        }) } }));
        await expect(streamSupportReply([{ role: 'user', text: 'hi' }], { onText: () => {} })).rejects.toThrow('Kết nối bị ngắt');
        expect(cancel).toHaveBeenCalled();
    });

    test('forwards tool frames separately without treating them as model text', async () => {
        const payload = 'event: tool\ndata: {"name":"search_jobs","jobs":[{"id":42,"name":"React"}]}\n\nevent: token\ndata: {"text":"Tìm thấy 1 tin."}\n\nevent: done\ndata: {}\n\n';
        const bytes = Buffer.from(payload, 'utf8');
        const chunks = [bytes.slice(0, 27), bytes.slice(27)];
        global.fetch = jest.fn(async () => ({ ok: true, body: { getReader: () => ({
            read: async () => chunks.length ? { value: chunks.shift(), done: false } : { done: true },
            cancel: async () => {}, releaseLock: () => {}
        }) } }));
        const tools = [];
        const texts = [];
        await expect(streamSupportReply([{ role: 'user', text: 'Tìm việc React' }], {
            onTool: (tool) => tools.push(tool), onText: (text) => texts.push(text)
        })).resolves.toBe('Tìm thấy 1 tin.');
        expect(tools).toEqual([{ name: 'search_jobs', jobs: [{ id: 42, name: 'React' }] }]);
        expect(texts).toEqual(['Tìm thấy 1 tin.']);
    });

    test('handles frames split across network chunks', async () => {
        const payload = 'event: token\ndata: {"text":"Xin "}\n\nevent: token\ndata: {"text":"chào"}\n\nevent: done\ndata: {}\n\n';
        const bytes = Buffer.from(payload, 'utf8');
        const chunks = [bytes.slice(0, 21), bytes.slice(21)];
        global.fetch = jest.fn(async () => ({ ok: true,
            body: { getReader: () => ({
                read: async () => chunks.length ? { value: chunks.shift(), done: false } : { done: true },
                cancel: async () => {}, releaseLock: () => {}
            }) }
        }));
        const received = [];
        await expect(streamSupportReply([{ role: 'user', text: 'hi' }], { onText: (text) => received.push(text) }))
            .resolves.toBe('Xin chào');
        expect(received).toEqual(['Xin ', 'Xin chào']);
    });
});
