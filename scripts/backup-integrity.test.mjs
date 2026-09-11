import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digest, fingerprintRows, verifyBackup, verifyCrashData, markBackupVerified } from './backup-integrity.mjs';

test('row checksums detect changed bytes and duplicate loss, independent of order', () => {
    const a = { id: '9007199254740993', file: Buffer.from([0, 255, 128]) };
    const b = { text: 'Tiếng Việt', value: null };
    assert.deepEqual(fingerprintRows([a, b]), fingerprintRows([b, a]));
    assert.notDeepEqual(fingerprintRows([a, b]), fingerprintRows([a, b, b]));
    assert.notDeepEqual(fingerprintRows([a]), fingerprintRows([{ ...a, file: Buffer.from([0, 255, 129]) }]));
});

test('restore rejects corruption, truncation and paths outside the backup before loading data', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'jobfind-integrity-'));
    try {
        const body = Buffer.from('backup data');
        const manifest = { files: { 'mysql.sql': { bytes: body.length, sha256: digest(body) } } };
        await writeFile(path.join(directory, 'mysql.sql'), body);
        await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
        assert.deepEqual(await verifyBackup(directory), manifest);
        await writeFile(path.join(directory, 'mysql.sql'), 'backup datX');
        await assert.rejects(verifyBackup(directory), /integrity mismatch/);
        await writeFile(path.join(directory, 'mysql.sql'), 'short');
        await assert.rejects(verifyBackup(directory), /integrity mismatch/);
        for (const name of ['../secret', '..\\secret', 'C:secret', '/absolute']) {
            await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ files: { [name]: {} } }));
            await assert.rejects(verifyBackup(directory), /Unsafe/);
        }
        await writeFile(path.join(directory, 'mysql.sql'), body);
        await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
        await assert.rejects(markBackupVerified(directory, { status: 'failed' }));
        const evidence = { status: 'passed', sourceUnchanged: true, cleaned: true, project: 'fixture',
            delivery: { payloadsAndHeadersVerified: 8 } };
        await markBackupVerified(directory, evidence);
        assert.equal((await verifyBackup(directory)).restoreVerification.status, 'passed');
        await writeFile(path.join(directory, 'mysql.sql'), 'backup datX');
        await assert.rejects(markBackupVerified(directory, evidence), /integrity mismatch/);
    } finally {
        assert.equal(path.dirname(directory), tmpdir());
        await rm(directory, { recursive: true, force: true });
    }
});

test('crash recovery permits reserved sequence gaps but rejects ID reuse or changed records', () => {
    const before = { postgres: { sequences: { fixture: { last_value: '9007199254740993', is_called: true } }, tables: { hash: 'same' } } };
    const after = structuredClone(before);
    after.postgres.sequences.fixture.last_value = '9007199254741025';
    assert.equal(verifyCrashData(before, after).fixture.after, '9007199254741025');
    after.postgres.sequences.fixture.last_value = '9007199254740992';
    assert.throws(() => verifyCrashData(before, after), /regressed/);
    after.postgres.sequences.fixture.last_value = '9007199254741025';
    after.postgres.tables.hash = 'changed';
    assert.throws(() => verifyCrashData(before, after), /Committed data/);
    delete after.postgres.sequences.fixture;
    assert.throws(() => verifyCrashData(before, after));
});
