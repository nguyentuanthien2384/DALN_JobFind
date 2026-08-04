import jwt from 'jsonwebtoken';

// Xac thuc tap trung tai Gateway.
//
// Cac service ben duoi khong tu giai ma token nua - chung tin vao header
// x-user-id / x-user-role do Gateway dat (xem proxy.js, noi cac header nay bi xoa
// khoi request cua client truoc khi Gateway tu dat lai). Nho vay logic xac thuc
// chi nam mot cho, va service ben duoi khong can biet ve JWT.

const secret = process.env.JWT_SECRET;

const decode = (req) => {
    const header = req.headers.authorization;
    if (!header) return null;
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (!token) return null;
    try {
        const payload = jwt.verify(token, secret);
        return {
            // Backend cu ky token voi truong `sub`. Ho tro ca `id` cho service moi.
            id: payload.sub ?? payload.id,
            roleCode: payload.roleCode ?? null,
            companyId: payload.companyId ?? null
        };
    } catch {
        return null;
    }
};

// Gan req.user neu token hop le, nhung khong chan khach vang lai.
export const optionalAuth = (req, res, next) => {
    req.user = decode(req);
    next();
};

// Bat buoc dang nhap.
export const requireAuth = (req, res, next) => {
    const user = decode(req);
    if (!user) {
        return res.status(401).json({
            errCode: 401,
            errMessage: 'Bạn cần đăng nhập để dùng chức năng này'
        });
    }
    req.user = user;
    next();
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
