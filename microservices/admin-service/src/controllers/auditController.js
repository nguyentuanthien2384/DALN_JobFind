import { AuditLog } from '../models/AuditLog.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('admin-service');

// Ghi mot su kien giua cac service.
export const recordEvent = async (routingKey, payload) => {
    // Tu tim khoa cua doi tuong bi tac dong trong payload, de sau con tra cuu
    // nguoc kieu "tin #51 da bi ai dong vao".
    const target = payload.jobId ? { type: 'job', id: String(payload.jobId) }
        : payload.applicationId ? { type: 'application', id: String(payload.applicationId) }
            : payload.taskId ? { type: 'ai_task', id: String(payload.taskId) }
                : payload.job?.id ? { type: 'job', id: String(payload.job.id) }
                    : { type: null, id: null };

    await AuditLog.create({
        kind: 'event',
        name: routingKey,
        service: routingKey.split('.')[0],
        actorId: payload.actorId ?? payload.userId ?? null,
        targetType: target.type,
        targetId: target.id,
        // Cat bot cho an toan: mot vai su kien mang ca file CV base64, luu nguyen
        // se lam phinh CSDL rat nhanh.
        payload: trim(payload)
    });
};

// Ghi mot thao tac cua nguoi dung di qua Gateway.
export const recordAction = async (body) => {
    await AuditLog.create({
        kind: 'action',
        name: `${body.method} ${body.route}`,
        service: 'api-gateway',
        actorId: body.actorId ?? null,
        actorRole: body.actorRole ?? null,
        companyId: body.companyId ?? null,
        targetType: body.targetType ?? null,
        targetId: body.targetId ?? null,
        status: body.status,
        durationMs: body.durationMs,
        ip: body.ip,
        correlationId: body.correlationId
    });
};

// Bo cac truong qua lon truoc khi luu.
const trim = (obj) => {
    const clone = {};
    for (const [key, value] of Object.entries(obj || {})) {
        if (typeof value === 'string' && value.length > 500) {
            clone[key] = `${value.slice(0, 200)}… (đã cắt bớt ${value.length} ký tự)`;
        } else if (key === 'fileBase64' || key === 'file' || key === 'cv_snapshot') {
            clone[key] = '[đã lược bỏ]';
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            clone[key] = trim(value);
        } else {
            clone[key] = value;
        }
    }
    return clone;
};

// ===== API TRA CUU =====
export const listLogs = async (req, res) => {
    const filter = {};
    if (req.query.kind) filter.kind = req.query.kind;
    if (req.query.name) filter.name = new RegExp(req.query.name, 'i');
    if (req.query.actorId) filter.actorId = Number(req.query.actorId);
    if (req.query.targetType) filter.targetType = req.query.targetType;
    if (req.query.targetId) filter.targetId = String(req.query.targetId);
    if (req.query.correlationId) filter.correlationId = req.query.correlationId;
    if (req.query.fromDate || req.query.toDate) {
        filter.createdAt = {};
        if (req.query.fromDate) filter.createdAt.$gte = new Date(req.query.fromDate);
        if (req.query.toDate) filter.createdAt.$lte = new Date(req.query.toDate);
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    try {
        const [data, count] = await Promise.all([
            AuditLog.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
            AuditLog.countDocuments(filter)
        ]);
        return res.json({ errCode: 0, data, count });
    } catch (error) {
        logger.error('tra cuu nhat ky that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không đọc được nhật ký' });
    }
};

// Xem toan bo dau vet cua mot doi tuong: "tin nay da di qua nhung buoc nao".
export const targetHistory = async (req, res) => {
    try {
        const data = await AuditLog.find({
            targetType: req.params.type,
            targetId: String(req.params.id)
        }).sort({ createdAt: 1 }).limit(200).lean();
        return res.json({ errCode: 0, data, count: data.length });
    } catch (error) {
        logger.error('tra cuu lich su doi tuong that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};

// Gateway goi endpoint nay de ghi lai thao tac cua nguoi dung.
export const ingestAction = async (req, res) => {
    const secret = process.env.INTERNAL_SECRET;
    if (!secret || req.headers['x-internal-secret'] !== secret) {
        return res.status(403).json({ errCode: 403, errMessage: 'Forbidden' });
    }
    try {
        await recordAction(req.body || {});
        return res.json({ errCode: 0 });
    } catch (error) {
        logger.warn('ghi thao tac that bai', { error: error.message });
        return res.status(500).json({ errCode: -1 });
    }
};
