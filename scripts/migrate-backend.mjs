import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Runs every backend/src/migrations file not yet recorded in SequelizeMeta, in file-name order,
// like `sequelize-cli db:migrate` (the production image has no sequelize-cli).
//   VPS:  docker compose run --rm backend node /app/scripts/migrate-backend.mjs --from-env [--dry-run]
//   Dev:  npm run backend:migrate [-- --dry-run]   (reads backend/.env, verified MySQL backup first)
const fromEnv = process.argv.includes('--from-env');
const dryRun = process.argv.includes('--dry-run');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'backend/package.json'));
const env = fromEnv ? process.env : require('dotenv').parse(await fs.readFile(path.join(root, 'backend/.env')));
const { Sequelize } = require('sequelize');
const db = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD || '', {
  host: env.DB_HOST, port: Number(env.DB_PORT || 3306), dialect: 'mysql', logging: false, timezone: '+07:00',
});
const directory = path.join(root, 'backend/src/migrations');
try {
  await db.authenticate();
  const q = db.getQueryInterface();
  const tables = (await q.showAllTables()).map(t => String(t).toLowerCase());
  const [rows] = tables.includes('sequelizemeta') ? await db.query('SELECT name FROM SequelizeMeta') : [[]];
  const applied = new Set(rows.map(row => row.name));
  const pending = (await fs.readdir(directory)).filter(name => name.endsWith('.js')).sort().filter(name => !applied.has(name));
  if (!pending.length) console.log('CSDL backend da cap nhat: khong co migration moi.');
  else if (dryRun) console.log(`Se chay ${pending.length} migration:\n  ${pending.join('\n  ')}`);
  else {
    if (!fromEnv) {
      const { backupMysql } = await import('./backup-local.mjs');
      const backup = path.join(root, '.local/backups', 'migrate-' + new Date().toISOString().replace(/[:.]/g, '-'));
      await fs.mkdir(backup, { recursive: true });
      await fs.writeFile(path.join(backup, 'mysql-evidence.json'), JSON.stringify(await backupMysql(root, env, backup), null, 2));
      console.log('Verified MySQL snapshot saved:', backup);
    }
    if (!tables.includes('sequelizemeta')) await q.createTable('SequelizeMeta', { name: { type: Sequelize.STRING, primaryKey: true, allowNull: false } });
    for (const name of pending) {
      console.log('Dang chay migration:', name);
      try {
        // MySQL commits DDL immediately, so a failed file is reported and left unrecorded for inspection.
        await require(path.join(directory, name)).up(q, Sequelize);
      } catch (error) {
        console.error(`Migration ${name} loi: ${error.message}\nDa dung lai; cac migration sau chua chay. Khoi phuc bang ban sao luu neu can.`);
        throw error;
      }
      await db.query('INSERT INTO SequelizeMeta (name) VALUES (?)', { replacements: [name] });
    }
    console.log(`Da chay ${pending.length} migration. Du lieu hien co duoc giu nguyen.`);
  }
} finally { await db.close(); }
