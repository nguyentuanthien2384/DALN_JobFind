import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const ports = { 'api-gateway': 4000, 'identity-service': 4001, 'job-core-service': 4002, 'search-service': 4003, 'application-service': 4004, 'notification-service': 4005, 'admin-service': 4006 };
async function docker(args) {
    try { return (await exec('docker', args, { windowsHide: true, timeout: 30000, maxBuffer: 12 * 1024 * 1024 })); }
    catch { throw Error('Rollout observation unavailable; private output withheld'); }
}
export async function rolloutSample() {
    const ids = (await docker(['ps', '-aq', '--filter', 'label=com.docker.compose.project=ai-job-portal'])).stdout.trim().split(/\s+/).filter(Boolean);
    const all = JSON.parse((await docker(['inspect', ...ids])).stdout);
    const find = name => { const c = all.find(c => c.Config.Labels['com.docker.compose.service'] === name); assert.ok(c?.State.Running, 'Service stopped: ' + name); return c; };
    const gateway = find('api-gateway');
    const code = `import{readFileSync}from'node:fs';const token=process.env.METRICS_TOKEN||readFileSync(process.env.METRICS_TOKEN_FILE,'utf8').trim();const out={};for(const[name,port]of Object.entries(${JSON.stringify(ports)})){const base='http://'+name+':'+port;const ready=await fetch(base+'/readyz',{signal:AbortSignal.timeout(5000)});const r=await fetch(base+'/metrics',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Metrics unavailable');const text=await r.text();const errors=text.split(String.fromCharCode(10)).filter(l=>l.startsWith('jobfind_http_requests_total{')&&/status="5[0-9][0-9]"/.test(l)).reduce((n,l)=>n+Number(l.slice(l.lastIndexOf(' ')+1)),0);out[name]={ready:ready.status,http5xx:errors};}console.log(JSON.stringify(out));`;
    const services = JSON.parse((await docker(['exec', gateway.Id, 'node', '--input-type=module', '-e', code])).stdout);
    for (const [name, data] of Object.entries(services)) { assert.equal(data.ready, 200, 'Readiness failed: ' + name); const c = find(name); Object.assign(data, { id: c.Id, restarts: c.RestartCount, startedAt: c.State.StartedAt }); }
    const backend = find('backend');
    assert.equal((await docker(['exec', backend.Id, 'node', '-e', "fetch('http://127.0.0.1:5000/health',{signal:AbortSignal.timeout(5000)}).then(r=>console.log(r.status))"])).stdout.trim(), '200');
    services.backend = { id: backend.Id, restarts: backend.RestartCount, startedAt: backend.State.StartedAt, ready: 200 };
    const queues = JSON.parse((await docker(['exec', find('rabbitmq').Id, 'rabbitmqctl', 'list_queues', '--formatter', 'json', 'name', 'messages_ready', 'messages_unacknowledged', 'consumers'])).stdout);
    return { at: new Date().toISOString(), services, queues };
}
export async function observeRollout(before, seconds = 25) {
    assert.ok(seconds >= 0 && seconds <= 60);
    const samples = [], end = Date.now() + seconds * 1000;
    do {
        const sample = await rolloutSample(); samples.push(sample);
        for (const [name, data] of Object.entries(sample.services)) {
            assert.equal(data.id, before.services[name].id, 'App unexpectedly replaced: ' + name);
            assert.equal(data.restarts, before.services[name].restarts, 'App restarted: ' + name);
            assert.equal(data.startedAt, before.services[name].startedAt, 'App restarted: ' + name);
            if (data.http5xx !== undefined) assert.equal(data.http5xx, before.services[name].http5xx, 'New HTTP 5xx: ' + name);
        }
        assert.ok(sample.queues.every(q => q.messages_ready === 0 && q.messages_unacknowledged === 0), 'Queue backlog during acceptance');
        const remaining = end - Date.now(); if (remaining > 0) await new Promise(r => setTimeout(r, Math.min(8000, remaining)));
    } while (Date.now() < end);
    const logs = {};
    for (const [name, service] of Object.entries(before.services)) {
        const value = await docker(['logs', '--since', before.at, service.id]);
        let errors = 0, warnings = 0, expectedClientDenials = 0;
        for (const line of (value.stdout + String.fromCharCode(10) + value.stderr).split(String.fromCharCode(10))) {
            let row; try { row = JSON.parse(line); } catch { continue; }
            if (row.level === 'error') errors++;
            if (row.level === 'warn') { if (row.status >= 400 && row.status < 500) expectedClientDenials++; else warnings++; }
        }
        logs[name] = { errors, warnings, expectedClientDenials }; assert.equal(errors, 0, 'Service logged new error: ' + name);
    }
    return { from: before.at, to: new Date().toISOString(), minimumObservationSeconds: seconds, samples: samples.length,
        newHttp5xx: 0, unexpectedRestarts: 0, queueReady: 0, queueUnacked: 0, logs };
}
