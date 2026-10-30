const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_]{1,64}$/;
const MYSQL_USER_PATTERN = /^[a-zA-Z0-9_]{1,32}$/;
const PG_ROLE_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

export const MYSQL_ROLE_SPECS = Object.freeze({
    backend: Object.freeze({
        envUser: 'BACKEND_MYSQL_USER',
        envPassword: 'BACKEND_MYSQL_PASSWORD',
        defaultUser: 'jobfind_backend',
        databaseGrants: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        tableGrants: Object.freeze({})
    }),
    gateway: Object.freeze({
        envUser: 'GATEWAY_MYSQL_USER',
        envPassword: 'GATEWAY_MYSQL_PASSWORD',
        defaultUser: 'jobfind_gateway',
        databaseGrants: [],
        tableGrants: Object.freeze({
            users: ['SELECT'],
            accounts: ['SELECT'],
            companies: ['SELECT'],
            AuthSessions: ['SELECT']
        })
    }),
    core: Object.freeze({
        envUser: 'JOB_CORE_MYSQL_USER',
        envPassword: 'JOB_CORE_MYSQL_PASSWORD',
        defaultUser: 'jobfind_core',
        databaseGrants: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        tableGrants: Object.freeze({
            ai_tasks: ['CREATE'],
            outbox_events: ['CREATE'],
            job_moderation_state: ['CREATE'],
            ai_result_inbox: ['CREATE'],
            ai_request_keys: ['CREATE'],
            job_request_keys: ['CREATE']
        })
    }),
    application: Object.freeze({
        envUser: 'APPLICATION_MYSQL_USER',
        envPassword: 'APPLICATION_MYSQL_PASSWORD',
        defaultUser: 'jobfind_app_sync',
        databaseGrants: [],
        tableGrants: Object.freeze({
            cvs: ['SELECT'],
            users: ['SELECT'],
            accounts: ['SELECT'],
            posts: ['SELECT'],
            detailposts: ['SELECT'],
            outbox_events: ['SELECT']
        })
    }),
    notification: Object.freeze({
        envUser: 'NOTIFICATION_MYSQL_USER',
        envPassword: 'NOTIFICATION_MYSQL_PASSWORD',
        defaultUser: 'jobfind_notification',
        databaseGrants: [],
        tableGrants: Object.freeze({
            users: ['SELECT'],
            followcompanies: ['SELECT'],
            notifications: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
            notification_inbox: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE'],
            notification_deliveries: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE']
        })
    }),
    admin: Object.freeze({
        envUser: 'ADMIN_MYSQL_USER',
        envPassword: 'ADMIN_MYSQL_PASSWORD',
        defaultUser: 'jobfind_admin_ro',
        databaseGrants: ['SELECT'],
        tableGrants: Object.freeze({})
    }),
    support: Object.freeze({
        envUser: 'SUPPORT_MYSQL_USER',
        envPassword: 'SUPPORT_MYSQL_PASSWORD',
        defaultUser: 'jobfind_support',
        databaseGrants: [],
        tableGrants: Object.freeze({
            favoriteposts: ['SELECT'],
            posts: ['SELECT'],
            detailposts: ['SELECT'],
            users: ['SELECT'],
            companies: ['SELECT'],
            support_conversations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE'],
            support_handoffs: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE']
        })
    })
});

export const POSTGRES_APPLICATION_TABLES = Object.freeze([
    'applications',
    'application_events',
    'application_notes',
    'talent_pool',
    'outbox_events'
]);

export const POSTGRES_ROLE_SPECS = Object.freeze({
    application: Object.freeze({
        envUser: 'APPLICATION_POSTGRES_USER',
        envPassword: 'APPLICATION_POSTGRES_PASSWORD',
        envUrl: 'APPLICATION_POSTGRES_URL',
        defaultUser: 'jobfind_app',
        schemaGrants: ['USAGE', 'CREATE'],
        tableGrants: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        sequenceGrants: ['USAGE', 'SELECT', 'UPDATE'],
        ownsTables: true
    }),
    admin: Object.freeze({
        envUser: 'ADMIN_POSTGRES_USER',
        envPassword: 'ADMIN_POSTGRES_PASSWORD',
        envUrl: 'ADMIN_POSTGRES_URL',
        defaultUser: 'jobfind_admin_ro',
        schemaGrants: ['USAGE'],
        tableGrants: ['SELECT'],
        sequenceGrants: [],
        ownsTables: false
    })
});

