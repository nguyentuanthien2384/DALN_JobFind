import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createSupportChatProxy } from '../api-gateway/src/middlewares/supportChatProxy.js';
import { requestBodies, safeHttpError } from '../shared/httpBoundary.js';
import { registerSupportRoutes } from '../support-chat-service/src/http.js';
import { createResponder } from '../support-chat-service/src/providers.js';

const servers = [];
const listen = async (app) => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
};
afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
});

describe('support chatbot streaming gateway', () => {
    it('streams before completion, forwards JSON to Claude support, strips private headers and cancels upstream', async () => {
        vi.stubEnv('INTERNAL_SECRET', 'test-only-proxy-key');
        const upstream = express(); upstream.use(express.json());
        let received;
        let closeUpstream;
        const closed = new Promise((resolve) => { closeUpstream = resolve; });
        upstream.post('/support/legacy-turn', (req, res) => {
            received = { headers: req.headers, body: req.body };
            res.setHeader('Content-Type', 'text/event-stream');
            res.write('event: token\ndata: {"text":"Xin chào"}\n\n');
            res.on('close', closeUpstream);
        });
        const target = await listen(upstream);
        const gateway = express(); gateway.use(requestBodies(express));
        gateway.post('/api/support-chat', createSupportChatProxy(target));
        const origin = await listen(gateway);
        const controller = new AbortController();
        const body = { messages: [{ role: 'user', text: 'Tìm việc React' }] };
        const response = await fetch(`${origin}/api/support-chat`, { method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: 'secret-token', Cookie: 'session=secret', 'x-internal-secret': 'spoof', 'x-support-ip': '8.8.8.8', 'x-support-signature': 'spoof' }, body: JSON.stringify(body) });
        const reader = response.body.getReader();
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toContain('Xin chào');
        expect(received.body).toEqual(body);
        expect(received.headers.authorization).toBeUndefined();
        expect(received.headers.cookie).toBeUndefined();
        expect(received.headers['x-internal-secret']).toBe('test-only-proxy-key');
        expect(received.headers['x-support-ip']).toBeUndefined();
        expect(received.headers['x-support-signature']).toBeUndefined();
        controller.abort(); await reader.cancel().catch(() => {});
        await closed;
    });

    it('serves old message-history callers through the Claude responder with no Gemini key', async () => {
        vi.stubEnv('INTERNAL_SECRET', 'test-only-proxy-key');
        vi.stubEnv('GEMINI_API_KEY', '');
        const generate = vi.fn(() => ({
            fullStream: (async function* () { yield { type: 'text-delta', text: 'Xin chào từ Claude' }; })(),
            finishReason: Promise.resolve('stop'), totalUsage: Promise.resolve({ inputTokens: 4, outputTokens: 5 })
        }));
        const service = express();
        registerSupportRoutes(service, { store: {}, tools: {}, respond: createResponder({
            providers: [{ name: 'claude', model: {} }], executePublicTool: vi.fn(), generate, retrieve: async () => []
        }) });
        const target = await listen(service);
        const gateway = express(); gateway.use(requestBodies(express));
        gateway.post('/api/support-chat', createSupportChatProxy(target));
        const origin = await listen(gateway);
        const history = [
            { role: 'user', text: 'Xin chào' },
            { role: 'assistant', text: 'Chào bạn' },
            { role: 'user', text: 'Tôi cần hỗ trợ' }
        ];
        const response = await fetch(`${origin}/api/support-chat`, { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history }) });
        const frames = await response.text();
        expect(response.status).toBe(200);
        expect(frames).toContain('event: mode\ndata: {"mode":"claude"}');
        expect(frames).toContain('event: token\ndata: {"text":"Xin chào từ Claude"}');
        expect(frames).toContain('event: done');
        expect(generate.mock.calls[0][0].messages).toEqual(history.map(message => ({ role: message.role, content: message.text })));
        const longHistory = [{ role: 'user', text: 'Xin chào' }, { role: 'assistant', text: 'ắ'.repeat(7900) },
            { role: 'user', text: 'Hỏi tiếp' }];
        const longResponse = await fetch(`${origin}/api/support-chat`, { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: longHistory }) });
        expect(longResponse.status).toBe(200);
        expect(await longResponse.text()).toContain('event: done');
    });

    it('rejects oversized UTF-8 payloads before forwarding', async () => {
        const gateway = express(); gateway.use(requestBodies(express));
        const handler = vi.fn((_req, res) => res.json({ ok: true }));
        gateway.post('/api/support-chat', handler); gateway.use(safeHttpError);
        const origin = await listen(gateway);
        const response = await fetch(`${origin}/api/support-chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: 'ắ'.repeat(17000) }) });
        expect(response.status).toBe(413); expect(handler).not.toHaveBeenCalled();
    });
});
