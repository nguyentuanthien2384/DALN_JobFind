import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

export const digest = value => createHash('sha256').update(value).digest('hex');
// Hash a multiset: independent of row order, but duplicate rows still count.
export function fingerprintRows(rows) {
    const hashes = rows.map(row => digest(JSON.stringify(row))).sort();
    return { count: rows.length, sha256: digest(hashes.join('\n')) };
}

export async function hashFile(file) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

export async function verifyBackup(directory) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (!manifest.files || !Object.keys(manifest.files).length) throw new Error('Backup manifest has no files');
    for (const [name, expected] of Object.entries(manifest.files)) {
        if (name !== path.basename(name) || /[\\/:]/.test(name) || ['.', '..', 'manifest.json'].includes(name)) {
            throw new Error('Unsafe backup entry');
        }
        const file = path.join(directory, name);
        const stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.bytes || await hashFile(file) !== expected.sha256) {
            throw new Error(`Backup integrity mismatch: ${name}`);
        }
    }
    return manifest;
}

export async function markBackupVerified(directory, evidence) {
    assert.equal(evidence.status, 'passed');
    assert.equal(evidence.sourceUnchanged, true);
    assert.equal(evidence.cleaned, true);
    const manifest = await verifyBackup(directory);
    manifest.restoreVerification = { status: 'passed', project: evidence.project, verifiedAt: new Date().toISOString(),
        crashRecovery: true, replacementVolumes: true, messagePayloadsAndHeaders: evidence.delivery.payloadsAndHeadersVerified,
        sourceUnchanged: true, offsiteVerified: false };
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    await verifyBackup(directory);
}

export function verifyCrashData(expected, actual) {
    const before = structuredClone(expected), after = structuredClone(actual);
    const expectedSequences = before.postgres.sequences, actualSequences = after.postgres.sequences;
    assert.deepEqual(Object.keys(actualSequences).sort(), Object.keys(expectedSequences).sort());
    const advances = {};
    for (const [name, sequence] of Object.entries(expectedSequences)) {
        const restored = actualSequences[name];
        assert.equal(restored.is_called, sequence.is_called, 'Sequence call state changed');
        // These application schemas use ascending sequences. Crash recovery can
        // skip WAL-reserved values; it must never reuse a committed identifier.
        assert.ok(BigInt(restored.last_value) >= BigInt(sequence.last_value), 'Sequence regressed after crash');
        if (restored.last_value !== sequence.last_value) advances[name] = {
            before: sequence.last_value, after: restored.last_value
        };
    }
    delete before.postgres.sequences; delete after.postgres.sequences;
    assert.deepEqual(after, before, 'Committed data, schemas or broker definitions changed after crash');
    return advances;
}
