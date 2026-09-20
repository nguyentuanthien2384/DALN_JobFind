import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { backupMysql } from './backup-local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'backend/package.json'));
const env = require('dotenv').parse(await fs.readFile(path.join(root, 'backend/.env')));
const { Sequelize, DataTypes } = require('sequelize');
const db = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD || '', {
  host: env.DB_HOST, port: Number(env.DB_PORT || 3306), dialect: 'mysql', logging: false,
});
const migrations = ['migrationzzzzzzz-auth-sessions-sso.js', 'migrationzzzzzzzz-auth-link-binding.js'];
try {
  await db.authenticate();
  const q = db.getQueryInterface();
  const tables = new Set((await q.showAllTables()).map(t => String(t).toLowerCase()));
  const authTables = ['AuthSessions', 'AuthIdentities', 'OidcTransactions'];
  const existing = authTables.filter(t => tables.has(t.toLowerCase()));
  if (existing.length && existing.length !== 3) throw new Error('Partial auth schema detected; inspect before retrying. No tables were removed.');
  const directory = path.join(root, '.local/backups', 'auth-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(directory, { recursive: true });
  const evidence = await backupMysql(root, env, directory);
  await fs.writeFile(path.join(directory, 'mysql-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('Verified MySQL snapshot saved:', directory);
  if (!tables.has('sequelizemeta')) await q.createTable('SequelizeMeta', { name: { type: DataTypes.STRING, primaryKey: true, allowNull: false } });
  for (const name of migrations) {
    const [recorded] = await db.query('SELECT name FROM SequelizeMeta WHERE name = ?', { replacements: [name] });
    if (recorded.length) continue;
    if (name === migrations[0] && existing.length === 3) {
      for (const table of authTables) {
        const fields = await q.describeTable(table);
        const required = table === 'AuthSessions' ? ['familyId', 'tokenHash', 'revokedAt', 'rotatedAt'] : table === 'AuthIdentities' ? ['issuer', 'subject', 'userId'] : ['stateHash', 'browserHash', 'verifier'];
        if (required.some(field => !fields[field])) throw new Error(`Unexpected schema in ${table}; migration stopped.`);
      }
    } else await require(path.join(root, 'backend/src/migrations', name)).up(q, DataTypes);
    await db.query('INSERT INTO SequelizeMeta (name) VALUES (?)', { replacements: [name] });
    console.log('Applied auth migration:', name);
  }
  for (const table of authTables) await q.describeTable(table);
  console.log('Authentication schema ready. Existing user and business data preserved.');
} finally { await db.close(); }
