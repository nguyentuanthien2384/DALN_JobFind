import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';

afterEach(() => vi.unstubAllEnvs());

describe('centralized RBAC matrix', () => {
    it('grants every declared permission to admin while keeping other roles separated', async () => {
        const { hasPermission, PERMISSIONS } = await import('../shared/accessControl.js');
        for (const permission of Object.values(PERMISSIONS)) {
            expect(hasPermission({ roleCode: 'ADMIN' }, permission)).toBe(true);
        }
        expect(hasPermission({ roleCode: 'COMPANY' }, PERMISSIONS.APPLICATION_MANAGE)).toBe(true);
        expect(hasPermission({ roleCode: 'EMPLOYER' }, PERMISSIONS.TALENT_POOL_MANAGE)).toBe(true);
        expect(hasPermission({ roleCode: 'EMPLOYER' }, PERMISSIONS.ADMIN_READ)).toBe(false);
        expect(hasPermission({ roleCode: 'CANDIDATE' }, PERMISSIONS.CV_SELF_MANAGE)).toBe(true);
        expect(hasPermission({ roleCode: 'CANDIDATE' }, PERMISSIONS.JOB_MANAGE)).toBe(false);
        expect(hasPermission({ roleCode: 'UNKNOWN' }, PERMISSIONS.PROFILE_SELF)).toBe(false);
        for (const roleCode of ['COMPANY', 'EMPLOYER']) {
            expect(hasPermission({ roleCode }, PERMISSIONS.AI_RECRUITER_USE)).toBe(true);
            expect(hasPermission({ roleCode }, PERMISSIONS.AI_CANDIDATE_USE)).toBe(false);
            expect(hasPermission({ roleCode }, [PERMISSIONS.AI_RECRUITER_USE, PERMISSIONS.AI_CANDIDATE_USE])).toBe(true);
        }
        expect(hasPermission({ roleCode: 'CANDIDATE' }, PERMISSIONS.AI_RECRUITER_USE)).toBe(false);
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
            'x-user-role': 'EMPLOYER', 'x-company-id': '3',
            'x-company-status': 'S1', 'x-company-censor': 'CS1'
        } });
        const trustedNext = vi.fn();
        requireTrustedGateway(req, makeRes(), trustedNext);
        expect(trustedNext).toHaveBeenCalledOnce();
        expect(req.user).toEqual({
            id: 8, userId: 8, roleCode: 'EMPLOYER', companyId: 3,
            companyStatusCode: 'S1', companyCensorCode: 'CS1'
        });

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

        const companylessAdmin = makeReq({ user: {
            id: 10, roleCode: 'ADMIN', companyId: null
        } });
        const adminNext = vi.fn();
        requireServicePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true })(
            companylessAdmin, makeRes(), adminNext
        );
        expect(adminNext).toHaveBeenCalledOnce();

        const pending = makeReq({ user: {
            id: 9, roleCode: 'COMPANY', companyId: 4,
            companyStatusCode: 'S1', companyCensorCode: 'CS3'
        } });
        const pendingDenied = makeRes();
        requireServicePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true })(
            pending, pendingDenied, vi.fn()
        );
        expect(pendingDenied.statusCode).toBe(403);
    });
});

