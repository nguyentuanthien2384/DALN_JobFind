// Xuat toan bo du lieu dang chay tren may dev de chuyen len VPS:
//   mysql.sql         MySQL/XAMPP (backend/.env), mot snapshot InnoDB nhat quan
//   postgres.dump     application_db (luong ung tuyen) tu container postgres
//   mongo.archive.gz  ho so/CV, nhat ky admin, AI Worker tu container mongo
//   manifest.json     SHA-256 tung file; import-data.sh kiem tra truoc khi nap
// Can XAMPP MySQL va cac container ha tang cua `npm start` dang chay.
//   npm run vps:export-data
// Elasticsearch khong can xuat: search-service dung lai chi muc tu MySQL.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { backupMysql, backupContainer, writeBackupManifest } from '../../scripts/backup-local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dotenv = createRequire(path.join(root, 'backend/package.json'))('dotenv');
const exec = promisify(execFile);
const project = process.env.JOBFIND_COMPOSE_PROJECT || 'ai-job-portal';
const backend = dotenv.parse(await fs.readFile(path.join(root, 'backend/.env')));
const micro = dotenv.parse(await fs.readFile(path.join(root, 'microservices/.env')));

const runningContainer = async service => {
    const { stdout } = await exec('docker', ['ps', '-q', '--filter', `label=com.docker.compose.project=${project}`,
        '--filter', `label=com.docker.compose.service=${service}`], { windowsHide: true, timeout: 30000 })
        .catch(() => { throw new Error('Khong goi duoc Docker. Mo Docker Desktop roi chay lai.'); });
    const id = stdout.trim().split(/\s+/).filter(Boolean)[0];
    if (!id) throw new Error(`Container ${service} cua ${project} chua chay. Chay npm start truoc khi xuat du lieu.`);
    return id;
};

const postgres = await runningContainer('postgres');
const mongo = await runningContainer('mongo');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = path.join(root, 'deploy/data-export', stamp);
await fs.mkdir(directory, { recursive: true });
try {
    console.log(`MySQL ${backend.DB_HOST}:${backend.DB_PORT}/${backend.DB_NAME} ...`);
    const mysql = await backupMysql(root, backend, directory);
    console.log('PostgreSQL application_db ...');
    await backupContainer(root, ['exec', postgres, 'pg_dump', '-U', micro.POSTGRES_USER, '-d', 'application_db', '-Fc'], path.join(directory, 'postgres.dump'));
    console.log('MongoDB ...');
    await backupContainer(root, ['exec', mongo, 'mongodump', '--archive', '--gzip', '--quiet'], path.join(directory, 'mongo.archive.gz'));
    await writeBackupManifest(directory, { source: 'local-export', mysql });
} catch (error) {
    // Bo ban xuat do dang: import-data.sh khong duoc nhan nham mot bo thieu file.
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
}

let total = 0;
for (const name of await fs.readdir(directory)) total += (await fs.stat(path.join(directory, name))).size;
const relative = path.relative(root, directory).replace(/\\/g, '/');
console.log(`\nDa xuat ${(total / 1048576).toFixed(1)} MB vao ${relative}`);
console.log('Chep len VPS (thay user@IP va duong dan du an tren VPS):');
console.log(`  scp -r ${relative} user@IP:~/DALN_JobFind/deploy/data-export/`);
console.log('Tren VPS, trong thu muc deploy/:');
console.log(`  sh scripts/import-data.sh data-export/${stamp}`);
