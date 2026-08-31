import crypto from 'node:crypto';

// Ma tran quyen dung chung cho Gateway va tat ca service. Controller van phai
// kiem tra ownership/tenant cua tung ban ghi; lop nay tra loi cau hoi coarse-
// grained: vai tro nao duoc phep vao nhom API nao.
export const ROLES = Object.freeze({
    ADMIN: 'ADMIN',
    COMPANY: 'COMPANY',
    EMPLOYER: 'EMPLOYER',
    CANDIDATE: 'CANDIDATE'
});

export const PERMISSIONS = Object.freeze({
    PROFILE_SELF: 'profile:self',
    CV_SELF_MANAGE: 'cv:self:manage',
    JOB_MANAGE: 'job:manage',
    APPLICATION_SELF_READ: 'application:self:read',
    APPLICATION_MANAGE: 'application:manage',
    TALENT_POOL_MANAGE: 'talent-pool:manage',
    AI_CANDIDATE_USE: 'ai:candidate:use',
    ADMIN_READ: 'admin:read',
    ADMIN_WRITE: 'admin:write'
});

const matrix = {
    [ROLES.ADMIN]: [
        PERMISSIONS.PROFILE_SELF,
        PERMISSIONS.ADMIN_READ,
        PERMISSIONS.ADMIN_WRITE
    ],
    [ROLES.COMPANY]: [
        PERMISSIONS.PROFILE_SELF,
        PERMISSIONS.JOB_MANAGE,
        PERMISSIONS.APPLICATION_MANAGE,
        PERMISSIONS.TALENT_POOL_MANAGE
    ],
    [ROLES.EMPLOYER]: [
        PERMISSIONS.PROFILE_SELF,
        PERMISSIONS.JOB_MANAGE,
        PERMISSIONS.APPLICATION_MANAGE,
        PERMISSIONS.TALENT_POOL_MANAGE
    ],
    [ROLES.CANDIDATE]: [
        PERMISSIONS.PROFILE_SELF,
        PERMISSIONS.CV_SELF_MANAGE,
        PERMISSIONS.APPLICATION_SELF_READ,
        PERMISSIONS.AI_CANDIDATE_USE
    ]
};

export const ROLE_PERMISSIONS = Object.freeze(
    Object.fromEntries(Object.entries(matrix).map(([role, permissions]) => [
        role, Object.freeze([...permissions])
    ]))
);

export const isKnownRole = (roleCode) => Object.hasOwn(ROLE_PERMISSIONS, roleCode);

export const hasPermission = (identity, permission) => Boolean(
    identity && ROLE_PERMISSIONS[identity.roleCode]?.includes(permission)
);

const positiveInteger = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

// Chi goi ham nay SAU requireTrustedGateway. Cac header danh tinh khong co chu
// ky rieng; chung duoc tin vi request da chung minh no den tu Gateway bang khoa
// noi bo, va Gateway luon xoa header do client gui truoc khi dat lai.
export const identityFromTrustedHeaders = (req) => {
    const userId = positiveInteger(req.headers['x-user-id']);
    const roleCode = String(req.headers['x-user-role'] || '').toUpperCase();
    const companyId = positiveInteger(req.headers['x-company-id']);
    if (!userId || !isKnownRole(roleCode)) return null;
    return { id: userId, userId, roleCode, companyId };
};

const safeSecretEqual = (actual, expected) => {
    const actualBuffer = Buffer.from(String(actual || ''));
    const expectedBuffer = Buffer.from(String(expected || ''));
    return actualBuffer.length === expectedBuffer.length
        && actualBuffer.length > 0
        && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

// Bao ve service khoi request goi thang va gia mao x-user-role/x-company-id.
// INTERNAL_SECRET khong duoc cau hinh thi fail-closed thay vi vo tinh mo service.
export const requireTrustedGateway = (req, res, next) => {
    const expected = process.env.INTERNAL_SECRET;
    if (!expected) {
        return res.status(503).json({
            errCode: 503,
            errMessage: 'Dịch vụ chưa được cấu hình khóa nội bộ'
        });
    }
    if (!safeSecretEqual(req.headers['x-internal-secret'], expected)) {
        return res.status(403).json({ errCode: 403, errMessage: 'Forbidden' });
    }
    req.user = identityFromTrustedHeaders(req);
    return next();
};

export const requireServicePermission = (permission, { companyRequired = false } = {}) =>
    (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                errCode: 401,
                errMessage: 'Bạn cần đăng nhập để dùng chức năng này'
            });
        }
        if (!hasPermission(req.user, permission)) {
            return res.status(403).json({
                errCode: 403,
                errMessage: 'Bạn không có quyền thực hiện thao tác này'
            });
        }
        if (companyRequired && !req.user.companyId) {
            return res.status(403).json({
                errCode: 403,
                errMessage: 'Tài khoản của bạn chưa thuộc công ty nào'
            });
        }
        return next();
    };

