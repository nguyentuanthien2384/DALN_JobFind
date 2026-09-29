import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { backupMysql, writeBackupManifest } from './backup-local.mjs';
import { migrateRecruitmentCatalog } from './recruitment-catalog-migration.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'backend/package.json'));
const env = require('dotenv').parse(await fs.readFile(path.join(root, 'backend/.env')));
const mysql = require('mysql2/promise');
const args = process.argv.slice(2);
if (args.some(arg => !['--apply', '--dry-run'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) {
    throw new Error('Dùng npm run catalog:migrate -- [--dry-run | --apply]. Mặc định chỉ xem trước.');
}
const apply = args.includes('--apply');
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
    user: env.DB_USER, password: env.DB_PASSWORD || '', database: env.DB_NAME });
try {
    // Check the plan before taking a full snapshot; a repeated run makes no changes.
    const preview = await migrateRecruitmentCatalog(db);
    if (!apply || !(preview.insert + preview.update + preview.archive + preview.jobLocations + preview.candidateLocations)) {
        console.log(JSON.stringify({ ...preview, apply }, null, 2));
    } else {
        const directory = path.join(root, '.local/backups', 'recruitment-catalog-' + new Date().toISOString().replace(/[:.]/g, '-'));
        await fs.mkdir(directory, { recursive: true });
        const evidence = await backupMysql(root, env, directory);
        const result = await migrateRecruitmentCatalog(db, { apply: true,
            saveBackup: snapshot => fs.writeFile(path.join(directory, 'catalog-before.json'), JSON.stringify(snapshot, null, 2), { flag: 'wx', mode: 0o600 }) });
        await writeBackupManifest(directory, { mysql: evidence });
        console.log(JSON.stringify({ ...result, backup: directory }, null, 2));
    }
} finally { await db.end(); }
