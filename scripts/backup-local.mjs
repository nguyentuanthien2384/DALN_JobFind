import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { digest, fingerprintRows } from './backup-integrity.mjs';

export async function backupMysql(root, env, directory, { signal } = {}) {
    signal?.throwIfAborted();
    const require = createRequire(path.join(root, 'backend/package.json'));
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
        user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true,
        supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 8000 });
    const file = path.join(directory, 'mysql.sql');
    const output = createWriteStream(file, { flags: 'wx', mode: 0o600 });
    let writeError;
    output.on('error', error => { writeError = error; });
    const abort = () => { connection.destroy(); output.destroy(new Error('Đã dừng sao lưu.')); };
    signal?.addEventListener('abort', abort, { once: true });
    const write = async text => { if (writeError) throw writeError; if (!output.write(text, 'utf8')) await once(output, 'drain'); };
    const quote = name => '`' + name.replace(/`/g, '``') + '`';
    const counts = {};
    const tablesEvidence = {};
    try {
        signal?.throwIfAborted();
        const [tables] = await connection.query('SELECT TABLE_NAME name, ENGINE engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE=\'BASE TABLE\' ORDER BY TABLE_NAME');
        if (tables.some(table => table.engine !== 'InnoDB')) throw new Error('Sao lưu nhất quán cần các bảng InnoDB.');
        const [[objects]] = await connection.query(`SELECT
            (SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE()) +
            (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()) +
            (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE()) +
            (SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()) AS n`);
        if (Number(objects.n)) throw new Error('Backup requires native dump support for views, triggers, routines or events.');
        const [[generated]] = await connection.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND EXTRA LIKE '%GENERATED%'");
        if (Number(generated.n)) throw new Error('Backup requires native dump support for generated columns.');
        const [[version]] = await connection.query('SELECT VERSION() version');
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        await write("-- JobFind local snapshot. Restore only to an empty database. UTF-8.\nSET NAMES utf8mb4;\nSET SESSION sql_mode='NO_AUTO_VALUE_ON_ZERO';\nSET FOREIGN_KEY_CHECKS=0;\n");
        for (const table of tables) {
            signal?.throwIfAborted();
            const [schema] = await connection.query(`SHOW CREATE TABLE ${quote(table.name)}`);
            await write(schema[0]['Create Table'] + ';\n');
            const [rows] = await connection.query(`SELECT * FROM ${quote(table.name)}`);
            counts[table.name] = rows.length;
            tablesEvidence[table.name] = { ...fingerprintRows(rows), schemaSha256: digest(schema[0]['Create Table']) };
            for (const row of rows) { signal?.throwIfAborted(); await write(`INSERT INTO ${quote(table.name)} (${Object.keys(row).map(quote).join(',')}) VALUES (${Object.values(row).map(value => connection.escape(value)).join(',')});\n`); }
        }
        await connection.commit();
        await write('SET FOREIGN_KEY_CHECKS=1;\n');
        if (writeError) throw writeError;
        const finished = once(output, 'finish');
        output.end(); await finished;
        return { file: 'mysql.sql', database: env.DB_NAME, version: version.version, counts, tables: tablesEvidence,
            consistency: 'single InnoDB read-only snapshot; no concurrent DDL', accountsIncluded: false };
    } catch (error) { output.destroy(); await connection.rollback().catch(() => {}); throw error; }
    finally { signal?.removeEventListener('abort', abort); await connection.end().catch(() => {}); }
}

export async function backupContainer(root, args, destination, { signal } = {}) {
    signal?.throwIfAborted();
    const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
    const child = spawn('docker', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    // Drain stderr without copying credentials or database contents into logs.
    child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 120000);
    try {
        const [[code]] = await Promise.all([once(child, 'close'), pipeline(child.stdout, output, { signal })]);
        if (code !== 0) throw new Error(`Sao lưu container thất bại (${code}); bản sao chưa được xác nhận.`);
    } catch (error) {
        child.kill(); output.destroy();
        throw error;
    } finally { clearTimeout(timer); }
}

export async function writeBackupManifest(directory, metadata) {
    const files = {};
    for (const name of await fs.readdir(directory)) {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(path.join(directory, name))) hash.update(chunk);
        files[name] = { sha256: hash.digest('hex'), bytes: (await fs.stat(path.join(directory, name))).size };
    }
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), ...metadata, files }, null, 2), { mode: 0o600 });
}
