// Packs vendor/braces into the tarball that frontend and microservices install
// through npm overrides. Run after editing vendor/braces, then reinstall both
// packages so their lockfiles pick up the new integrity hash.
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consumers = ['frontend', 'microservices'];

const work = mkdtempSync(path.join(tmpdir(), 'jobfind-vendor-'));
try {
    // One command string: npm is a .cmd shim on Windows and needs a shell.
    const [packed] = JSON.parse(execSync(`npm pack "${path.join(root, 'vendor/braces')}" --pack-destination "${work}" --json`, { encoding: 'utf8' }));
    for (const consumer of consumers) {
        mkdirSync(path.join(root, consumer, 'vendor'), { recursive: true });
        copyFileSync(path.join(work, packed.filename), path.join(root, consumer, 'vendor', packed.filename));
        console.log(`${consumer}/vendor/${packed.filename} ${packed.integrity}`);
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}
