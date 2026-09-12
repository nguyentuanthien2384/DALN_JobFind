import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './release/verify.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), exec = promisify(execFile);
const deployment = (await readFile(path.join(root, '.local/deployments/LATEST'), 'utf8')).trim();
assert.match(deployment, /^activation-[0-9TZ-]+$/);
const directory = path.join(root, '.local/deployments', deployment);
const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
assert.equal(state.status, 'runtime-deployed-flags-off'); assert.ok(!state.runtimePatch, 'Runtime patch already recorded');
const base = JSON.parse(await readFile(path.join(directory, 'compose.live.json'), 'utf8'));
const patch = path.join(directory, 'flags-off-web-' + randomUUID()); await mkdir(patch);
const config = (await readFile(path.join(directory, 'nginx-gated.conf'), 'utf8')).replace('try_files $uri $uri/ /index.html', 'try_files $uri /index.html');
assert.ok(!config.includes('$uri/ /index.html'));
const nginxFile = path.join(patch, 'nginx.conf'); await writeFile(nginxFile, config);
const docker = async args => {
    try { return (await exec('docker', args, { cwd: root, windowsHide: true, timeout: 120000, maxBuffer: 5 * 1024 * 1024 })).stdout.trim(); }
    catch { throw Error('Web patch operation failed; private diagnostics withheld'); }
};
const tag = 'jobfind-flags-off-web:' + path.basename(patch);
const baseTag = 'jobfind-flags-off-base:' + base.services.web.image.replace('sha256:', '');
await docker(['image', 'tag', base.services.web.image, baseTag]);
assert.equal(JSON.parse(await docker(['image', 'inspect', baseTag]))[0].Id, base.services.web.image);
await writeFile(path.join(patch, 'Dockerfile'), 'FROM ' + baseTag + '\nCOPY nginx.conf /etc/nginx/nginx.conf\n');
await docker(['build', '--pull=false', '-t', tag, patch]);
const image = JSON.parse(await docker(['image', 'inspect', tag]))[0].Id;
await docker(['image', 'save', '-o', path.join(patch, 'image.tar'), image]);
const probe = async origin => {
    for (const route of ['/login', '/login/', '/candidate/cv-post', '/admin/list-post']) {
        const r = await fetch(origin + route, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
        assert.equal(r.status, 200, 'SPA route must return app shell: ' + route); assert.match(await r.text(), /id="root"/);
    }
    const asset = await fetch(origin + '/login/images/form-v8.jpg'); assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type'), /image/);
    const info = await (await fetch(origin + '/release-info.json')).json();
    assert.equal(info.variant, 'rollback'); assert.ok(Object.entries(info.flags).every(([k, v]) => v === (k.endsWith('_MODE') ? 'legacy' : 'false')));
    return info;
};
const name = 'jobfind-web-accept-' + randomUUID(); let id;
try {
    id = await docker(['run', '-d', '--name', name, '--network', 'ai-job-portal_default', '--read-only', '--tmpfs', '/tmp:size=64m,mode=1777', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '-p', '127.0.0.1::8080', image]);
    const c = JSON.parse(await docker(['inspect', id]))[0];
    await probe('http://127.0.0.1:' + c.NetworkSettings.Ports['8080/tcp'][0].HostPort);
    console.log('PASS isolated web: login/deep routes, existing assets and all flags off');
} finally { if (id) { await docker(['stop', id]); await docker(['rm', id]); } }
base.services.web.image = image;
base.services.web.volumes = [{ type: 'bind', source: nginxFile, target: '/etc/nginx/nginx.conf', read_only: true }];
const file = path.join(patch, 'compose.web.json');
await writeFile(file, JSON.stringify({ name: base.name, services: { web: base.services.web }, networks: base.networks }, null, 2) + '\n');
await docker(['compose', '-f', file, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'web']);
await probe('http://127.0.0.1:3001');
const evidence = { reason: 'SPA login route collided with public/login directory and redirected to internal port', image,
    nginxFile, nginxSha256: await sha256(nginxFile), imageArchiveSha256: await sha256(path.join(patch, 'image.tar')), isolatedWebPassed: true, liveWebPassed: true, isolatedWebCleaned: true, appliedAt: new Date().toISOString() };
await writeFile(path.join(patch, 'manifest.json'), JSON.stringify(evidence, null, 2) + '\n');
state.runtimePatch = { ...evidence, directory: patch, rollbackImage: image }; state.activeFrontend.image = image;
await writeFile(path.join(directory, 'compose.live.json'), JSON.stringify(base, null, 2) + '\n', { mode: 0o600 });
await writeFile(path.join(directory, 'state.json'), JSON.stringify(state, null, 2) + '\n');
console.log('PASS live web updated; all flags off; original sealed artifacts unchanged');