// Services trust x-user-* only after the gateway secret matched; malformed values must still
// turn into "no identity" rather than an unexpected user id or company.
describe('identity from trusted gateway headers', () => {
    const headers = (extra = {}) => ({ 'x-user-id': '8', 'x-user-role': 'employer', ...extra });

    it('normalises a well-formed identity', async () => {
        const { identityFromTrustedHeaders } = await import('../shared/accessControl.js');
        expect(identityFromTrustedHeaders({ headers: headers({ 'x-company-id': '3', 'x-company-status': 'S1', 'x-company-censor': 'CS1' }) }))
            .toEqual({ id: 8, userId: 8, roleCode: 'EMPLOYER', companyId: 3, companyStatusCode: 'S1', companyCensorCode: 'CS1' });
        expect(identityFromTrustedHeaders({ headers: headers() }))
            .toEqual({ id: 8, userId: 8, roleCode: 'EMPLOYER', companyId: null, companyStatusCode: null, companyCensorCode: null });
    });

    it.each(['0', '-8', '8.5', 'abc', '', ' ', '1e3x', undefined])('rejects user id %p', async (userId) => {
        const { identityFromTrustedHeaders } = await import('../shared/accessControl.js');
        expect(identityFromTrustedHeaders({ headers: headers({ 'x-user-id': userId }) })).toBeNull();
    });

    it.each(['0', '-3', '3.5', 'abc', ''])('drops company id %p instead of trusting it', async (companyId) => {
        const { identityFromTrustedHeaders } = await import('../shared/accessControl.js');
        expect(identityFromTrustedHeaders({ headers: headers({ 'x-company-id': companyId }) }).companyId).toBeNull();
    });

    it.each(['', 'ROOT', 'guest'])('rejects an unknown role %p', async (role) => {
        const { identityFromTrustedHeaders } = await import('../shared/accessControl.js');
        expect(identityFromTrustedHeaders({ headers: headers({ 'x-user-role': role }) })).toBeNull();
    });

    it.each([
        ['an approved company', { companyId: 3, companyStatusCode: 'S1', companyCensorCode: 'CS1' }, true],
        ['no company', { companyId: null, companyStatusCode: 'S1', companyCensorCode: 'CS1' }, false],
        ['a locked company', { companyId: 3, companyStatusCode: 'S2', companyCensorCode: 'CS1' }, false],
        ['a company under review', { companyId: 3, companyStatusCode: 'S1', companyCensorCode: 'CS3' }, false],
    ])('hasApprovedCompany is %s -> %s', async (_case, identity, expected) => {
        const { hasApprovedCompany } = await import('../shared/accessControl.js');
        expect(hasApprovedCompany(identity)).toBe(expected);
        expect(hasApprovedCompany(undefined)).toBe(false);
    });

    it('answers with exact bodies the frontend can explain', async () => {
        const { PERMISSIONS, requireServicePermission, requireTrustedGateway } = await import('../shared/accessControl.js');
        const unconfigured = makeRes();
        requireTrustedGateway(makeReq(), unconfigured, vi.fn());
        expect(unconfigured.body).toEqual({ errCode: 503, errMessage: 'Dịch vụ chưa được cấu hình khóa nội bộ' });

        vi.stubEnv('INTERNAL_SECRET', 'trusted-secret');
        for (const secret of [undefined, '', 'trusted-secreT', 'trusted-secret ']) {
            const forbidden = makeRes();
            const next = vi.fn();
            requireTrustedGateway(makeReq({ headers: { 'x-internal-secret': secret } }), forbidden, next);
            expect(forbidden.body).toEqual({ errCode: 403, errMessage: 'Forbidden' });
            expect(next).not.toHaveBeenCalled();
        }

        const guard = requireServicePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true });
        const anonymous = makeRes();
        guard(makeReq(), anonymous, vi.fn());
        expect(anonymous.body).toEqual({ errCode: 401, errMessage: 'Bạn cần đăng nhập để dùng chức năng này' });
        const candidate = makeRes();
        guard(makeReq({ user: { id: 1, roleCode: 'CANDIDATE' } }), candidate, vi.fn());
        expect(candidate.body).toEqual({ errCode: 403, errMessage: 'Bạn không có quyền thực hiện thao tác này' });
        const pending = makeRes();
        guard(makeReq({ user: { id: 2, roleCode: 'EMPLOYER', companyId: 3, companyStatusCode: 'S1', companyCensorCode: 'CS3' } }), pending, vi.fn());
        expect(pending.body).toEqual({ errCode: 403, errMessage: 'Công ty chưa được duyệt, đã bị khóa hoặc không tồn tại' });
    });
});
