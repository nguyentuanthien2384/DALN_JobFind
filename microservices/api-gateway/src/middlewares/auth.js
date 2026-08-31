import jwt from 'jsonwebtoken';
import { resolveCurrentIdentity } from '../libs/accountStore.js';
import { hasApprovedCompany, hasPermission, isKnownRole } from '../../../shared/accessControl.js';
import { getJwtSecret } from '../../../shared/securityConfig.js';

// Xac thuc tap trung tai Gateway.
//
// Cac service ben duoi khong tu giai ma token nua - chung tin vao header
// x-user-id / x-user-role do Gateway dat (xem proxy.js, noi cac header nay bi xoa
// khoi request cua client truoc khi Gateway tu dat lai). Nho vay logic xac thuc
// chi nam mot cho, va service ben duoi khong can biet ve JWT.

const decodeUserId = (req) => {
    const header = req.headers.authorization;
    if (!header) return null;
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (!token) return null;
    try {
        const payload = jwt.verify(token, getJwtSecret());
        const id = Number(payload.sub ?? payload.id);
        return Number.isInteger(id) && id > 0 ? id : null;
    } catch {
        return null;
    }
};

const authenticate = async (req) => {
    if (req.authResolved) return req.user || null;
    req.authResolved = true;
    req.user = null;
    req.authFailure = null;

    const userId = decodeUserId(req);
    if (!userId) {
        req.authFailure = 'invalid';
        return null;
    }

    try {
        const current = await resolveCurrentIdentity(userId);
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
        if (companyRequired && !hasApprovedCompany(req.user)) {
            return res.status(403).json({
                errCode: 403,
                errMessage: 'Công ty chưa được duyệt, đã bị khóa hoặc không tồn tại'
            });
        }
        return next();
    };
