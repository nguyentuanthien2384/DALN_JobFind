import { prepareSupportHistory, streamSupportReply } from './supportChatService';

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
