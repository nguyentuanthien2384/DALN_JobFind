import { streamSupportGateway } from '../../src/services/supportGatewayService';

const previousUrl = process.env.SUPPORT_CHAT_GATEWAY_URL;
const previousFetch = global.fetch;
const messages = [{ role: 'user', text: 'Tìm việc React' }];
const frame = (event, payload) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
const sse = (chunks) => new Response(new ReadableStream({
    start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
    }
}), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });

beforeEach(() => { process.env.SUPPORT_CHAT_GATEWAY_URL = 'http://localhost:4000/api/support-chat'; });
afterAll(() => {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPPORT_CHAT_GATEWAY_URL;
    else process.env.SUPPORT_CHAT_GATEWAY_URL = previousUrl;
});

test('forwards only supported Gateway frames from split SSE chunks and requires completion', async () => {
    const frames = frame('mode', { mode: 'grounded' }) + frame('token', { text: 'Xin chào' })
        + frame('unexpected', { secret: 'discard' }) + frame('done', {});
    global.fetch = jest.fn(async () => sse([frames.slice(0, 16), frames.slice(16, 41), frames.slice(41)]));
    const onEvent = jest.fn();
    await streamSupportGateway({ messages, onEvent });
    expect(global.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
        method: 'POST', body: JSON.stringify({ messages }), headers: expect.objectContaining({ Accept: 'text/event-stream' })
    }));
    expect(onEvent.mock.calls).toEqual([['mode', { mode: 'grounded' }], ['token', { text: 'Xin chào' }]]);
});

test('rejects incomplete streams and upstream errors without exposing provider response', async () => {
    global.fetch = jest.fn(async () => sse([frame('token', { text: 'partial' })]));
    await expect(streamSupportGateway({ messages, onEvent: jest.fn() })).rejects.toMatchObject({ status: 502 });
    global.fetch = jest.fn(async () => sse([frame('error', { message: 'secret-provider-body' })]));
    await expect(streamSupportGateway({ messages, onEvent: jest.fn() })).rejects.toMatchObject({ status: 502 });
    global.fetch = jest.fn(async () => new Response('secret-provider-body', { status: 503 }));
    await expect(streamSupportGateway({ messages, onEvent: jest.fn() })).rejects.toMatchObject({ status: 503 });
});

test('rejects invalid bridge URL before making a request', async () => {
    process.env.SUPPORT_CHAT_GATEWAY_URL = 'file:///etc/passwd';
    global.fetch = jest.fn();
    await expect(streamSupportGateway({ messages, onEvent: jest.fn() })).rejects.toMatchObject({ status: 503 });
    expect(global.fetch).not.toHaveBeenCalled();
    process.env.SUPPORT_CHAT_GATEWAY_URL = `http://localhost:${process.env.PORT || 5000}/api/support-chat`;
    await expect(streamSupportGateway({ messages, onEvent: jest.fn() })).rejects.toMatchObject({ status: 503 });
    expect(global.fetch).not.toHaveBeenCalled();
});
