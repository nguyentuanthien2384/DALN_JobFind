import { describe, expect, it, vi } from 'vitest';
import {
    MYSQL_ROLE_SPECS,
    POSTGRES_ROLE_SPECS,
    buildMysqlProvisionPlan,
    buildPostgresProvisionPlan,
    collectConfiguredRolesFromEnv,
    provisionMysqlRoles,
    provisionPostgresRoles,
    resolveMysqlServiceCredentials,
    resolvePostgresServiceUrl
} from '../shared/dbProvisioning.js';

describe('database-per-service least-privilege provisioning and credential resolution', () => {
    it('resolves per-service MySQL credentials with fallback to shared MYSQL_USER/MYSQL_PASSWORD', () => {
        const sharedEnv = {
            MYSQL_HOST: 'mysql',
            MYSQL_PORT: '3306',
            MYSQL_USER: 'jobfind',
            MYSQL_PASSWORD: 'shared-password',
            MYSQL_DATABASE: 'jobfindtest'
        };
        expect(resolveMysqlServiceCredentials(sharedEnv, 'gateway')).toEqual({
            host: 'mysql',
            port: 3306,
            user: 'jobfind',
            password: 'shared-password',
            database: 'jobfindtest'
        });

        const isolatedEnv = {
            ...sharedEnv,
            GATEWAY_MYSQL_USER: 'jobfind_gateway',
            GATEWAY_MYSQL_PASSWORD: 'gateway-password'
        };
        expect(resolveMysqlServiceCredentials(isolatedEnv, 'gateway')).toEqual({
            host: 'mysql',
            port: 3306,
            user: 'jobfind_gateway',
            password: 'gateway-password',
            database: 'jobfindtest'
        });
        expect(() => resolveMysqlServiceCredentials(sharedEnv, 'unknown')).toThrow(/Unknown MySQL service role/);
    });

    it('resolves per-service PostgreSQL URLs from direct URL, role credentials, or shared POSTGRES_URL', () => {
        const baseEnv = {
            POSTGRES_URL: 'postgres://jobfind:shared@postgres:5432/application_db'
        };
        expect(resolvePostgresServiceUrl(baseEnv, 'admin')).toBe(baseEnv.POSTGRES_URL);

        const roleEnv = {
            ...baseEnv,
            ADMIN_POSTGRES_USER: 'jobfind_admin_ro',
            ADMIN_POSTGRES_PASSWORD: 'ro_password'
        };
        expect(resolvePostgresServiceUrl(roleEnv, 'admin')).toBe(
            'postgres://jobfind_admin_ro:ro_password@postgres:5432/application_db'
        );

        const directUrlEnv = {
            ...roleEnv,
            ADMIN_POSTGRES_URL: 'postgres://custom_ro:secret@pg-replica:5432/application_db'
        };
        expect(resolvePostgresServiceUrl(directUrlEnv, 'admin')).toBe(directUrlEnv.ADMIN_POSTGRES_URL);
        expect(() => resolvePostgresServiceUrl(baseEnv, 'unknown')).toThrow(/Unknown PostgreSQL service role/);
    });

    it('builds least-privilege MySQL statements per service role without global or cross-domain write grants', () => {
        const roles = {
            gateway: { user: 'jf_gateway', password: 'pw1' },
            core: { user: 'jf_core', password: 'pw2' },
            application: { user: 'jf_app_sync', password: 'pw3' },
            notification: { user: 'jf_notif', password: 'pw4' },
            admin: { user: 'jf_admin_ro', password: 'pw5' },
            support: { user: 'jf_support', password: 'pw6' }
        };
        const plan = buildMysqlProvisionPlan({ database: 'jobfindtest', roles });

        const gatewayGrants = plan.filter((s) => s.role === 'gateway' && s.kind.startsWith('grant_'));
        expect(gatewayGrants.map((s) => s.table)).toEqual(['users', 'accounts', 'companies', 'AuthSessions']);
        expect(gatewayGrants.every((s) => s.sql.startsWith('GRANT SELECT ON `jobfindtest`.'))).toBe(true);

        const appGrants = plan.filter((s) => s.role === 'application' && s.kind.startsWith('grant_'));
        expect(appGrants.map((s) => s.table)).toEqual(['cvs', 'users', 'accounts', 'posts', 'detailposts', 'outbox_events']);
        expect(appGrants.every((s) => s.sql.startsWith('GRANT SELECT ON `jobfindtest`.'))).toBe(true);

        const adminGrants = plan.filter((s) => s.role === 'admin' && s.kind.startsWith('grant_'));
        expect(adminGrants).toEqual([
            expect.objectContaining({
                sql: "GRANT SELECT ON `jobfindtest`.* TO 'jf_admin_ro'@'%'"
            })
        ]);

        const notifGrants = plan.filter((s) => s.role === 'notification' && s.kind.startsWith('grant_'));
        expect(notifGrants.find((s) => s.table === 'users')?.sql).toContain('GRANT SELECT ON');
        expect(notifGrants.find((s) => s.table === 'notifications')?.sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON');
        expect(notifGrants.find((s) => s.table === 'notification_inbox')?.sql).toContain('CREATE');

        const supportGrants = plan.filter((s) => s.role === 'support' && s.kind.startsWith('grant_'));
        expect(supportGrants.find((s) => s.table === 'posts')?.sql).toBe(
            "GRANT SELECT ON `jobfindtest`.`posts` TO 'jf_support'@'%'"
        );
        expect(supportGrants.find((s) => s.table === 'support_conversations')?.sql).toContain(
            'GRANT SELECT, INSERT, UPDATE, DELETE, CREATE ON `jobfindtest`.`support_conversations`'
        );
    });

    it('rejects root, postgres, invalid identifiers, and empty passwords', () => {
        expect(() => buildMysqlProvisionPlan({
            database: 'jobfindtest',
            roles: { gateway: { user: 'root', password: 'secret' } }
        })).toThrow(/Refusing to provision root/);

        expect(() => buildMysqlProvisionPlan({
            database: 'jobfindtest',
            roles: { gateway: { user: 'jf_gateway', password: '' } }
        })).toThrow(/Password is required/);

        expect(() => buildPostgresProvisionPlan({
            database: 'application_db',
            roles: { admin: { user: 'postgres', password: 'secret' } }
        })).toThrow(/Refusing to provision superuser postgres/);

        expect(() => buildPostgresProvisionPlan({
            database: 'application_db',
            roles: { admin: { user: 'bad-user!', password: 'secret' } }
        })).toThrow(/Invalid admin PostgreSQL user/);
    });

    it('executes MySQL and PostgreSQL provisioning plans and honors allowExisting=false', async () => {
        const db = { query: vi.fn().mockResolvedValue([[]]) };
        const result = await provisionMysqlRoles(db, {
            database: 'jobfindtest',
            roles: { gateway: { user: 'jf_gateway', password: 'pw1' } },
            allowExisting: false
        });
        expect(result.provisionedRoles).toEqual(['gateway']);
        expect(db.query).toHaveBeenCalledWith('SELECT User FROM mysql.user WHERE User = ?', ['jf_gateway']);

        db.query.mockResolvedValueOnce([[{ User: 'jf_gateway' }]]);
        await expect(provisionMysqlRoles(db, {
            database: 'jobfindtest',
            roles: { gateway: { user: 'jf_gateway', password: 'pw1' } },
            allowExisting: false
        })).rejects.toThrow(/Refuse to replace existing MySQL account/);

        const pgClient = { query: vi.fn().mockResolvedValue({}) };
        const pgResult = await provisionPostgresRoles(pgClient, {
            database: 'application_db',
            roles: {
                application: { user: 'jf_app', password: 'pw_app' },
                admin: { user: 'jf_admin_ro', password: 'pw_ro' }
            }
        });
        expect(pgResult.provisionedRoles).toEqual(['application', 'admin']);
        const executedSql = pgClient.query.mock.calls.map(([sql]) => sql).join('\n');
        expect(executedSql).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE');
        expect(executedSql).toContain('GRANT SELECT ON ALL TABLES IN SCHEMA public TO "jf_admin_ro"');
        expect(executedSql).toContain('OWNER TO "jf_app"');
    });

    it('collects only fully configured roles from environment variables', () => {
        const env = {
            [MYSQL_ROLE_SPECS.gateway.envUser]: 'jf_gateway',
            [MYSQL_ROLE_SPECS.gateway.envPassword]: 'pw_gw',
            [MYSQL_ROLE_SPECS.admin.envUser]: 'jf_admin_only_no_pass',
            [POSTGRES_ROLE_SPECS.admin.envUser]: 'jf_pg_ro',
            [POSTGRES_ROLE_SPECS.admin.envPassword]: 'pw_pg_ro'
        };
        expect(collectConfiguredRolesFromEnv(env)).toEqual({
            mysqlRoles: { gateway: { user: 'jf_gateway', password: 'pw_gw' } },
            pgRoles: { admin: { user: 'jf_pg_ro', password: 'pw_pg_ro' } }
        });
    });
});
