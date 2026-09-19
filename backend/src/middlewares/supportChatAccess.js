import db from '../models';
import { isPermissionGranted, PERMISSIONS } from './authorize';

// Accounts awaiting company approval can still speak to platform support.
// Ordinary recruiting relationships remain protected by the existing CHAT policy.
export const supportChatAccess = async (req, res, next) => {
    if (isPermissionGranted(req, PERMISSIONS.CHAT)) return next();
    if (!isPermissionGranted(req, PERMISSIONS.ACCOUNT_SELF)) return res.status(403).json({ errCode: 403 });
    if (req.path === '/api/get-list-chat-conversation') { req.supportOnly = true; return next(); }
    const partnerId = Number(req.body?.receiverId || req.query?.partnerId);
    if (!Number.isSafeInteger(partnerId) || partnerId < 1) return res.status(403).json({ errCode: 403 });
    try {
        const agent = await db.Account.findOne({ where: { userId: partnerId, roleCode: 'ADMIN', statusCode: 'S1' }, attributes: ['userId'] });
        if (agent) return next();
        return res.status(403).json({ errCode: 403, errMessage: 'Tài khoản hiện chỉ có thể liên hệ nhân viên hỗ trợ.' });
    } catch { return res.status(503).json({ errCode: 503, errMessage: 'Chưa xác minh được nhân viên hỗ trợ.' }); }
};
