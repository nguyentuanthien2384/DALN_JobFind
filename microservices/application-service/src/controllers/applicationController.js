import { pool, withTransaction, STAGES, STAGE_LABELS } from '../libs/db.js';
import { enqueueOutboxEvent } from '../libs/outbox.js';
import { EVENTS } from '../../../shared/events.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('application-service');

// Danh tinh do Gateway dat vao header sau khi xac thuc JWT.
const identity = (req) => ({
    userId: req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null,
    roleCode: req.headers['x-user-role'] || null,
    companyId: req.headers['x-company-id'] ? Number(req.headers['x-company-id']) : null
});

const forbidden = (res, msg) =>
    res.status(403).json({ errCode: 3, errMessage: msg || 'Bạn không có quyền truy cập dữ liệu này' });

// Nha tuyen dung chi thay ho so ung tuyen vao tin cua chinh cong ty minh. Dieu kien
// nay duoc gan vao MOI truy van thay vi kiem tra rieng le - quen mot cho la lo ca kho
// ho so sang cong ty khac.
const companyScope = (req) => {
    const { roleCode, companyId } = identity(req);
    if (roleCode === 'ADMIN') return { clause: '', params: [] };
    if (companyId === null) return null;
    return { clause: 'company_id = $1', params: [companyId] };
};

