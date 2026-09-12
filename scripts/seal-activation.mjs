import assert from 'node:assert/strict';
import { readFile, writeFile, stat, access, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './release/verify.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const name = (await readFile(path.join(root, '.local/deployments/LATEST'), 'utf8')).trim();
assert.match(name, /^activation-[0-9TZ-]+$/);
const directory = path.join(root, '.local/deployments', name);
const json = async file => JSON.parse(await readFile(path.join(directory, file), 'utf8'));
const write = (file, value) => writeFile(path.join(directory, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const action = process.argv[2]; assert.ok(['seal', 'verify'].includes(action));
if (action === 'seal') {
    let exists = true; try { await access(path.join(directory, 'activation-manifest.json')); } catch { exists = false; }
    assert.equal(exists, false, 'Never overwrite an existing seal');
    const state = await json('state.json'); assert.equal(state.status, 'features-active');
    const artifacts = await json('frontend-artifacts.json'), base = await json('compose.live.json');
    const rollback = await json('compose.web.rollback.json');
    const files = ['private.json', 'metrics-token', 'nginx-gated.conf', 'frontend-artifacts.json', 'frontend-images.tar', 'frontend-images.sha256',
        'frontend-source.tar', 'web.Dockerfile', 'mysql-schema-before.json'];
    const evidence = ['clone-verification.json', 'live-verification.json', 'runtime-health.json', 'rollback-live.json'];
    for (const variant of [...artifacts.artifacts, { variant: 'rollback', image: rollback.services.web.image }]) {
        const file = 'compose.runtime.' + variant.variant + '.json';
        const config = structuredClone(base); config.services.web.image = variant.image; await write(file, config); files.push(file);
        files.push('compose.web.' + variant.variant + '.json');
        if (variant.variant !== 'rollback') evidence.push('browser-' + variant.variant + '.json');
    }
    // Operational checks refresh their reports; the acceptance snapshots stay immutable.
    for (const file of evidence) {
        await copyFile(path.join(directory, file), path.join(directory, 'evidence-' + file)); files.push('evidence-' + file);
    }
    // Retain the operator recipes that produced this deployment separately from the app commit.
    const recipes = ['package.json', 'scripts/activate-local.mjs', 'scripts/activation-probes.mjs', 'scripts/activation-browser.mjs',
        'scripts/activation-health.mjs', 'scripts/build-activation-web.mjs', 'scripts/manage-activation.mjs', 'scripts/seal-activation.mjs',
        'scripts/backup-local.mjs', 'scripts/backup-integrity.mjs', 'scripts/release/verify.mjs', 'scripts/release/compose-environment.mjs'];
    await promisify(execFile)('tar', ['-cf', path.join(directory, 'operator-source.tar'), ...recipes], { cwd: root, windowsHide: true });
    files.push('operator-source.tar');
    const entries = [];
    for (const file of files) entries.push({ path: file, bytes: (await stat(path.join(directory, file))).size, sha256: await sha256(path.join(directory, file)),
        private: file === 'private.json' || file === 'metrics-token' || file.startsWith('compose.runtime.') });
    await write('activation-manifest.json', { schemaVersion: 1, deploymentId: name, sealedAt: new Date().toISOString(), applicationCommit: state.applicationCommit,
        originalReleaseId: 'bc9cb1c4e070-2026-09-11T14-26-04-972Z', originalManifestSha256: 'f2ec068f3f83f9fc36501df84c45bbf220efc7b5200d5ab9b6fd21f3562cd7e1',
        active: state.activeFrontend, backup: 'backup/manifest.json', files: entries });
    await writeFile(path.join(directory, 'activation-manifest.sha256'), await sha256(path.join(directory, 'activation-manifest.json')) + '\n');
}
assert.equal(await sha256(path.join(directory, 'activation-manifest.json')), (await readFile(path.join(directory, 'activation-manifest.sha256'), 'utf8')).trim());
const manifest = await json('activation-manifest.json'), seen = new Set();
for (const entry of manifest.files) {
    assert.ok(!seen.has(entry.path)); seen.add(entry.path);
    assert.match(entry.path, /^[a-zA-Z0-9._-]+$/); assert.ok(!['.', '..'].includes(entry.path));
    const file = path.join(directory, entry.path); assert.equal((await stat(file)).size, entry.bytes); assert.equal(await sha256(file), entry.sha256, 'Activation artifact drift: ' + entry.path);
}
console.log('PASS sealed activation artifacts: ' + manifest.files.length + ' files; SHA256 ' + await sha256(path.join(directory, 'activation-manifest.json')));
