import jwt from 'jsonwebtoken';
import { resolveCurrentIdentity } from '../libs/accountStore.js';
import {
    hasApprovedCompany,
    hasPermission,
    isKnownRole,
    ROLES
} from '../../../shared/accessControl.js';
import { getJwtSecret, getJwtVerifyOptions, hasAccessTokenClaims } from '../../../shared/securityConfig.js';

// Xac thuc tap trung tai Gateway.
//
// Cac service ben duoi khong tu giai ma token nua - chung tin vao header
// x-user-id / x-user-role do Gateway dat (xem proxy.js, noi cac header nay bi xoa
// khoi request cua client truoc khi Gateway tu dat lai). Nho vay logic xac thuc
// chi nam mot cho, va service ben duoi khong can biet ve JWT.
//
// ===== JWT (thu vien jsonwebtoken) =====
// Access token la JWT ky HMAC-SHA256 (HS256) bang JWT_SECRET dung chung voi backend.
// jwt.verify kiem tra: chu ky, algorithms chi cho HS256 (chong tan cong "alg: none" /
// doi thuat toan), issuer + audience (token cua he thong khac khong dung duoc),
// maxAge = TTL (mac dinh 900s = 15 phut) va clockTolerance 5s cho lech dong ho.
// Hai lop bao ve them:
// - sid (session id): token phai gan voi mot phien con hieu luc trong bang AuthSessions
//   (resolveCurrentIdentity). Dang xuat/doi mat khau thu hoi phien => token cu het
//   tac dung ngay, khong phai doi het 15 phut - khac phuc nhuoc diem "JWT khong thu
//   hoi duoc" cua JWT thuan stateless.
// - Role/companyId doc lai tu DB moi request, khong tin claim trong token.
// Vi sao HS256 ma khong RS256? Chi backend va Gateway (cung ha tang) ky/kiem tra token,
// nen khoa doi xung du dung va don gian; RS256 can khi nhieu ben ngoai can tu kiem tra.

const decodeIdentity = (req) => {
    const header = req.headers.authorization;
    if (!header) return null;
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (!token) return null;
    try {
        const payload = jwt.verify(token, getJwtSecret(), getJwtVerifyOptions());
        if (!hasAccessTokenClaims(payload)) return null;
        const id = Number(payload.sub ?? payload.id);
        if (!Number.isInteger(id) || id <= 0) return null;
        if (!payload.sid && process.env.AUTH_ALLOW_LEGACY_TOKENS !== 'true') return null;
        return { id, sid: payload.sid || null };
    } catch {
        return null;
    }
};

const authenticate = async (req) => {
    if (req.authResolved) return req.user || null;
    req.authResolved = true;
    req.user = null;
    req.authFailure = null;

    const identity = decodeIdentity(req);
    if (!identity) {
        req.authFailure = 'invalid';
        return null;
    }

    try {
        const current = await resolveCurrentIdentity(identity.id, identity.sid);
        if (!current) {
            req.authFailure = 'invalid';
            return null;
        }
        if (current.statusCode !== 'S1') {
            req.authFailure = 'inactive';
            return null;
        }
        if (!isKnownRole(current.roleCode)) {
            req.authFailure = 'role';
            return null;
        }
        // Tuyet doi khong lay role/companyId tu JWT: day la trang thai hien tai
        // trong DB, nen token cu khong giu duoc quyen sau khi tai khoan thay doi.
        req.user = {
            id: current.id,
            roleCode: current.roleCode,
            companyId: current.companyId,
            companyStatusCode: current.companyStatusCode || null,
            companyCensorCode: current.companyCensorCode || null
        };
        return req.user;
    } catch {
        req.authFailure = 'unavailable';
        return null;
    }
};

const denyAuthentication = (req, res) => {
    if (req.authFailure === 'unavailable') {
        return res.status(503).json({
            errCode: 503,
            errMessage: 'Không thể xác minh tài khoản lúc này'
        });
    }
    if (req.authFailure === 'inactive') {
        return res.status(403).json({
            errCode: 403,
            refresh: true,
            authReason: 'inactive',
            errMessage: 'Tài khoản đã bị khóa hoặc chưa kích hoạt'
        });
    }
    return res.status(401).json({
        errCode: 401,
        errMessage: 'Bạn cần đăng nhập để dùng chức năng này'
    });
};

// Gan req.user neu token hop le, nhung khong chan khach vang lai.
export const optionalAuth = async (req, res, next) => {
    await authenticate(req);
    return next();
};

// Bat buoc dang nhap.
export const requireAuth = async (req, res, next) => {
    await authenticate(req);
    if (!req.user) return denyAuthentication(req, res);
    return next();
};

// Bat buoc dung vai tro. Vi du requireRole('ADMIN') hoac requireRole('EMPLOYER','COMPANY').
export const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            errCode: 401,
            errMessage: 'Bạn cần đăng nhập để dùng chức năng này'
        });
    }
    if (!roles.includes(req.user.roleCode)) {
        return res.status(403).json({
            errCode: 403,
            errMessage: 'Bạn không có quyền thực hiện thao tác này'
        });
    }
    next();
};

export const requirePermission = (permission, { companyRequired = false } = {}) =>
    (req, res, next) => {
        if (!req.user) return denyAuthentication(req, res);
        if (!hasPermission(req.user, permission)) {
            return res.status(403).json({
                errCode: 403,
                errMessage: 'Bạn không có quyền thực hiện thao tác này'
            });
        }
        if (
            companyRequired
            && req.user.roleCode !== ROLES.ADMIN
            && !hasApprovedCompany(req.user)
        ) {
            return res.status(403).json({
                errCode: 403,
                errMessage: 'Công ty chưa được duyệt, đã bị khóa hoặc không tồn tại'
            });
        }
        return next();
    };
