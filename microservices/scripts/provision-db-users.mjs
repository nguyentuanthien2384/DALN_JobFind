import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import pg from 'pg';
import dotenv from 'dotenv';
import {
    MYSQL_ROLE_SPECS,
    POSTGRES_ROLE_SPECS,
    buildMysqlProvisionPlan,
    buildPostgresProvisionPlan,
    collectConfiguredRolesFromEnv,
    provisionMysqlRoles,
    provisionPostgresRoles
} from '../shared/dbProvisioning.js';

dotenv.config({ path: new URL('../.env', import.meta.url) });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const generateEnv = args.has('--generate-env');

if (generateEnv) {
    const secret = () => randomBytes(24).toString('hex');
    const lines = ['# Per-service least-privilege database credentials'];
    for (const spec of Object.values(MYSQL_ROLE_SPECS)) {
        lines.push(`${spec.envUser}=${spec.defaultUser}`);
        lines.push(`${spec.envPassword}=${secret()}`);
    }
    for (const spec of Object.values(POSTGRES_ROLE_SPECS)) {
        lines.push(`${spec.envUser}=${spec.defaultUser}`);
        lines.push(`${spec.envPassword}=${secret()}`);
    }
    console.log(lines.join('\n'));
    process.exit(0);
}

const { mysqlRoles, pgRoles } = collectConfiguredRolesFromEnv(process.env);
const mysqlDatabase = process.env.MYSQL_DATABASE || 'jobfindtest';
const pgDatabase = process.env.POSTGRES_DB || 'application_db';

const mysqlPlan = buildMysqlProvisionPlan({ database: mysqlDatabase, roles: mysqlRoles });
const pgPlan = buildPostgresProvisionPlan({ database: pgDatabase, roles: pgRoles });

if (!apply) {
    console.log(JSON.stringify({
        mode: 'dry-run',
        mysqlRoles: Object.keys(mysqlRoles),
        mysqlStatementCount: mysqlPlan.length,
        postgresRoles: Object.keys(pgRoles),
        postgresStatementCount: pgPlan.length
    }, null, 2));
    process.exit(0);
}

const summary = {
    mode: 'apply',
    mysql: { provisionedRoles: [], statementCount: 0 },
    postgres: { provisionedRoles: [], statementCount: 0 }
};

if (Object.keys(mysqlRoles).length > 0) {
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'host.docker.internal',
        port: Number(process.env.MYSQL_PORT || 3333),
        user: process.env.MYSQL_ADMIN_USER || 'root',
        password: process.env.MYSQL_ROOT_PASSWORD ?? process.env.MYSQL_PASSWORD ?? '',
        database: mysqlDatabase,
        connectTimeout: 8000
    });
    try {
        summary.mysql = await provisionMysqlRoles(conn, {
            database: mysqlDatabase,
            roles: mysqlRoles
        });
    } finally {
        await conn.end();
    }
}

if (Object.keys(pgRoles).length > 0 && process.env.POSTGRES_URL) {
    const client = new pg.Client({
        connectionString: process.env.POSTGRES_ADMIN_URL || process.env.POSTGRES_URL,
        connectionTimeoutMillis: 8000
    });
    await client.connect();
    try {
        summary.postgres = await provisionPostgresRoles(client, {
            database: pgDatabase,
            roles: pgRoles
        });
    } finally {
        await client.end();
    }
}

console.log(JSON.stringify(summary, null, 2));