// ===== BANG KANBAN =====
// Tra ve ho so da gom san theo tung cot, dung dinh dang ma giao dien dung duoc ngay.
export const getBoard = async (req, res) => {
    const scope = companyScope(req);
    if (!scope) return forbidden(res, 'Tài khoản của bạn chưa thuộc công ty nào');

    const conditions = [];
    const params = [];
    if (scope.clause) { params.push(...scope.params); conditions.push(scope.clause); }
    if (req.query.jobId) { params.push(Number(req.query.jobId)); conditions.push(`job_id = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const { rows } = await pool.query(
            `SELECT id, legacy_cv_id, job_id, job_title, candidate_id, candidate_name,
                    candidate_email, stage, rating, match_score, is_read, applied_at, stage_changed_at
             FROM applications ${where}
             ORDER BY stage_changed_at DESC`,
            params
        );

        // Cot rong van phai xuat hien tren bang, neu khong giao dien se thieu cot
        // va khong keo tha vao do duoc.
        const columns = STAGES.map((stage) => ({
            stage,
            label: STAGE_LABELS[stage],
            items: rows.filter((r) => r.stage === stage),
            count: rows.filter((r) => r.stage === stage).length
        }));

        return res.json({ errCode: 0, data: { columns, total: rows.length } });
    } catch (error) {
        logger.error('doc bang Kanban that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không đọc được danh sách ứng viên' });
    }
};

// ===== DANH SACH DANG BANG =====
export const listApplications = async (req, res) => {
    const scope = companyScope(req);
    if (!scope) return forbidden(res, 'Tài khoản của bạn chưa thuộc công ty nào');

    const conditions = [];
    const params = [];
    if (scope.clause) { params.push(...scope.params); conditions.push(scope.clause); }
    if (req.query.jobId) { params.push(Number(req.query.jobId)); conditions.push(`job_id = $${params.length}`); }
    if (req.query.stage) { params.push(req.query.stage); conditions.push(`stage = $${params.length}`); }
    if (req.query.minRating) { params.push(Number(req.query.minRating)); conditions.push(`rating >= $${params.length}`); }
    if (req.query.q) {
        params.push(`%${req.query.q}%`);
        conditions.push(`(candidate_name ILIKE $${params.length} OR candidate_email ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;

    try {
        const { rows } = await pool.query(
            `SELECT * FROM applications ${where}
             ORDER BY applied_at DESC LIMIT ${limit} OFFSET ${offset}`,
            params
        );
        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*)::int AS total FROM applications ${where}`, params
        );
        return res.json({ errCode: 0, data: rows, count: countRows[0].total });
    } catch (error) {
        logger.error('doc danh sach that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không đọc được danh sách' });
    }
};

// ===== CHI TIET =====
export const getApplication = async (req, res) => {
    const { roleCode, companyId, userId } = identity(req);
    try {
        const { rows } = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
        if (!rows.length) {
            return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy hồ sơ ứng tuyển' });
        }
        const app = rows[0];

        // Ung vien duoc xem ho so cua chinh minh; nha tuyen dung xem ho so nop vao
        // cong ty minh; admin xem tat ca.
        const isOwner = app.candidate_id === userId;
        const isCompany = app.company_id === companyId;
        if (roleCode !== 'ADMIN' && !isOwner && !isCompany) {
            return forbidden(res, 'Bạn không có quyền xem hồ sơ này');
        }

        const [notes, events] = await Promise.all([
            pool.query('SELECT * FROM application_notes WHERE application_id = $1 ORDER BY created_at DESC', [app.id]),
            pool.query('SELECT * FROM application_events WHERE application_id = $1 ORDER BY created_at DESC', [app.id])
        ]);

        // Nha tuyen dung mo ho so ra thi danh dau da xem.
        if (isCompany && !app.is_read) {
            await pool.query('UPDATE applications SET is_read = TRUE WHERE id = $1', [app.id]);
            app.is_read = true;
        }

        return res.json({
            errCode: 0,
            data: { ...app, notes: notes.rows, timeline: events.rows }
        });
    } catch (error) {
        logger.error('doc chi tiet that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};

// ===== KEO THA TREN KANBAN =====
export const moveStage = async (req, res) => {
    const { userId, roleCode, companyId } = identity(req);
    const { stage, reason } = req.body || {};

    if (!STAGES.includes(stage)) {
        return res.status(400).json({
            errCode: 1,
            errMessage: `Trạng thái không hợp lệ. Chỉ nhận: ${STAGES.join(', ')}`
        });
    }

    try {
        const result = await withTransaction(async (client) => {
            const { rows } = await client.query('SELECT * FROM applications WHERE id = $1 FOR UPDATE', [req.params.id]);
            if (!rows.length) return { notFound: true };

            const app = rows[0];
            if (roleCode !== 'ADMIN' && app.company_id !== companyId) return { denied: true };
            if (app.stage === stage) return { app, unchanged: true };

            const { rows: updated } = await client.query(
                `UPDATE applications
                 SET stage = $1, stage_changed_at = NOW(), updated_at = NOW()
                 WHERE id = $2 RETURNING *`,
                [stage, app.id]
            );

            // Ghi lich su trong cung giao dich voi lan chuyen trang thai: neu tach
            // ra, mot lan loi se de lai ho so da doi trang thai ma khong co dau vet
            // ai doi - dung thu can nhat khi co tranh chap ve tuyen dung.
            await client.query(
                `INSERT INTO application_events (application_id, from_stage, to_stage, actor_id, reason)
                 VALUES ($1, $2, $3, $4, $5)`,
                [app.id, app.stage, stage, userId, reason || null]
            );

            const changedApp = updated[0];
            await enqueueOutboxEvent(client, {
                aggregateId: app.id,
                eventType: EVENTS.APPLICATION_STAGE_CHANGED,
                correlationId: req.headers['x-correlation-id'] || req.correlationId || null,
                payload: {
                    applicationId: changedApp.id,
                    candidateId: changedApp.candidate_id,
                    candidateEmail: changedApp.candidate_email,
                    candidateName: changedApp.candidate_name,
                    jobId: changedApp.job_id,
                    jobTitle: changedApp.job_title,
                    fromStage: app.stage,
                    toStage: stage,
                    reason: reason || null
                }
            });
            return { app: changedApp, from: app.stage };
        });

        if (result.notFound) return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy hồ sơ' });
        if (result.denied) return forbidden(res, 'Bạn không có quyền chuyển trạng thái hồ sơ này');
        if (result.unchanged) return res.json({ errCode: 0, data: result.app });

        logger.info('da chuyen trang thai', {
            applicationId: result.app.id, from: result.from, to: stage, actor: userId
        });
        return res.json({ errCode: 0, data: result.app });
    } catch (error) {
        logger.error('chuyen trang thai that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không chuyển được trạng thái' });
    }
};

// ===== GUI KET QUA TUYEN DUNG =====
// Thao tac nay vua chot trang thai cua ho so, vua phat yeu cau gui email. Nha
// tuyen dung co the bam lai de gui nhac lai ma khong phai keo the qua lai giua
// cac cot Kanban.
export const sendDecisionNotification = async (req, res) => {
    const { userId, roleCode, companyId } = identity(req);
    const { decision, message } = req.body || {};
    const stageByDecision = { accepted: 'nhan_viec', rejected: 'tu_choi' };
    const stage = stageByDecision[decision];
    const candidateMessage = String(message || '').trim().slice(0, 3000);

    if (!stage) {
        return res.status(400).json({
            errCode: 1,
            errMessage: 'Kết quả không hợp lệ. Chỉ nhận accepted hoặc rejected'
        });
    }

    try {
        const result = await withTransaction(async (client) => {
            const { rows } = await client.query(
                'SELECT * FROM applications WHERE id = $1 FOR UPDATE', [req.params.id]
            );
            if (!rows.length) return { notFound: true };

            const app = rows[0];
            if (roleCode !== 'ADMIN' && app.company_id !== companyId) return { denied: true };

            const changed = app.stage !== stage;
            let updated = app;
            if (changed) {
                const { rows: changedRows } = await client.query(
                    `UPDATE applications
                     SET stage = $1, stage_changed_at = NOW(), updated_at = NOW()
                     WHERE id = $2 RETURNING *`,
                    [stage, app.id]
                );
                updated = changedRows[0];
            }

            // Luu dau vet ca khi gui lai email, de nha tuyen dung biet lan cuoi
            // cung da thong bao ket qua vao luc nao.
            await client.query(
                `INSERT INTO application_events (application_id, from_stage, to_stage, actor_id, reason)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    app.id,
                    changed ? app.stage : null,
                    stage,
                    userId,
                    decision === 'accepted'
                        ? 'Đã yêu cầu gửi email thông báo trúng tuyển cho ứng viên'
                        : 'Đã yêu cầu gửi email thông báo không trúng tuyển cho ứng viên'
                ]
            );

            const from = changed ? app.stage : null;
            await enqueueOutboxEvent(client, {
                aggregateId: app.id,
                eventType: EVENTS.APPLICATION_DECISION_EMAIL_REQUESTED,
                correlationId: req.headers['x-correlation-id'] || req.correlationId || null,
                payload: {
                    applicationId: updated.id,
                    candidateId: updated.candidate_id,
                    candidateEmail: updated.candidate_email,
                    candidateName: updated.candidate_name,
                    jobId: updated.job_id,
                    jobTitle: updated.job_title,
                    companyId: updated.company_id,
                    decision,
                    message: candidateMessage || null,
                    fromStage: from,
                    toStage: stage
                }
            });
            return { app: updated, from, changed };
        });

        if (result.notFound) return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy hồ sơ ứng tuyển' });
        if (result.denied) return forbidden(res, 'Bạn không có quyền gửi kết quả cho hồ sơ này');

        logger.info('da yeu cau gui email ket qua tuyen dung', {
            applicationId: result.app.id, decision, actor: userId, changed: result.changed
        });
        return res.json({ errCode: 0, data: result.app, emailQueued: true });
    } catch (error) {
        logger.error('gui ket qua tuyen dung that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không thể gửi email kết quả' });
    }
};