const assertIdentifier = (value, label, pattern = IDENTIFIER_PATTERN) => {
    const text = String(value || '').trim();
    if (!pattern.test(text)) {
        throw new Error(`Invalid ${label}: ${value}`);
    }
    return text;
};

const quoteMysqlIdent = (value, label) => `\`${assertIdentifier(value, label)}\``;
const quoteMysqlString = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const quotePgIdent = (value, label) => `"${assertIdentifier(value, label, PG_ROLE_PATTERN)}"`;
const quotePgLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

export const resolveMysqlServiceCredentials = (env = process.env, role) => {
    const spec = MYSQL_ROLE_SPECS[role];
    if (!spec) {
        throw new Error(`Unknown MySQL service role: ${role}`);
    }
    const dedicatedUser = String(env[spec.envUser] || '').trim();
    const dedicatedPassword = env[spec.envPassword];
    return {
        host: env.MYSQL_HOST || 'host.docker.internal',
        port: Number(env.MYSQL_PORT || 3333),
        user: dedicatedUser || env.MYSQL_USER || 'root',
        password: dedicatedUser
            ? String(dedicatedPassword ?? env.MYSQL_PASSWORD ?? '')
            : String(env.MYSQL_PASSWORD ?? ''),
        database: env.MYSQL_DATABASE || 'jobfindtest'
    };
};

export const resolvePostgresServiceUrl = (env = process.env, role) => {
    const spec = POSTGRES_ROLE_SPECS[role];
    if (!spec) {
        throw new Error(`Unknown PostgreSQL service role: ${role}`);
    }
    const directUrl = String(env[spec.envUrl] || '').trim();
    if (directUrl) return directUrl;

    const dedicatedUser = String(env[spec.envUser] || '').trim();
    const dedicatedPassword = String(env[spec.envPassword] || '').trim();
    const baseUrl = String(env.POSTGRES_URL || '').trim();
    if (dedicatedUser && dedicatedPassword && baseUrl) {
        const parsed = new URL(baseUrl);
        parsed.username = encodeURIComponent(dedicatedUser);
        parsed.password = encodeURIComponent(dedicatedPassword);
        return parsed.toString();
    }
    return baseUrl;
};

export const buildMysqlProvisionPlan = ({ database = 'jobfindtest', roles = {}, hostPattern = '%' } = {}) => {
    const dbIdent = quoteMysqlIdent(database, 'MySQL database');
    const hostLiteral = quoteMysqlString(hostPattern || '%');
    const statements = [];

    for (const [role, credential] of Object.entries(roles)) {
        if (!credential) continue;
        const spec = MYSQL_ROLE_SPECS[role];
        if (!spec) {
            throw new Error(`Unsupported MySQL role: ${role}`);
        }
        const user = assertIdentifier(credential.user, `${role} MySQL user`, MYSQL_USER_PATTERN);
        if (user.toLowerCase() === 'root') {
            throw new Error(`Refusing to provision root as service role "${role}"`);
        }
        const password = String(credential.password || '');
        if (!password) {
            throw new Error(`Password is required for MySQL role "${role}" (${user})`);
        }
        const principal = `${quoteMysqlString(user)}@${hostLiteral}`;

        statements.push(
            {
                role,
                kind: 'create_user',
                sql: `CREATE USER IF NOT EXISTS ${principal} IDENTIFIED BY ?`,
                params: [password]
            },
            {
                role,
                kind: 'alter_user',
                sql: `ALTER USER ${principal} IDENTIFIED BY ?`,
                params: [password]
            }
        );

        if (spec.databaseGrants.length) {
            statements.push({
                role,
                kind: 'grant_database',
                sql: `GRANT ${spec.databaseGrants.join(', ')} ON ${dbIdent}.* TO ${principal}`,
                params: []
            });
        }

        for (const [table, grants] of Object.entries(spec.tableGrants)) {
            const tableIdent = quoteMysqlIdent(table, `table ${table}`);
            statements.push({
                role,
                kind: 'grant_table',
                table,
                sql: `GRANT ${grants.join(', ')} ON ${dbIdent}.${tableIdent} TO ${principal}`,
                params: []
            });
        }
    }

    return statements;
};

