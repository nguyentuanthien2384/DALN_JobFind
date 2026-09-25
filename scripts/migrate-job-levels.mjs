import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { backupMysql, writeBackupManifest } from './backup-local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'backend/package.json'));
const configured = require('dotenv').parse(await fs.readFile(path.join(root, 'backend/.env')));
const env = { ...configured, ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('DB_'))) };
const { Sequelize } = require('sequelize');
const db = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD || '', {
  host: env.DB_HOST, port: Number(env.DB_PORT || 3306), dialect: 'mysql', logging: false,
});
const name = 'migrationzzzzzzzzzzzz-canonical-it-job-levels.js';
try {
  await db.authenticate();
  const directory = path.join(root, '.local/backups', 'job-levels-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(directory, { recursive: true });
  const evidence = await backupMysql(root, env, directory);
  await writeBackupManifest(directory, { mysql: evidence });
  console.log('Verified MySQL backup:', directory);
  const q = db.getQueryInterface();
  const result = await require(path.join(root, 'backend/src/migrations', name)).up(q, Sequelize);
  const tables = await q.showAllTables();
  let metadata = tables.find(table => String(table).toLowerCase() === 'sequelizemeta');
  if (!metadata) {
    metadata = 'SequelizeMeta';
    await q.createTable(metadata, { name: { type: Sequelize.STRING, primaryKey: true, allowNull: false } });
  }
  // The old label-only migration must not recreate aliases on a later db:migrate.
  for (const applied of ['migrationzzzzzzzzzzz-it-job-levels.js', name]) {
    await db.query(`INSERT IGNORE INTO ${q.queryGenerator.quoteTable(metadata)} (name) VALUES (?)`, { replacements: [applied] });
  }
  console.log(JSON.stringify({ ...result, searchSync: 'Committed job.updated events; Job Core relay and Search indexer will apply them.' }));
} finally {
  await db.close();
}