// ===== DANH GIA SAO =====
export const rateApplication = async (req, res) => {
    const { roleCode, companyId } = identity(req);
    const rating = Number(req.body?.rating);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ errCode: 1, errMessage: 'Đánh giá phải từ 1 đến 5 sao' });
    }

    try {
        const { rows } = await pool.query('SELECT company_id FROM applications WHERE id = $1', [req.params.id]);
        if (!rows.length) return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy hồ sơ' });
        if (roleCode !== 'ADMIN' && rows[0].company_id !== companyId) {
            return forbidden(res, 'Bạn không có quyền đánh giá hồ sơ này');
        }

        const { rows: updated } = await pool.query(
            'UPDATE applications SET rating = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [rating, req.params.id]
        );
        return res.json({ errCode: 0, data: updated[0] });
    } catch (error) {
        logger.error('danh gia that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};

// ===== GHI CHU NOI BO =====
export const addNote = async (req, res) => {
    const { userId, roleCode, companyId } = identity(req);
    const body = String(req.body?.body || '').trim();

    if (!body) return res.status(400).json({ errCode: 1, errMessage: 'Nội dung ghi chú không được để trống' });

    try {
        const { rows } = await pool.query('SELECT company_id FROM applications WHERE id = $1', [req.params.id]);
        if (!rows.length) return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy hồ sơ' });
        // Ghi chu la trao doi noi bo giua nhung nguoi tuyen dung, ung vien khong duoc xem.
        if (roleCode !== 'ADMIN' && rows[0].company_id !== companyId) {
            return forbidden(res, 'Bạn không có quyền ghi chú vào hồ sơ này');
        }

        const { rows: created } = await pool.query(
            'INSERT INTO application_notes (application_id, author_id, body) VALUES ($1, $2, $3) RETURNING *',
            [req.params.id, userId, body.slice(0, 5000)]
        );
        return res.status(201).json({ errCode: 0, data: created[0] });
    } catch (error) {
        logger.error('them ghi chu that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};

// ===== THONG KE PHEU TUYEN DUNG =====
export const getFunnel = async (req, res) => {
    const scope = companyScope(req);
    if (!scope) return forbidden(res, 'Tài khoản của bạn chưa thuộc công ty nào');

    const conditions = [];
    const params = [];
    if (scope.clause) { params.push(...scope.params); conditions.push(scope.clause); }
    if (req.query.jobId) { params.push(Number(req.query.jobId)); conditions.push(`job_id = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const { rows } = await pool.query(
            `SELECT stage, COUNT(*)::int AS count, AVG(rating)::numeric(3,2) AS avg_rating
             FROM applications ${where} GROUP BY stage`,
            params
        );
        const byStage = Object.fromEntries(rows.map((r) => [r.stage, r]));

        // Giu dung thu tu cac buoc de ve duoc hinh pheu.
        const funnel = STAGES.map((stage) => ({
            stage,
            label: STAGE_LABELS[stage],
            count: byStage[stage]?.count ?? 0,
            avgRating: byStage[stage]?.avg_rating ?? null
        }));

        const total = funnel.reduce((sum, s) => sum + s.count, 0);
        const hired = byStage.nhan_viec?.count ?? 0;
        return res.json({
            errCode: 0,
            data: {
                funnel,
                total,
                hired,
                // Ty le chuyen doi: bao nhieu phan tram ho so di den buoc nhan viec.
                conversionRate: total ? Number(((hired / total) * 100).toFixed(1)) : 0
            }
        });
    } catch (error) {
        logger.error('thong ke that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};

// ===== UNG VIEN XEM LICH SU UNG TUYEN CUA MINH =====
export const myApplications = async (req, res) => {
    const { userId } = identity(req);
    if (!userId) return res.status(401).json({ errCode: 401, errMessage: 'Chưa xác định được người dùng' });

    try {
        const { rows } = await pool.query(
            `SELECT id, job_id, job_title, stage, applied_at, stage_changed_at
             FROM applications WHERE candidate_id = $1 ORDER BY applied_at DESC`,
            [userId]
        );
        return res.json({
            errCode: 0,
            data: rows.map((r) => ({ ...r, stageLabel: STAGE_LABELS[r.stage] })),
            count: rows.length
        });
    } catch (error) {
        logger.error('doc lich su ung tuyen that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};
