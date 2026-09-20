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
const name = 'migrationzzzzzzzzzz-chat-media.js';
try {
    await db.authenticate();
    const q = db.getQueryInterface();
    const directory = path.join(root, '.local/backups', 'chat-media-' + new Date().toISOString().replace(/[:.]/g, '-'));
    await fs.mkdir(directory, { recursive: true });
    const evidence = await backupMysql(root, env, directory);
    await fs.writeFile(path.join(directory, 'mysql-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log('Verified MySQL backup:', directory);
    await require(path.join(root, 'backend/src/migrations', name)).up(q, DataTypes);
    const tables = (await q.showAllTables()).map(table => String(table).toLowerCase());
    if (!tables.includes('sequelizemeta')) await q.createTable('SequelizeMeta', { name: { type: DataTypes.STRING, primaryKey: true, allowNull: false } });
    await db.query('INSERT IGNORE INTO SequelizeMeta (name) VALUES (?)', { replacements: [name] });
    console.log('Chat PDF attachments and job snapshots schema ready. Existing messages preserved.');
} finally { await db.close(); }
