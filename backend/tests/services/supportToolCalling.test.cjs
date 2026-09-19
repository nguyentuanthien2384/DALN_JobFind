const assert = require('node:assert/strict');
const { ReadableStream } = require('node:stream/web');
const { streamGemini } = require('../../src/services/supportChatService');
const oldKey = process.env.GEMINI_API_KEY;
const oldFetch = global.fetch;
afterAll(() => {
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
    global.fetch = oldFetch;
});
const response = (packets) => ({ ok: true, status: 200, body: new ReadableStream({
    start(controller) { for (const packet of packets) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(packet)}\n\n`)); controller.close(); }
}) });
test('Gemini invokes bounded public tool, returns verified cards and streams final answer', async () => {
    process.env.GEMINI_API_KEY = 'mock-server-only-key';
    const requests = [];
    const answers = [];
    const cards = [];
    const toolCalls = [];
    global.fetch = async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body), headers: options.headers });
        if (requests.length === 1) return response([{ candidates: [{ content: { role: 'model', parts: [
            { functionCall: { name: 'search_jobs', args: { query: 'React', location: 'Hà Nội' } } }
        ] } }] }]);
        return response([{ candidates: [{ content: { parts: [{ text: 'Tìm thấy 1 tin ' }] } }] },
            { candidates: [{ content: { parts: [{ text: 'React trong JobFind.' }] } }] }]);
    };
    await streamGemini({ messages: [{ role: 'user', text: 'Tìm việc React Hà Nội' }],
        onText: async (chunk) => answers.push(chunk),
        onTool: async (tool) => cards.push(tool),
        runTool: async (name, args) => {
            toolCalls.push({ name, args });
            return { jobs: [{ id: 42, name: 'Frontend React', company: 'ACME', url: '/detail-job/42' }] };
        } });
    assert.deepEqual(answers, ['Tìm thấy 1 tin ', 'React trong JobFind.']);
    assert.deepEqual(toolCalls, [{ name: 'search_jobs', args: { query: 'React', location: 'Hà Nội' } }]);
    assert.equal(cards[0].jobs[0].id, 42);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].body.tools[0].functionDeclarations.length, 2);
    assert.equal(requests[1].body.tools, undefined); // No arbitrary tool loop.
    assert.equal(requests[1].body.contents[1].parts[0].functionCall.name, 'search_jobs');
    assert.equal(requests[1].body.contents[2].parts[0].functionResponse.response.jobs[0].id, 42);
    assert.equal(requests[0].headers['x-goog-api-key'], 'mock-server-only-key');
    assert.ok(!requests[0].url.includes('mock-server-only-key'));
});
test('blocks model from requesting an unapproved write tool', async () => {
    process.env.GEMINI_API_KEY = 'mock-server-only-key';
    global.fetch = async () => response([{ candidates: [{ content: { parts: [
        { functionCall: { name: 'apply_for_job', args: { job_id: 42 } } }
    ] } }] }]);
    await assert.rejects(streamGemini({ messages: [{ role: 'user', text: 'Nộp đơn' }], onText: () => {},
        runTool: () => { throw Error('must not run'); } }), /không được hỗ trợ/);
});

test('cancels while a database tool is still pending', async () => {
    process.env.GEMINI_API_KEY = 'mock-server-only-key';
    global.fetch = async () => response([{ candidates: [{ content: { parts: [
        { functionCall: { name: 'search_jobs', args: {} } }
    ] } }] }]);
    const controller = new AbortController();
    await assert.rejects(streamGemini({ messages: [{ role: 'user', text: 'Tìm việc' }], signal: controller.signal,
        onText: () => {}, runTool: () => { controller.abort(); return new Promise(() => {}); } }), { name: 'AbortError' });
});
