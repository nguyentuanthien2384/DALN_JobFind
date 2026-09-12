import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256 } from './release/verify.mjs';
import { checkBrowser } from './activation-browser.mjs';
import { rolloutSample, observeRollout } from './rollout-observation.mjs';
import { checkPreparedFlag } from './rollout-pdf-browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), exec = promisify(execFile);
const name = (await readFile(path.join(root, '.local/deployments/LATEST'), 'utf8')).trim();
assert.match(name, /^activation-[0-9TZ-]+$/);
const directory = path.join(root, '.local/deployments', name);
const read = async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'));
const write = (name, value) => writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const state = await read('state.json'), artifacts = await read('frontend-artifacts.json');
const action = process.argv[2] || 'status';
assert.ok(['activate', 'reactivate', 'rollback', 'resume', 'status', 'observe'].includes(action));
const docker = async args => {
    try { return (await exec('docker', args, { cwd: root, windowsHide: true, timeout: 120000, maxBuffer: 3 * 1024 * 1024 })).stdout.trim(); }
    catch { throw Error('Docker operation failed; private configuration output withheld'); }
};
const save = () => write('state.json', state);
const waitFor = async fn => {
    let failure; const end = Date.now() + 60000;
    do { try { return await fn(); } catch (e) { failure = e; await new Promise(r => setTimeout(r, 800)); } } while (Date.now() < end);
    throw failure;
};
const base = await read('compose.live.json');
const oldKit = JSON.parse(await readFile(path.join(root, '.local/releases/bc9cb1c4e070-2026-09-11T14-26-04-972Z/manifest.json'), 'utf8'));
const rollback = { ...oldKit.variants.rollback };
if (state.runtimePatch?.rollbackImage) rollback.image = state.runtimePatch.rollbackImage;
async function switchWeb(artifact) {
    const image = JSON.parse(await docker(['image', 'inspect', artifact.image]))[0]; assert.equal(image.Id, artifact.image);
    const config = { name: 'ai-job-portal', services: { web: { ...base.services.web, image: artifact.image } }, networks: base.networks };
    const file = path.join(state.runtimePatch?.directory || directory, 'compose.web.' + artifact.variant + '.json');
    await writeFile(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    await docker(['compose', '-f', file, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'web']);
    await waitFor(async () => {
        const r = await fetch('http://127.0.0.1:3001/release-info.json', { signal: AbortSignal.timeout(5000) });
        assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
        const { image: _, ...expected } = artifact; assert.deepEqual(await r.json(), expected);
    });
    for (const route of ['/login', '/login/', '/admin/list-post']) {
        const r = await fetch('http://127.0.0.1:3001' + route, { redirect: 'manual' });
        assert.equal(r.status, 200, 'Patched SPA route'); assert.match(await r.text(), /id="root"/);
    }
    for (const route of ['/api/ai/parse-resume', '/api/ai/match-cv', '/api/ai/cover-letter', '/api/AI/match-cv/', '/api/ai/%63over-letter/', '/API/Jobs/', '/api/jobs', '/api/jobs/1', '/api/jobs/1/repost/']) {
        const r = await fetch('http://127.0.0.1:3001' + route, { method: route === '/api/jobs/1' ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(r.status, 503, 'Provider write gate');
    }
    base.services.web.image = artifact.image;
    await write('compose.live.json', base);
    state.activeFrontend = { variant: artifact.variant, image: artifact.image, flags: artifact.flags };
    await save();
}
if (action === 'observe') {
    const evidence = await observeRollout(await rolloutSample(), 30);
    await write('observation-latest.json', evidence);
    console.log('PASS observation: no new service 5xx/errors, restarts or backlog for 30 seconds');
} else if (action === 'status') {
    const r = await fetch('http://127.0.0.1:3001/release-info.json', { signal: AbortSignal.timeout(5000) });
    console.log(JSON.stringify({ status: state.status, serving: await r.json() }, null, 2));
} else {
    const nginxFile = state.runtimePatch?.nginxFile || path.join(directory, 'nginx-gated.conf');
    assert.equal(await sha256(nginxFile), state.runtimePatch?.nginxSha256 || artifacts.nginxSha256, 'Entrypoint config changed');
    if (action === 'rollback') {
        await switchWeb(rollback); state.status = 'runtime-deployed-flags-off'; await save();
        console.log('PASS all frontend flags off; runtime and data retained');
    } else if (action === 'reactivate') {
        const accepted = await read('rollout-prepared-cv.json');
        const artifact = artifacts.artifacts.find(a => a.variant === 'prepared-cv');
        assert.equal(accepted.image, artifact.image); assert.equal(accepted.prepared.enabled, true);
        assert.equal(accepted.observation.newHttp5xx, 0); assert.equal(accepted.observation.unexpectedRestarts, 0);
        try {
            const before = await rolloutSample(); await switchWeb(artifact);
            const browser = await checkBrowser(directory, artifact.variant), prepared = await checkPreparedFlag(true);
            const observation = await observeRollout(before, 25);
            await write('reactivation-verification.json', { image: artifact.image, browser, prepared, observation });
            state.status = 'features-active'; state.activatedAt = new Date().toISOString(); await save();
            console.log('PASS previously accepted frontend restored and verified');
        } catch (error) {
            await switchWeb(rollback); state.status = 'runtime-deployed-flags-off'; await save(); throw error;
        }
    } else if (action === 'resume') {
        assert.ok(state.activeFrontend, 'No accepted frontend');
        // Start the original infrastructure, never recreate its volumes or node identity.
        for (const service of ['mongo', 'postgres', 'rabbitmq', 'redis', 'elasticsearch']) {
            const source = state.sourceBefore.find(c => c.service === service);
            await docker(['start', source.id]);
        }
        await docker(['compose', '-f', path.join(directory, 'compose.live.json'), 'up', '-d', '--no-deps', '--no-build', '--pull', 'never']);
        console.log('Pinned runtime resumed; run deployment verification after readiness');
    } else {
        assert.ok(['runtime-deployed-flags-off', 'features-active', 'activation-in-progress'].includes(state.status));
        assert.equal(await sha256(path.join(directory, 'frontend-images.tar')), (await readFile(path.join(directory, 'frontend-images.sha256'), 'utf8')).trim());
        state.status = 'activation-in-progress'; await save();
        try {
            for (const artifact of artifacts.artifacts) {
                const before = await rolloutSample();
                await switchWeb(artifact);
                const evidence = await checkBrowser(directory, artifact.variant);
                const prepared = await checkPreparedFlag(artifact.variant === 'prepared-cv');
                const observation = await observeRollout(before, 25);
                await write('browser-' + artifact.variant + '.json', evidence);
                await write('rollout-' + artifact.variant + '.json', { stage: artifact.variant, image: artifact.image, flags: artifact.flags, browser: evidence, prepared, observation });
                state.activatedStages ||= []; state.activatedStages = state.activatedStages.filter(s => s.variant !== artifact.variant);
                state.activatedStages.push({ variant: artifact.variant, at: new Date().toISOString(), checks: evidence.checks }); await save();
                console.log('PASS live stage ' + artifact.variant + ': ' + evidence.checks.length + ' browser checks');
            }
            state.status = 'features-active'; state.activatedAt = new Date().toISOString(); delete state.failure; await save();
            console.log('PASS four features active; AI-dependent writes remain gated');
        } catch (error) {
            // Restore the known all-off UI on any acceptance failure. Never restore data.
            await switchWeb(rollback); state.status = 'runtime-deployed-flags-off'; state.failure = 'Feature acceptance failed; reverted all frontend flags'; await save();
            throw error;
        }
    }
}
