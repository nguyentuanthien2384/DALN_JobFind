import { pool } from '../libs/db.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('application-service');

// Kho ung vien: nha tuyen dung gap mot nguoi hay nhung chua dung vi tri dang tuyen,
// luu lai de con tim den khi mo vi tri khac. Day la thu khien nha tuyen dung quay
// lai san, thay vi moi lan tuyen lai di tim tu dau.

const identity = (req) => ({
    userId: req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null,
    roleCode: req.headers['x-user-role'] || null,
    companyId: req.headers['x-company-id'] ? Number(req.headers['x-company-id']) : null
});

export const savedCandidates = async (req, res) => {
    const { companyId, roleCode } = identity(req);
    if (companyId === null && roleCode !== 'ADMIN') {
        return res.status(403).json({ errCode: 3, errMessage: 'Tài khoản của bạn chưa thuộc công ty nào' });
    }

    const conditions = [];
    const params = [];
    if (roleCode !== 'ADMIN') { params.push(companyId); conditions.push(`company_id = $${params.length}`); }
    if (req.query.tag) { params.push(req.query.tag); conditions.push(`$${params.length} = ANY(tags)`); }
    if (req.query.q) {
        params.push(`%${req.query.q}%`);
        conditions.push(`candidate_name ILIKE $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const { rows } = await pool.query(
            `SELECT * FROM talent_pool ${where} ORDER BY saved_at DESC LIMIT 200`, params
        );
        return res.json({ errCode: 0, data: rows, count: rows.length });
    } catch (error) {
        logger.error('doc kho ung vien that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};

export const saveCandidate = async (req, res) => {
    const { userId, companyId, roleCode } = identity(req);
    if (companyId === null && roleCode !== 'ADMIN') {
        return res.status(403).json({ errCode: 3, errMessage: 'Tài khoản của bạn chưa thuộc công ty nào' });
    }

    const { candidateId, candidateName, tags, note } = req.body || {};
    if (!candidateId) {
        return res.status(400).json({ errCode: 1, errMessage: 'Thiếu mã ứng viên' });
    }

    try {
        // Luu lai nguoi da luu roi thi cap nhat ghi chu/nhan, khong bao loi trung.
        const { rows } = await pool.query(
            `INSERT INTO talent_pool (company_id, candidate_id, candidate_name, saved_by, tags, note)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (company_id, candidate_id)
             DO UPDATE SET tags = EXCLUDED.tags, note = EXCLUDED.note, saved_at = NOW()
             RETURNING *`,
            [companyId, Number(candidateId), candidateName || null, userId,
                Array.isArray(tags) ? tags : [], note || null]
        );
        return res.status(201).json({ errCode: 0, data: rows[0] });
    } catch (error) {
        logger.error('luu ung vien that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không lưu được ứng viên' });
    }
};

export const removeCandidate = async (req, res) => {
    const { companyId, roleCode } = identity(req);
    try {
        const conditions = ['candidate_id = $1'];
        const params = [Number(req.params.candidateId)];
        if (roleCode !== 'ADMIN') { params.push(companyId); conditions.push(`company_id = $${params.length}`); }

        const { rowCount } = await pool.query(
            `DELETE FROM talent_pool WHERE ${conditions.join(' AND ')}`, params
        );
        if (!rowCount) return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy trong kho ứng viên' });
        return res.json({ errCode: 0, errMessage: 'Đã bỏ khỏi kho ứng viên' });
    } catch (error) {
        logger.error('xoa khoi kho that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};
