import { pool, withTransaction, STAGES, STAGE_LABELS } from '../libs/db.js';
import { enqueueOutboxEvent } from '../libs/outbox.js';
import { EVENTS } from '../../../shared/events.js';
import { createLogger } from '../../../shared/logger.js';
import { validateOffer } from '../libs/offer.js';
import { validateInterview } from '../libs/interview.js';

const logger = createLogger('application-service');

// Danh tinh do Gateway dat vao header sau khi xac thuc JWT.
const identity = (req) => ({
    userId: req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null,
    roleCode: req.headers['x-user-role'] || null,
    companyId: req.headers['x-company-id'] ? Number(req.headers['x-company-id']) : null
});

const forbidden = (res, msg) =>
    res.status(403).json({ errCode: 3, errMessage: msg || 'Bạn không có quyền truy cập dữ liệu này' });

// Ung vien da tung o buoc phong van thi email tu choi phai cam on ho da tham gia,
// va ky ten/nhan phan hoi theo thu moi phong van gan nhat neu co.
const interviewHistory = async (client, app) => {
    const { rows } = await client.query(
        `SELECT decision_snapshot FROM application_events
         WHERE application_id = $1 AND to_stage = 'phong_van'
         ORDER BY created_at DESC, id DESC`,
        [app.id]
    );
    const invitation = rows.find((row) => row.decision_snapshot?.decision === 'interview');
    return {
        interviewed: app.stage === 'phong_van' || rows.length > 0,
        interview: invitation ? invitation.decision_snapshot.interview : null
    };
};

// Payload su kien dung chung cho lam that va kiem tra truoc (dryRun): email xem truoc duoc
// dung tu dung du lieu ma outbox se gui.
const applicantFields = (app) => ({
    applicationId: app.id,
    candidateId: app.candidate_id,
    candidateEmail: app.candidate_email,
    candidateName: app.candidate_name,
    jobId: app.job_id,
    jobTitle: app.job_title
});
const stageChangedPayload = (app, { fromStage, toStage, reason, history }) => ({
    ...applicantFields(app),
    fromStage,
    toStage,
    reason: reason || null,
    ...(history ? { interviewed: history.interviewed } : {}),
    ...(history?.interview ? { companyName: history.interview.companyName } : {})
});
const decisionPayload = (app, { decision, message, offer, history, interviewed, fromStage, toStage }) => ({
    ...applicantFields(app),
    companyId: app.company_id,
    ...(offer ? { companyName: offer.companyName } : {}),
    ...(history?.interview ? { companyName: history.interview.companyName, interview: history.interview } : {}),
    decision,
    message: message || null,
    ...(offer ? { offer } : {}),
    ...(history ? { interviewed } : {}),
    fromStage,
    toStage
});
const interviewPayload = (app, { interview, message, fromStage }) => ({
    ...applicantFields(app),
    companyId: app.company_id,
    companyName: interview.companyName,
    message: message || null,
    interview,
    fromStage,
    toStage: 'phong_van'
});

// Ket qua tuyen dung: buoc dich va lich su phong van (de cam on ung vien da tham gia).
const planDecision = async (client, app, { decision, interviewedInput }) => {
    const history = decision === 'rejected' ? await interviewHistory(client, app) : null;
    const interviewed = history && (typeof interviewedInput === 'boolean' ? interviewedInput : history.interviewed);
    // An invitation awaits a reply; sending again must not undo a confirmed hire.
    const stage = decision === 'accepted' && app.stage === 'nhan_viec' ? 'nhan_viec' : { accepted: 'de_nghi', rejected: 'tu_choi' }[decision];
    return { history, interviewed, stage, changed: app.stage !== stage };
};

// ===== KIEM TRA TRUOC (?dryRun=true) =====
// Chay dung cac buoc kiem tra du lieu, quyen va trang thai ho so nhu khi lam that, nhung
// khong khoa/ghi CSDL, khong tao outbox. Notification Service dung ban xem truoc email
// bang dung mau va quy tac nguoi nhan cua luong gui that.
const isDryRun = (req) => req.query?.dryRun === 'true';