export const provisionMysqlRoles = async (db, { database = 'jobfindtest', roles = {}, hostPattern = '%', allowExisting = true } = {}) => {
    const plan = buildMysqlProvisionPlan({ database, roles, hostPattern });
    if (!allowExisting) {
        for (const [role, credential] of Object.entries(roles)) {
            if (!credential) continue;
            const user = assertIdentifier(credential.user, `${role} MySQL user`, MYSQL_USER_PATTERN);
            const [exists] = await db.query('SELECT User FROM mysql.user WHERE User = ?', [user]);
            if (exists.length > 0) {
                throw new Error(`Refuse to replace existing MySQL account: ${user}`);
            }
        }
    }
    for (const step of plan) {
        await db.query(step.sql, step.params);
    }
    return { provisionedRoles: Object.keys(roles).filter((role) => Boolean(roles[role])), statementCount: plan.length };
};

export const buildPostgresProvisionPlan = ({ database = 'application_db', roles = {}, tables = POSTGRES_APPLICATION_TABLES } = {}) => {
    const dbIdent = quotePgIdent(database, 'PostgreSQL database');
    const statements = [];

    for (const [role, credential] of Object.entries(roles)) {
        if (!credential) continue;
        const spec = POSTGRES_ROLE_SPECS[role];
        if (!spec) {
            throw new Error(`Unsupported PostgreSQL role: ${role}`);
        }
        const user = assertIdentifier(credential.user, `${role} PostgreSQL user`, PG_ROLE_PATTERN);
        if (user.toLowerCase() === 'postgres') {
            throw new Error(`Refusing to provision superuser postgres as service role "${role}"`);
        }
        const password = String(credential.password || '');
        if (!password) {
            throw new Error(`Password is required for PostgreSQL role "${role}" (${user})`);
        }
        const roleIdent = quotePgIdent(user, `${role} PostgreSQL user`);
        const roleLiteral = quotePgLiteral(user);
        const passLiteral = quotePgLiteral(password);

        statements.push(
            {
                role,
                kind: 'upsert_role',
                sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${roleLiteral}) THEN CREATE ROLE ${roleIdent} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${passLiteral}; ELSE ALTER ROLE ${roleIdent} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${passLiteral}; END IF; END $$;`
            },
            {
                role,
                kind: 'grant_connect',
                sql: `GRANT CONNECT ON DATABASE ${dbIdent} TO ${roleIdent};`
            },
            {
                role,
                kind: 'grant_schema',
                sql: `GRANT ${spec.schemaGrants.join(', ')} ON SCHEMA public TO ${roleIdent};`
            }
        );

        if (spec.ownsTables) {
            for (const table of tables) {
                const tableIdent = quotePgIdent(table, `PostgreSQL table ${table}`);
                statements.push({
                    role,
                    kind: 'own_table',
                    table,
                    sql: `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = ${quotePgLiteral(table)}) THEN EXECUTE 'ALTER TABLE public.${tableIdent} OWNER TO ${roleIdent}'; END IF; END $$;`
                });
            }
        }

        if (spec.tableGrants.length) {
            statements.push({
                role,
                kind: 'grant_tables',
                sql: `GRANT ${spec.tableGrants.join(', ')} ON ALL TABLES IN SCHEMA public TO ${roleIdent};`
            });
        }

        if (spec.sequenceGrants.length) {
            statements.push({
                role,
                kind: 'grant_sequences',
                sql: `GRANT ${spec.sequenceGrants.join(', ')} ON ALL SEQUENCES IN SCHEMA public TO ${roleIdent};`
            });
        }
    }

    return statements;
};

export const provisionPostgresRoles = async (client, options = {}) => {
    const plan = buildPostgresProvisionPlan(options);
    for (const step of plan) {
        await client.query(step.sql);
    }
    return {
        provisionedRoles: Object.keys(options.roles || {}).filter((role) => Boolean(options.roles[role])),
        statementCount: plan.length
    };
};

export const collectConfiguredRolesFromEnv = (env = process.env) => {
    const mysqlRoles = {};
    for (const [role, spec] of Object.entries(MYSQL_ROLE_SPECS)) {
        const user = String(env[spec.envUser] || '').trim();
        const password = String(env[spec.envPassword] || '').trim();
        if (user && password) {
            mysqlRoles[role] = { user, password };
        }
    }
    const pgRoles = {};
    for (const [role, spec] of Object.entries(POSTGRES_ROLE_SPECS)) {
        const user = String(env[spec.envUser] || '').trim();
        const password = String(env[spec.envPassword] || '').trim();
        if (user && password) {
            pgRoles[role] = { user, password };
        }
    }
    return { mysqlRoles, pgRoles };
};
