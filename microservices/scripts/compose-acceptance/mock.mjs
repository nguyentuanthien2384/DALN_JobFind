import http from 'node:http';

// Test-only HTTP boundary. Never included in the production image.
const calls = [], pushes = [], held = [];
let mode = 'approve', realtimeFail = false;
const reply = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const candidateResult = (res, body) => {
    const base = { id:'msg_candidate', type:'message', role:'assistant', model:'fixture', content:[],
        stop_reason:null, stop_sequence:null, usage:{input_tokens:1,output_tokens:1} };
    if (body.stream) {
        res.writeHead(200, {'content-type':'text/event-stream'});
        const event = data => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
        event({type:'message_start',message:base});
        event({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
        event({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Synthetic application letter.'}});
        event({type:'content_block_stop',index:0});
        event({type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:4}});
        event({type:'message_stop'});res.end();return true;
    }
    const fields = body.output_config?.format?.schema?.properties || {};
    let result;
    if (fields.fullName) result = { fullName:'Synthetic Candidate',email:'candidate@example.invalid',phone:null,address:null,
        title:'Developer',summary:'Node services',yearsOfExperience:2,skills:['Node'],languages:['Vietnamese'],
        experiences:[{company:'Example',position:'Developer',duration:'2024–2026',description:'Services'}],
        educations:[{school:'Example School',major:'CS',degree:'BSc',year:'2024'}] };
    else if (fields.score) result = {score:80,verdict:'phu_hop',matchedSkills:['Node'],missingSkills:[],strengths:['Services'],concerns:[],summary:'Synthetic match'};
    else return false;
    reply(res,200,{...base,stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(result)}]});return true;
};
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
            if (candidateResult(res, body)) return;
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
