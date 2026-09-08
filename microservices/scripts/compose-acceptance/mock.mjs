import http from 'node:http';

// Test-only HTTP boundary. Never included in the production image.
const calls = [], pushes = [], held = [];
let mode = 'approve', realtimeFail = false;
const reply = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const complete = (res, decision) => {
    const result = decision === 'invalid' ? { approved: 'invalid' } : {
        approved: decision !== 'reject', riskLevel: decision === 'reject' ? 'nguy_hiem' : 'an_toan',
        violations: decision === 'reject' ? ['spam'] : [], reason: 'Synthetic Compose acceptance'
    };
    reply(res, 200, { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'fixture',
        content: [{ type: 'text', text: JSON.stringify(result) }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 } });
};
http.createServer(async (req, res) => {
    try {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1000000) throw Error('body limit'); }
        const body = raw ? JSON.parse(raw) : {};
        const path = new URL(req.url, 'http://fixture').pathname;
        if (path === '/healthz') return reply(res, 200, { ok: true });
        if (path === '/state') return reply(res, 200, { calls, pushes, held: held.length });
        if (path === '/control' && req.method === 'POST') {
            if (body.mode) mode = body.mode;
            if (typeof body.realtimeFail === 'boolean') realtimeFail = body.realtimeFail;
            if (body.release) for (const response of held.splice(0)) complete(response, body.release);
            return reply(res, 200, { ok: true });
        }
        if (path === '/v1/messages' && req.method === 'POST') {
            calls.push({ mode, prompt: body.messages?.[0]?.content });
            if (mode === 'hold') { held.push(res); return; }
            if (mode === 'error') return reply(res, 503, { type: 'error', error: { type: 'overloaded_error', message: 'Synthetic failure' } });
            return complete(res, mode);
        }
        if (path === '/internal/emit-notification' && req.method === 'POST') {
            if (req.headers['x-internal-secret'] !== process.env.INTERNAL_SECRET) return reply(res, 403, {});
            if (realtimeFail) return reply(res, 503, { error: 'Synthetic realtime failure' });
            pushes.push(body); return reply(res, 200, { ok: true });
        }
        reply(res, 404, { error: 'No fixture route' });
    } catch { reply(res, 400, { error: 'Invalid fixture request' }); }
}).listen(4010, '0.0.0.0');
