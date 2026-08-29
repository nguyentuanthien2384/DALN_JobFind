import mongoose from 'mongoose';

// Nhat ky hoat dong toan he thong.
//
// Dung MongoDB vi moi loai su kien mang mot bo truong khac han nhau: chuyen buoc
// ho so co fromStage/toStage, kiem duyet tin co approved/reason, dang nhap co ip.
// Nhet vao bang quan he se thanh mot bang day cot NULL, hoac phai them bang moi
// cho moi loai su kien. Duoi dang tai lieu thi phan rieng cua tung loai nam gon
// trong `payload`, con phan chung van tra cuu duoc.

const auditLogSchema = new mongoose.Schema({
    // Loai ban ghi: 'event' la su kien giua cac service, 'action' la thao tac
    // cua nguoi dung di qua Gateway.
    kind: { type: String, enum: ['event', 'action'], required: true, index: true },

    // Voi event: routing key cua RabbitMQ (job.created, application.stage_changed...).
    // Voi action: METHOD duong-dan (POST /api/jobs).
    name: { type: String, required: true, index: true },

    service: { type: String, index: true },

    // Ai gay ra. Null voi su kien do he thong tu sinh.
    actorId: { type: Number, index: true },
    actorRole: String,
    companyId: { type: Number, index: true },

    // Doi tuong bi tac dong, de tra cuu nguoc: "tin #51 da bi ai dong vao".
    targetType: { type: String, index: true },
    targetId: { type: String, index: true },

    status: Number,
    durationMs: Number,
    ip: String,
    // Ma lan vet mot request xuyen qua nhieu service.
    correlationId: { type: String, index: true },

    payload: mongoose.Schema.Types.Mixed,

    // Index duoc khai bao ben duoi: mot index sap xep moi nhat va mot TTL.
    // Khong dat `index: true` o day vi se tao trung index { createdAt: 1 }
    // voi TTL index va Mongoose phat canh bao moi lan khoi dong.
    createdAt: { type: Date, default: Date.now }
});

// Truy van hay dung nhat: "cho toi xem hoat dong gan day cua nguoi nay/cong ty nay".
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

// Nhat ky phinh rat nhanh. Tu xoa ban ghi qua 180 ngay de khong phai don tay -
// MongoDB co san co che het han theo thoi gian.
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
