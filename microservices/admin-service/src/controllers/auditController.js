import { AuditLog } from '../models/AuditLog.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('admin-service');

const confirmExistingEvent = async (filter) => {
    const existing = await AuditLog.findOne(filter).select({ _id: 1 })
        .collation({ locale: 'simple' }).read('primary').readConcern('majority').maxTimeMS(5000).lean();
    if (!existing) {
        throw Object.assign(new Error('Audit event is not majority-visible'), { code: 'AUDIT_EVENT_NOT_VISIBLE' });
    }
};

// Ghi mot su kien giua cac service.
export const recordEvent = async (routingKey, payload, metadata = {}) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid audit event payload');
    const eventId = metadata?.eventId;
    if (eventId !== undefined && (typeof eventId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(eventId))) {
        throw new Error('Invalid audit eventId');
    }
    if (metadata?.eventType && metadata.eventType !== routingKey) throw new Error('Audit event type does not match routing key');
    // Tu tim khoa cua doi tuong bi tac dong trong payload, de sau con tra cuu
    // nguoc kieu "tin #51 da bi ai dong vao".
    const target = payload.jobId ? { type: 'job', id: String(payload.jobId) }
        : payload.applicationId ? { type: 'application', id: String(payload.applicationId) }
            : payload.taskId ? { type: 'ai_task', id: String(payload.taskId) }
                : payload.job?.id ? { type: 'job', id: String(payload.job.id) }
                    : { type: null, id: null };

    const record = {
        kind: 'event',
        name: routingKey,
        service: metadata?.producer || routingKey.split('.')[0],
        actorId: payload.actorId ?? payload.userId ?? null,
        targetType: target.type,
        targetId: target.id,
        // Cat bot cho an toan: mot vai su kien mang ca file CV base64, luu nguyen
        // se lam phinh CSDL rat nhanh.
        payload: trim(payload)
    };
    if (eventId === undefined) {
        // Compatibility path: do not guess an identity from a payload hash/time.
        await AuditLog.create(record);
        return { duplicate: false, legacy: true };
    }

    const filter = { kind: 'event', eventId };
    Object.assign(record, {
        eventId,
        eventVersion: metadata.eventVersion,
        aggregateId: metadata.aggregateId,
        occurredAt: metadata.occurredAt,
        correlationId: metadata.correlationId,
        createdAt: new Date()
    });
    try {
        const result = await AuditLog.updateOne(filter, { $setOnInsert: record }, {
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true,
            collation: { locale: 'simple' },
            writeConcern: { w: 'majority', j: true, wtimeout: 5000 }
        });
        if (!result?.acknowledged || !(result.matchedCount === 1 || result.upsertedCount === 1)) {
            throw new Error('Audit write was not acknowledged');
        }
        // A duplicate path is a no-op update. Verify the retained entry rather
        // than equating a local match with a durable audit record after failover.
        if (result.matchedCount === 1) await confirmExistingEvent(filter);
        return { duplicate: result.matchedCount === 1 };
    } catch (error) {
        // Concurrent upserts can race on the unique index. Only this exact key
        // conflict is a possible duplicate; unrelated E11000 errors must surface.
        const sameEvent = error?.code === 11000 && error.keyValue?.eventId === eventId
            && error.keyPattern?.eventId === 1 && Object.keys(error.keyPattern).length === 1;
        if (!sameEvent) throw error;
        await confirmExistingEvent(filter);
        return { duplicate: true };
    }
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

const REDACTED = '[đã lược bỏ]';
const SENSITIVE_KEYS = new Set([
    'authorization', 'cookie', 'setcookie',
    'file', 'filebase64', 'cvsnapshot', 'resumetext', 'cvtext'
]);

const isSensitiveKey = (key) => {
    const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    return SENSITIVE_KEYS.has(normalized)
        || /(password|passwd|secret|token|apikey)$/.test(normalized);
};

// Bo du lieu nhay cam truoc, sau do moi cat cac truong qua lon. Thu tu nay rat
// quan trong: neu fileBase64/password dai hon 500 ky tu ma cat truoc, 200 ky tu
// dau cua bi mat se bi ghi vao audit log.
const trim = (obj) => {
    const clone = {};
    for (const [key, value] of Object.entries(obj || {})) {
        if (isSensitiveKey(key)) {
            clone[key] = REDACTED;
        } else if (typeof value === 'string' && value.length > 500) {
            clone[key] = `${value.slice(0, 200)}… (đã cắt bớt ${value.length} ký tự)`;
        } else if (Array.isArray(value)) {
            clone[key] = value.map((item) =>
                item && typeof item === 'object' ? trim(item) : item
            );
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
    // Search text is literal, never an attacker-supplied regular expression.
    if (req.query.name) filter.name = new RegExp(String(req.query.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (req.query.actorId) filter.actorId = Number(req.query.actorId);
    if (req.query.targetType) filter.targetType = req.query.targetType;
    if (req.query.targetId) filter.targetId = String(req.query.targetId);
    if (req.query.correlationId) filter.correlationId = req.query.correlationId;
    if (req.query.eventId) filter.eventId = String(req.query.eventId);
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
