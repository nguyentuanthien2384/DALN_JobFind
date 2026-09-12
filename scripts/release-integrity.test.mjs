import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256, verify } from './release/verify.mjs';

test('release verification rejects corruption, missing/unlisted files and traversal before load', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jobfind-release-test-'));
    const seal = async files => {
        await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 1, files }));
        await writeFile(path.join(root, 'manifest.sha256'), await sha256(path.join(root, 'manifest.json')));
    };
    try {
        const artifact = path.join(root, 'image.tar');
        await writeFile(artifact, 'original');
        const files = [{ path: 'image.tar', bytes: 8, sha256: await sha256(artifact) }];
        await seal(files); await verify(root);
        await writeFile(artifact, 'modified');
        await assert.rejects(verify(root), /checksum mismatch/);
        await writeFile(artifact, 'original'); await writeFile(path.join(root, 'extra'), 'extra');
        await assert.rejects(verify(root), /Unlisted/); await rm(path.join(root, 'extra'));
        await seal([...files, ...files]); await assert.rejects(verify(root), /duplicate/);
        await seal([{ ...files[0], path: '../outside' }]); await assert.rejects(verify(root), /Unsafe/);
        await seal(files); await rm(artifact); await assert.rejects(verify(root), /ENOENT/);
    } finally { await rm(root, { recursive: true, force: true }); }
});
