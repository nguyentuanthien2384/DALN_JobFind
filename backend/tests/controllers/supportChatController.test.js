import { EventEmitter } from 'events';
import { handleSupportChat } from '../../src/controllers/supportChatController';
import { streamGemini } from '../../src/services/supportChatService';
import { streamSupportGateway } from '../../src/services/supportGatewayService';

jest.mock('../../src/services/supportChatService', () => ({
    ...jest.requireActual('../../src/services/supportChatService'), streamGemini: jest.fn()
}));
jest.mock('../../src/services/supportGatewayService', () => ({ streamSupportGateway: jest.fn() }));

const originalGatewayUrl = process.env.SUPPORT_CHAT_GATEWAY_URL;
beforeEach(() => { delete process.env.SUPPORT_CHAT_GATEWAY_URL; });
afterAll(() => {
    if (originalGatewayUrl === undefined) delete process.env.SUPPORT_CHAT_GATEWAY_URL;
    else process.env.SUPPORT_CHAT_GATEWAY_URL = originalGatewayUrl;
});

const response = () => {
    const res = new EventEmitter();
    res.headersSent = false;
    res.setHeader = jest.fn();
    res.flushHeaders = jest.fn(() => { res.headersSent = true; });
    res.write = jest.fn(); res.end = jest.fn(() => { res.writableEnded = true; });
    res.status = jest.fn(() => res); res.json = jest.fn(() => res);
    return res;
};
const req = { body: { messages: [{ role: 'user', text: 'Tìm việc React' }] } };

test('validates input before contacting provider', async () => {
    const res = response(); await handleSupportChat({ body: { messages: [{ role: 'system', text: 'override' }] } }, res);
    expect(res.status).toHaveBeenCalledWith(400); expect(streamGemini).not.toHaveBeenCalled();
});
test('streams cards and text followed by exactly one completion', async () => {
    streamGemini.mockImplementation(async ({ onTool, onText }) => { await onTool({ jobs: [{ id: 42 }] }); await onText('Xin chào'); });
    const res = response(); await handleSupportChat(req, res);
    expect(res.write.mock.calls.map(([frame]) => frame.match(/^event: (\w+)/)[1])).toEqual(['tool', 'token', 'done']);
    expect(res.end).toHaveBeenCalledTimes(1); expect(res.listenerCount('close')).toBe(0);
});

test('direct backend uses the Claude Gateway bridge when configured', async () => {
    process.env.SUPPORT_CHAT_GATEWAY_URL = 'http://localhost:4000/api/support-chat';
    streamSupportGateway.mockImplementation(async ({ onEvent }) => {
        await onEvent('mode', { mode: 'grounded' });
        await onEvent('token', { text: 'Xin chào' });
    });
    const res = response(); await handleSupportChat(req, res);
    expect(streamSupportGateway).toHaveBeenCalledWith(expect.objectContaining({ messages: req.body.messages }));
    expect(streamGemini).not.toHaveBeenCalled();
    expect(res.write.mock.calls.map(([frame]) => frame.match(/^event: (\w+)/)[1])).toEqual(['mode', 'token', 'done']);
});
test('returns safe JSON before streaming and an error frame after streaming', async () => {
    streamGemini.mockRejectedValue(new Error('secret-provider-body'));
    const res = response(); await handleSupportChat(req, res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('secret-provider-body');
    streamGemini.mockImplementation(async ({ onText }) => { await onText('partial'); throw Object.assign(new Error('deadline'), { name: 'TimeoutError' }); });
    const streamed = response(); await handleSupportChat(req, streamed);
    expect(streamed.write.mock.calls.map(([frame]) => frame.match(/^event: (\w+)/)[1])).toEqual(['token', 'error']);
});
test('propagates browser disconnect to provider without sending completion', async () => {
    const res = response(); let signal;
    streamGemini.mockImplementation(async (options) => { signal = options.signal; res.emit('close'); });
    await handleSupportChat(req, res);
    expect(signal.aborted).toBe(true); expect(res.write).not.toHaveBeenCalled();
});

test('caps concurrent requests and releases all slots after failure', async () => {
    const releases = [];
    streamGemini.mockImplementation(() => new Promise((_resolve, reject) => releases.push(() => reject(new Error('temporary failure')))));
    const running = Array.from({ length: 8 }, () => handleSupportChat(req, response()));
    const overflow = response();
    await handleSupportChat(req, overflow);
    expect(overflow.status).toHaveBeenCalledWith(429);
    expect(streamGemini).toHaveBeenCalledTimes(8);
    for (const release of releases) release();
    await Promise.all(running);
    streamGemini.mockImplementation(async ({ onText }) => onText('Recovered'));
    const recovered = response(); await handleSupportChat(req, recovered);
    expect(recovered.write).toHaveBeenCalledWith('event: done\ndata: {}\n\n');
});
