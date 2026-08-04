import axios from 'axios';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('api-gateway');

// Ghi lai moi thao tac LAM THAY DOI du lieu di qua Gateway.
//
// Dat o Gateway thay vi rai vao tung service: moi request deu di qua day, nen
// chi mot cho la bao phu ca he thong - ke ca phan con nam o backend cu. Neu de
// tung service tu ghi, mot service quen la co mot mang trong trong nhat ky ma
// khong ai biet.
//
// Chi ghi cac phuong thuc lam thay doi du lieu. Ghi ca GET se sinh ra khoi lo
// nhat ky khong dung de lam gi ma van ton cho.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Cac duong dan khong bao gio duoc ghi: chung mang mat khau, ma OTP.
const SENSITIVE = [/\/login/i, /\/changepassword/i, /\/create-new-user/i, /\/reset-password/i];

export const auditMiddleware = (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();
    if (SENSITIVE.some((re) => re.test(req.originalUrl))) return next();

    const start = Date.now();

    res.on('finish', () => {
        // Gui khong cho ket qua: nhat ky khong duoc lam cham cau tra loi cho
        // nguoi dung, va ghi nhat ky hong cung khong duoc lam hong request.
        const body = {
            method: req.method,
            route: req.originalUrl.split('?')[0],
            actorId: req.user?.id ?? null,
            actorRole: req.user?.roleCode ?? null,
            companyId: req.user?.companyId ?? null,
            status: res.statusCode,
            durationMs: Date.now() - start,
            ip: req.ip,
            correlationId: req.correlationId
        };

        const url = process.env.ADMIN_URL || 'http://admin-service:4006';
        const secret = process.env.INTERNAL_SECRET;
        if (!secret) return;

        axios.post(`${url}/internal/audit-action`, body, {
            headers: { 'x-internal-secret': secret },
            timeout: 3000
        }).catch((error) => {
            logger.debug('khong ghi duoc nhat ky', { error: error.message });
        });
    });

    next();
};
