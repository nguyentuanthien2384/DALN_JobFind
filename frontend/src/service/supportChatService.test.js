import { prepareSupportHistory, streamSupportReply } from './supportChatService';
import { TextDecoder } from 'util';
global.TextDecoder = TextDecoder;

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
