import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintRows } from './backup-integrity.mjs';
import { checkPreparedFlag } from './rollout-pdf-browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), exec = promisify(execFile);
const require = createRequire(path.join(root, 'backend/package.json'));
const env = require('dotenv').parse(await readFile(path.join(root, 'backend/.env')));
const name = (await readFile(path.join(root, '.local/deployments/LATEST'), 'utf8')).trim();
assert.match(name, /^activation-[0-9TZ-]+$/);
const directory = path.join(root, '.local/deployments', name);
const db = await require('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true });
const snapshot = async () => {
    const [tables] = await db.query("SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
    const result = {};
    for (const { name } of tables) { const [rows] = await db.query('SELECT * FROM `' + name.replace(/`/g, '``') + '`'); result[name] = fingerprintRows(rows); }
    return result;
};
const run = async (script, ...args) => {
    try { const r = await exec(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: root, windowsHide: true, timeout: 180000, maxBuffer: 3 * 1024 * 1024 }); console.log(script + ' ' + args.join(' ') + ': passed'); return r; }
    catch (e) {
        report.failedStep = script;
        report.failureType = String(e.stderr || '').match(/(?:AssertionError|TypeError|SyntaxError|Error)(?::| \[)/)?.[0]?.replace(/[: \[]/g, '') || 'process';
        throw Error('Handoff verification step failed: ' + script + ' (' + report.failureType + ')');
    }
};
const info = async () => (await fetch('http://127.0.0.1:3001/release-info.json', { signal: AbortSignal.timeout(5000) })).json();
const report = { startedAt: new Date().toISOString(), status: 'failed' };
try {
    assert.equal((await info()).variant, 'prepared-cv');
    const before = await snapshot();
    const start = Date.now(); await run('manage-activation.mjs', 'rollback');
    report.rollbackSeconds = (Date.now() - start) / 1000;
    const rolledBack = await info();
    assert.equal(rolledBack.variant, 'rollback'); assert.ok(Object.entries(rolledBack.flags).every(([k, v]) => v === (k.endsWith('_MODE') ? 'legacy' : 'false')));
    report.rollbackPreparedFlag = await checkPreparedFlag(false);
    assert.deepEqual(await snapshot(), before, 'Rollback changed SQL rows');
    await run('activation-health.mjs');
    console.log('PASS real rollback: all flags off, patched login retained, data and runtime healthy');
    await run('manage-activation.mjs', 'reactivate');
    assert.equal((await info()).variant, 'prepared-cv');
    assert.deepEqual(await snapshot(), before, 'Reactivation changed SQL rows');
    await run('activate-local.mjs', 'verify'); await run('activation-health.mjs');
    report.status = 'passed'; report.mysqlTablesUnchanged = Object.keys(before).length;
    report.final = await info(); report.finishedAt = new Date().toISOString();
} finally {
    await db.end(); await writeFile(path.join(directory, 'handoff-verification.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log('PASS handoff: rollback and restoration verified; accepted features remain active');
