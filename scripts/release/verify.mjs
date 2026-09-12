import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, lstat, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export async function sha256(file) {
    const hash = createHash('sha256');
    for await (const part of createReadStream(file)) hash.update(part);
    return hash.digest('hex');
}
export async function inventory(root, relative = '') {
    const result = [];
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
        const name = path.posix.join(relative, entry.name);
        if (entry.isSymbolicLink()) throw new Error('Symlink forbidden: ' + name);
        if (entry.isDirectory()) result.push(...await inventory(root, name));
        else if (entry.isFile()) result.push(name);
        else throw new Error('Unsupported file: ' + name);
    }
    return result.sort();
}
export async function verify(root) {
    const manifestFile = path.join(root, 'manifest.json');
    const expected = (await readFile(path.join(root, 'manifest.sha256'), 'utf8')).trim();
    if (await sha256(manifestFile) !== expected) throw new Error('Manifest checksum mismatch');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid manifest');
    const names = new Set();
    for (const file of manifest.files) {
        if (!file.path || file.path.includes('\\') || file.path.includes(':') || file.path.startsWith('/') || file.path.split('/').some(p => !p || p === '.' || p === '..') || names.has(file.path)) throw new Error('Unsafe or duplicate manifest path');
        names.add(file.path);
        // Check every parent, not only the final file.
        let resolved = root;
        for (const part of file.path.split('/')) {
            resolved = path.join(resolved, part);
            if ((await lstat(resolved)).isSymbolicLink()) throw new Error('Symlink forbidden');
        }
        const stat = await lstat(resolved);
        if (!stat.isFile() || stat.size !== file.bytes || await sha256(resolved) !== file.sha256) throw new Error('Artifact checksum mismatch: ' + file.path);
    }
    const actual = (await inventory(root)).filter(p => !['manifest.json', 'manifest.sha256'].includes(p));
    if (actual.length !== names.size || actual.some(p => !names.has(p))) throw new Error('Unlisted artifact in kit');
    return manifest;
}
// Called only while preparing a kit, before its manifest hash is handed over.
export async function seal(root, manifest) {
    const files = [];
    for (const name of (await inventory(root)).filter(p => !['manifest.json', 'manifest.sha256'].includes(p))) {
        files.push({ path: name, bytes: (await lstat(path.join(root, name))).size, sha256: await sha256(path.join(root, name)) });
    }
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, files }, null, 2) + '\n');
    await writeFile(path.join(root, 'manifest.sha256'), await sha256(path.join(root, 'manifest.json')) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    if (args.some(a => a.startsWith('--') && a !== '--load')) throw new Error('Usage: node verify.mjs [kit-directory] [--load]');
    const root = path.resolve(args.find(a => !a.startsWith('--')) || path.dirname(fileURLToPath(import.meta.url)));
    const manifest = await verify(root);
    if (args.includes('--load')) {
        execFileSync('docker', ['image', 'load', '-i', path.join(root, 'images.tar')], { stdio: 'inherit' });
        for (const image of manifest.images) {
            const actual = JSON.parse(execFileSync('docker', ['image', 'inspect', image.id], { encoding: 'utf8' }))[0];
            if (actual.Id !== image.id || actual.Os !== image.os || actual.Architecture !== image.architecture) throw new Error('Loaded image mismatch: ' + image.role);
        }
    }
    console.log('PASS release integrity: ' + manifest.releaseId + (args.includes('--load') ? '; exact images loaded, no containers started' : ''));
}
