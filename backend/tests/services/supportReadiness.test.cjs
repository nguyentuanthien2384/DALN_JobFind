const { ReadableStream } = require('node:stream/web');
const { streamGemini } = require('../../src/services/supportChatService');
const { getJobDetails } = require('../../src/services/supportJobTools');

const originalFetch = global.fetch;
const originalKey = process.env.GEMINI_API_KEY;
beforeEach(() => { process.env.GEMINI_API_KEY = 'readiness-test-key'; });
afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
});
const response = (packets) => ({ ok: true, body: new ReadableStream({ start(controller) {
    for (const packet of packets) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(packet)}\n\n`));
    controller.close();
} }) });
const packet = (parts, finishReason) => ({ candidates: [{ content: { parts }, ...(finishReason && { finishReason }) }] });
const options = () => ({ messages: [{ role: 'user', text: 'Tìm việc React tại Hà Nội' }], onText: jest.fn() });

test.each([undefined, 'MAX_TOKENS', 'SAFETY', 'MALFORMED_FUNCTION_CALL'])(
    'never marks a partial/provider-blocked answer complete: %s', async (finishReason) => {
        global.fetch = jest.fn(async () => response([packet([{ text: 'Câu trả lời đang dở' }], finishReason)]));
        await expect(streamGemini(options())).rejects.toMatchObject({ status: 502 });
    }
);

test('does not execute a tool from an interrupted model turn', async () => {
    global.fetch = jest.fn(async () => response([packet([{ functionCall: { name: 'search_jobs', args: {} } }])]));
    const runTool = jest.fn(async () => ({ jobs: [] }));
    await expect(streamGemini({ ...options(), runTool })).rejects.toMatchObject({ status: 502 });
    expect(runTool).not.toHaveBeenCalled();
});

test('accepts only a provider-confirmed completed answer', async () => {
    global.fetch = jest.fn(async () => response([packet([{ text: 'Xin chào' }]), packet([], 'STOP')]));
    const input = options(); await streamGemini(input);
    expect(input.onText).toHaveBeenCalledWith('Xin chào');
});

test('requires completion on the final tool-answer turn as well', async () => {
    global.fetch = jest.fn()
        .mockResolvedValueOnce(response([packet([{ functionCall: { name: 'search_jobs', args: {} } }], 'STOP')]))
        .mockResolvedValueOnce(response([packet([{ text: 'Kết quả còn dở' }])]));
    const runTool = jest.fn(async () => ({ jobs: [] }));
    await expect(streamGemini({ ...options(), runTool })).rejects.toMatchObject({ status: 502 });
    expect(runTool).toHaveBeenCalledTimes(1);
});

test('preserves provider thought signatures for tools without displaying reasoning', async () => {
    const hiddenPart = { thought: true, text: 'internal reasoning', thoughtSignature: 'opaque-signature' };
    global.fetch = jest.fn()
        .mockResolvedValueOnce(response([packet([hiddenPart, { functionCall: { name: 'search_jobs', args: {} } }], 'STOP')]))
        .mockResolvedValueOnce(response([packet([{ text: 'Không tìm thấy tin phù hợp' }], 'STOP')]));
    const input = options(); await streamGemini({ ...input, runTool: async () => ({ jobs: [] }) });
    expect(input.onText.mock.calls.flat().join('')).not.toContain('internal reasoning');
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).contents[1].parts[0]).toEqual(hiddenPart);
});

test('rejects a prompt-level block without displaying content', async () => {
    global.fetch = jest.fn(async () => response([{ promptFeedback: { blockReason: 'SAFETY' } }]));
    const input = options(); await expect(streamGemini(input)).rejects.toMatchObject({ status: 502 });
    expect(input.onText).not.toHaveBeenCalled();
});

test.each([401, 403, 404, 429, 500])('handles provider HTTP %i without leaking its body or key', async (status) => {
    global.fetch = jest.fn(async () => ({ ok: false, status, body: null }));
    await expect(streamGemini(options())).rejects.toMatchObject({ status: status === 429 ? 429 : status === 500 ? 502 : 503 });
});

test('retains job requirements after the first 400 characters and flags genuinely truncated descriptions', async () => {
    const database = { DetailPost: {}, User: {}, Account: {}, Company: {}, Allcode: {},
        Post: { findOne: jest.fn(async () => ({ id: 42, timeEnd: '1900000000000',
            postDetailData: { name: 'React', descriptionMarkdown: 'Giới thiệu công ty. '.repeat(30) + 'Yêu cầu: 2 năm React; lương 20–30 triệu.' } })) } };
    const context = { database, operators: { gte: Symbol('gte') }, now: 1700000000000 };
    const result = await getJobDetails({ job_id: 42 }, context);
    expect(result.job.description).toContain('2 năm React');
    expect(result.job.descriptionTruncated).toBe(false);
    database.Post.findOne.mockResolvedValue({ id: 42, timeEnd: '1900000000000', postDetailData: { descriptionMarkdown: 'a'.repeat(20000) } });
    const long = await getJobDetails({ job_id: 42 }, context);
    expect(long.job.description.length).toBeLessThanOrEqual(6000);
    expect(long.job.descriptionTruncated).toBe(true);
});
