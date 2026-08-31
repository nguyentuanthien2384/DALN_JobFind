import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';

afterEach(() => vi.unstubAllEnvs());

describe('centralized RBAC matrix', () => {
    it('keeps admin, company, employer and candidate capabilities separated', async () => {
        const { hasPermission, PERMISSIONS } = await import('../shared/accessControl.js');
        expect(hasPermission({ roleCode: 'ADMIN' }, PERMISSIONS.ADMIN_WRITE)).toBe(true);
        expect(hasPermission({ roleCode: 'ADMIN' }, PERMISSIONS.JOB_MANAGE)).toBe(false);
        expect(hasPermission({ roleCode: 'COMPANY' }, PERMISSIONS.APPLICATION_MANAGE)).toBe(true);
        expect(hasPermission({ roleCode: 'EMPLOYER' }, PERMISSIONS.TALENT_POOL_MANAGE)).toBe(true);
        expect(hasPermission({ roleCode: 'EMPLOYER' }, PERMISSIONS.ADMIN_READ)).toBe(false);
        expect(hasPermission({ roleCode: 'CANDIDATE' }, PERMISSIONS.CV_SELF_MANAGE)).toBe(true);
        expect(hasPermission({ roleCode: 'CANDIDATE' }, PERMISSIONS.JOB_MANAGE)).toBe(false);
        expect(hasPermission({ roleCode: 'UNKNOWN' }, PERMISSIONS.PROFILE_SELF)).toBe(false);
    });

    it('fails closed without a service secret and rejects spoofed identity headers', async () => {
        const { requireTrustedGateway } = await import('../shared/accessControl.js');
        const missingConfig = makeRes();
        requireTrustedGateway(makeReq(), missingConfig, vi.fn());
        expect(missingConfig.statusCode).toBe(503);

        vi.stubEnv('INTERNAL_SECRET', 'trusted-secret');
        const spoofed = makeRes();
        requireTrustedGateway(makeReq({
            headers: {
                'x-internal-secret': 'wrong', 'x-user-id': '1',
                'x-user-role': 'ADMIN'
            }
        }), spoofed, vi.fn());
        expect(spoofed.statusCode).toBe(403);
    });

    it('accepts only a valid trusted identity and then enforces permissions/tenant', async () => {
        vi.stubEnv('INTERNAL_SECRET', 'trusted-secret');
        const {
            PERMISSIONS, requireServicePermission, requireTrustedGateway
        } = await import('../shared/accessControl.js');

        const req = makeReq({ headers: {
            'x-internal-secret': 'trusted-secret', 'x-user-id': '8',
            'x-user-role': 'EMPLOYER', 'x-company-id': '3'
        } });
        const trustedNext = vi.fn();
        requireTrustedGateway(req, makeRes(), trustedNext);
        expect(trustedNext).toHaveBeenCalledOnce();
        expect(req.user).toEqual({ id: 8, userId: 8, roleCode: 'EMPLOYER', companyId: 3 });

        const allowed = vi.fn();
        requireServicePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true })(
            req, makeRes(), allowed
        );
        expect(allowed).toHaveBeenCalledOnce();

        const noIdentityReq = makeReq({ headers: {
            'x-internal-secret': 'trusted-secret', 'x-user-id': 'not-a-number',
            'x-user-role': 'ADMIN'
        } });
        requireTrustedGateway(noIdentityReq, makeRes(), vi.fn());
        const unauthenticated = makeRes();
        requireServicePermission(PERMISSIONS.ADMIN_READ)(noIdentityReq, unauthenticated, vi.fn());
        expect(unauthenticated.statusCode).toBe(401);

        const companyless = makeReq({ user: {
            id: 9, roleCode: 'COMPANY', companyId: null
        } });
        const denied = makeRes();
        requireServicePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true })(
            companyless, denied, vi.fn()
        );
        expect(denied.statusCode).toBe(403);
    });
});