const previewNotification = async (req, eventType, payload) => {
    try {
        const response = await fetch(`${process.env.NOTIFICATION_URL || 'http://notification-service:4005'}/internal/email-preview`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-internal-secret': process.env.INTERNAL_SECRET || '',
                ...(req.correlationId ? { 'x-correlation-id': req.correlationId } : {})
            },
            body: JSON.stringify({ eventType, payload }),
            signal: AbortSignal.timeout(3000)
        });
        const body = await response.json();
        if (!response.ok || body.errCode !== 0) return { previewError: body.errMessage || 'Không lấy được bản xem trước email' };
        return body.data;
    } catch {
        return { previewError: 'Không kết nối được Notification Service để xem trước email' };
    }
};

const dryRunResult = async (req, res, { app, eventType, payload, fromStage, toStage, note }) => res.json({
    errCode: 0,
    dryRun: true,
    emailQueued: false,
    errMessage: note || 'Kiểm tra đạt: chưa lưu thay đổi và chưa gửi email',
    data: app,
    preview: {
        fromStage,
        toStage,
        eventType: eventType || null,
        event: payload || null,
        ...(eventType ? await previewNotification(req, eventType, payload) : { inApp: null, email: null })
    }
});

// Doc ho so de kiem tra truoc: khong khoa, cung thong bao loi voi lam that.
const loadForDryRun = async (req, res, { notFound, denied }) => {
    const { roleCode, companyId } = identity(req);
    const { rows } = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (!rows.length) {
        res.status(404).json({ errCode: 2, errMessage: notFound });
        return null;
    }
    if (roleCode !== 'ADMIN' && rows[0].company_id !== companyId) {
        forbidden(res, denied);
        return null;
    }
    return rows[0];
};

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
            pool.query('SELECT * FROM application_events WHERE application_id = $1 ORDER BY created_at DESC, id DESC', [app.id])
        ]);

        // Nha tuyen dung mo ho so ra thi danh dau da xem.
        if (isCompany && !app.is_read) {
            await pool.query('UPDATE applications SET is_read = TRUE WHERE id = $1', [app.id]);
            app.is_read = true;
        }

        const lastDecision = events.rows.find((event) => event.decision_snapshot);
        return res.json({
            errCode: 0,
            data: { ...app, notes: notes.rows, timeline: events.rows,
                latestDecision: lastDecision ? { ...lastDecision.decision_snapshot, requestedAt: lastDecision.created_at } : null }
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

    if (isDryRun(req)) {
        try {
            const app = await loadForDryRun(req, res, { notFound: 'Không tìm thấy hồ sơ', denied: 'Bạn không có quyền chuyển trạng thái hồ sơ này' });
            if (!app) return res;
            if (app.stage === stage) {
                return dryRunResult(req, res, { app, fromStage: app.stage, toStage: stage,
                    note: 'Hồ sơ đã ở giai đoạn này: lưu thật cũng không thay đổi gì và không gửi thông báo' });
            }
            const history = stage === 'tu_choi' ? await interviewHistory(pool, app) : null;
            const payload = stageChangedPayload(app, { fromStage: app.stage, toStage: stage, reason, history });
            return dryRunResult(req, res, { app, eventType: EVENTS.APPLICATION_STAGE_CHANGED, payload, fromStage: app.stage, toStage: stage });
        } catch (error) {
            logger.error('kiem tra truoc chuyen trang thai that bai', { error: error.message });
            return res.status(500).json({ errCode: -1, errMessage: 'Không kiểm tra được thao tác chuyển trạng thái' });
        }
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
            const history = stage === 'tu_choi' ? await interviewHistory(client, app) : null;
            await enqueueOutboxEvent(client, {
                aggregateId: app.id,
                eventType: EVENTS.APPLICATION_STAGE_CHANGED,
                correlationId: req.headers['x-correlation-id'] || req.correlationId || null,
                payload: stageChangedPayload(changedApp, { fromStage: app.stage, toStage: stage, reason, history })
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
// Thu moi nhan viec cho phan hoi cua ung vien; moi lan gui luu snapshot va
// outbox trong cung giao dich. Gui lai khong tu dong xac nhan ung vien da nhan viec.
export const sendDecisionNotification = async (req, res) => {
    const { userId, roleCode, companyId } = identity(req);
    const { decision, message, offer: offerInput, interviewed: interviewedInput } = req.body || {};
    const candidateMessage = String(message || '').trim().slice(0, 3000);

    if (!['accepted', 'rejected'].includes(decision)) {
        return res.status(400).json({
            errCode: 1,
            errMessage: 'Kết quả không hợp lệ. Chỉ nhận accepted hoặc rejected'
        });
    }

    const validated = decision === 'accepted' ? validateOffer(offerInput) : {};
    if (validated.error) return res.status(400).json({ errCode: 1, errMessage: validated.error });
    const snapshot = { decision, message: candidateMessage || null, ...(validated.offer ? { offer: validated.offer } : {}) };

    if (isDryRun(req)) {
        try {
            const app = await loadForDryRun(req, res, { notFound: 'Không tìm thấy hồ sơ ứng tuyển', denied: 'Bạn không có quyền gửi kết quả cho hồ sơ này' });
            if (!app) return res;
            const { history, interviewed, stage, changed } = await planDecision(pool, app, { decision, interviewedInput });
            const payload = decisionPayload(app, { decision, message: candidateMessage, offer: validated.offer, history, interviewed,
                fromStage: changed ? app.stage : null, toStage: stage });
            return dryRunResult(req, res, { app, eventType: EVENTS.APPLICATION_DECISION_EMAIL_REQUESTED, payload, fromStage: app.stage, toStage: stage });
        } catch (error) {
            logger.error('kiem tra truoc ket qua tuyen dung that bai', { error: error.message });
            return res.status(500).json({ errCode: -1, errMessage: 'Không kiểm tra được email kết quả' });
        }
    }

    try {
        const result = await withTransaction(async (client) => {
            const { rows } = await client.query(
                'SELECT * FROM applications WHERE id = $1 FOR UPDATE', [req.params.id]
            );
            if (!rows.length) return { notFound: true };

            const app = rows[0];
            if (roleCode !== 'ADMIN' && app.company_id !== companyId) return { denied: true };

            // Nha tuyen dung co the xac nhan ung vien chua den phong van (khong cam on
            // "da tham gia"); mac dinh theo lich su ho so.
            const { history, interviewed, stage, changed } = await planDecision(client, app, { decision, interviewedInput });
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
                `INSERT INTO application_events (application_id, from_stage, to_stage, actor_id, reason, decision_snapshot)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
                [
                    app.id,
                    changed ? app.stage : null,
                    stage,
                    userId,
                    decision === 'accepted'
                        ? 'Đã yêu cầu gửi thư mời nhận việc; chờ ứng viên phản hồi qua email HR'
                        : interviewed
                            ? 'Đã yêu cầu gửi email cảm ơn ứng viên đã tham gia phỏng vấn (không trúng tuyển)'
                            : 'Đã yêu cầu gửi email thông báo không trúng tuyển cho ứng viên',
                    JSON.stringify(history ? { ...snapshot, interviewed } : snapshot)
                ]
            );

            const from = changed ? app.stage : null;
            await enqueueOutboxEvent(client, {
                aggregateId: app.id,
                eventType: EVENTS.APPLICATION_DECISION_EMAIL_REQUESTED,
                correlationId: req.headers['x-correlation-id'] || req.correlationId || null,
                payload: decisionPayload(updated, { decision, message: candidateMessage, offer: validated.offer, history, interviewed,
                    fromStage: from, toStage: stage })
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

// ===== GUI THU MOI PHONG VAN =====
// Chuyen ho so sang buoc phong van va gui thu co ngay gio, hinh thuc, dia diem
// hoac duong dan va nguoi lien he. Gui lai (doi lich) chi them snapshot moi.
export const sendInterviewInvitation = async (req, res) => {
    const { userId, roleCode, companyId } = identity(req);
    const { message, interview: interviewInput } = req.body || {};
    const candidateMessage = String(message || '').trim().slice(0, 3000);
    const validated = validateInterview(interviewInput);
    if (validated.error) return res.status(400).json({ errCode: 1, errMessage: validated.error });
    const { interview } = validated;
    const snapshot = { decision: 'interview', message: candidateMessage || null, interview };

    if (isDryRun(req)) {
        try {
            const app = await loadForDryRun(req, res, { notFound: 'Không tìm thấy hồ sơ ứng tuyển', denied: 'Bạn không có quyền gửi thư mời cho hồ sơ này' });
            if (!app) return res;
            if (app.stage === 'nhan_viec') {
                return res.status(409).json({ errCode: 4, errMessage: 'Ứng viên đã nhận việc; không gửi thư mời phỏng vấn cho hồ sơ này' });
            }
            const payload = interviewPayload(app, { interview, message: candidateMessage, fromStage: app.stage !== 'phong_van' ? app.stage : null });
            return dryRunResult(req, res, { app, eventType: EVENTS.APPLICATION_INTERVIEW_INVITATION_REQUESTED, payload, fromStage: app.stage, toStage: 'phong_van' });
        } catch (error) {
            logger.error('kiem tra truoc thu moi phong van that bai', { error: error.message });
            return res.status(500).json({ errCode: -1, errMessage: 'Không kiểm tra được thư mời phỏng vấn' });
        }
    }

    try {
        const result = await withTransaction(async (client) => {
            const { rows } = await client.query(
                'SELECT * FROM applications WHERE id = $1 FOR UPDATE', [req.params.id]
            );
            if (!rows.length) return { notFound: true };

            const app = rows[0];
            if (roleCode !== 'ADMIN' && app.company_id !== companyId) return { denied: true };
            // Moi phong van khong duoc lam mat ket qua da xac nhan nhan viec.
            if (app.stage === 'nhan_viec') return { hired: true };

            const changed = app.stage !== 'phong_van';
            let updated = app;
            if (changed) {
                const { rows: changedRows } = await client.query(
                    `UPDATE applications
                     SET stage = 'phong_van', stage_changed_at = NOW(), updated_at = NOW()
                     WHERE id = $1 RETURNING *`,
                    [app.id]
                );
                updated = changedRows[0];
            }

            await client.query(
                `INSERT INTO application_events (application_id, from_stage, to_stage, actor_id, reason, decision_snapshot)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
                [
                    app.id,
                    changed ? app.stage : null,
                    'phong_van',
                    userId,
                    changed
                        ? 'Đã yêu cầu gửi thư mời phỏng vấn; chờ ứng viên xác nhận qua email HR'
                        : 'Đã yêu cầu gửi lại thư mời phỏng vấn (cập nhật lịch); chờ ứng viên xác nhận qua email HR',
                    JSON.stringify(snapshot)
                ]
            );

            const from = changed ? app.stage : null;
            await enqueueOutboxEvent(client, {
                aggregateId: app.id,
                eventType: EVENTS.APPLICATION_INTERVIEW_INVITATION_REQUESTED,
                correlationId: req.headers['x-correlation-id'] || req.correlationId || null,
                payload: interviewPayload(updated, { interview, message: candidateMessage, fromStage: from })
            });
            return { app: updated, changed };
        });

        if (result.notFound) return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy hồ sơ ứng tuyển' });
        if (result.denied) return forbidden(res, 'Bạn không có quyền gửi thư mời cho hồ sơ này');
        if (result.hired) {
            return res.status(409).json({ errCode: 4, errMessage: 'Ứng viên đã nhận việc; không gửi thư mời phỏng vấn cho hồ sơ này' });
        }

        logger.info('da yeu cau gui thu moi phong van', {
            applicationId: result.app.id, actor: userId, changed: result.changed
        });
        return res.json({ errCode: 0, data: result.app, emailQueued: true });
    } catch (error) {
        logger.error('gui thu moi phong van that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không thể gửi thư mời phỏng vấn' });
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
    res.setHeader('Cache-Control', 'private, no-store');
    const { userId } = identity(req);
    if (!userId) return res.status(401).json({ errCode: 401, errMessage: 'Chưa xác định được người dùng' });

    try {
        const { rows } = await pool.query(
            `SELECT id, legacy_cv_id, job_id, job_title, stage, applied_at, stage_changed_at
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
