import { mysqlPool, pgPool } from '../libs/sources.js';
import { AuditLog } from '../models/AuditLog.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('admin-service');

// Khoang thoi gian mac dinh: 30 ngay gan nhat.
const range = (req) => {
    const to = req.query.toDate ? new Date(req.query.toDate) : new Date();
    const from = req.query.fromDate
        ? new Date(req.query.fromDate)
        : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    return { from, to };
};

const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

// ===== TONG QUAN =====
// Cac con so lon hien tren dau trang quan tri.
export const overview = async (req, res) => {
    const { from, to } = range(req);
    try {
        const [[users]] = await mysqlPool.query(
            'SELECT COUNT(*) AS total FROM accounts WHERE statusCode = "S1"'
        );
        const [[newUsers]] = await mysqlPool.query(
            'SELECT COUNT(*) AS total FROM accounts WHERE createdAt BETWEEN ? AND ?', [fmt(from), fmt(to)]
        );
        const [[companies]] = await mysqlPool.query('SELECT COUNT(*) AS total FROM companies');
        const [[jobs]] = await mysqlPool.query(
            'SELECT COUNT(*) AS total FROM posts WHERE statusCode = "PS1"'
        );
        const [[pending]] = await mysqlPool.query(
            'SELECT COUNT(*) AS total FROM posts WHERE statusCode = "PS3"'
        );
        const [[revenue]] = await mysqlPool.query(
            `SELECT COALESCE(SUM(currentPrice), 0) AS total FROM orderpackages
             WHERE createdAt BETWEEN ? AND ?`, [fmt(from), fmt(to)]
        );
        const [[revenueCv]] = await mysqlPool.query(
            `SELECT COALESCE(SUM(currentPrice), 0) AS total FROM orderpackagecvs
             WHERE createdAt BETWEEN ? AND ?`, [fmt(from), fmt(to)]
        );

        // Ho so ung tuyen nam o PostgreSQL cua Application Service.
        let applications = 0;
        let hired = 0;
        try {
            const { rows } = await pgPool.query(
                `SELECT COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE stage = 'nhan_viec')::int AS hired
                 FROM applications WHERE applied_at BETWEEN $1 AND $2`,
                [from, to]
            );
            applications = rows[0].total;
            hired = rows[0].hired;
        } catch {
            // Application Service chua san sang - de 0 con hon lam hong ca trang.
        }

        return res.json({
            errCode: 0,
            data: {
                khoangThoiGian: { from, to },
                nguoiDung: { tong: users.total, moi: newUsers.total },
                congTy: companies.total,
                tinTuyenDung: { dangHienThi: jobs.total, choDuyet: pending.total },
                hoSoUngTuyen: { tong: applications, daTuyen: hired },
                doanhThu: {
                    goiTin: Number(revenue.total),
                    goiXemCv: Number(revenueCv.total),
                    tong: Number(revenue.total) + Number(revenueCv.total)
                }
            }
        });
    } catch (error) {
        logger.error('bao cao tong quan that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không tổng hợp được số liệu' });
    }
};

// ===== BIEU DO THEO THOI GIAN =====
export const timeseries = async (req, res) => {
    const { from, to } = range(req);
    try {
        // Gom theo ngay o phia CSDL thay vi keo het ve roi tinh trong Node: du lieu
        // truyen qua mang it hon han, va CSDL lam viec nay nhanh hon nhieu.
        const [jobs] = await mysqlPool.query(
            `SELECT DATE(createdAt) AS ngay, COUNT(*) AS soLuong FROM posts
             WHERE createdAt BETWEEN ? AND ? GROUP BY DATE(createdAt) ORDER BY ngay`,
            [fmt(from), fmt(to)]
        );
        const [users] = await mysqlPool.query(
            `SELECT DATE(createdAt) AS ngay, COUNT(*) AS soLuong FROM accounts
             WHERE createdAt BETWEEN ? AND ? GROUP BY DATE(createdAt) ORDER BY ngay`,
            [fmt(from), fmt(to)]
        );
        const [revenue] = await mysqlPool.query(
            `SELECT DATE(createdAt) AS ngay, SUM(currentPrice) AS tien FROM orderpackages
             WHERE createdAt BETWEEN ? AND ? GROUP BY DATE(createdAt) ORDER BY ngay`,
            [fmt(from), fmt(to)]
        );

        let applications = [];
        try {
            const { rows } = await pgPool.query(
                `SELECT DATE(applied_at) AS ngay, COUNT(*)::int AS "soLuong"
                 FROM applications WHERE applied_at BETWEEN $1 AND $2
                 GROUP BY DATE(applied_at) ORDER BY ngay`,
                [from, to]
            );
            applications = rows;
        } catch { /* Application Service chua san sang */ }

        return res.json({
            errCode: 0,
            data: {
                tinTuyenDung: jobs,
                nguoiDungMoi: users,
                doanhThu: revenue.map((r) => ({ ngay: r.ngay, tien: Number(r.tien) })),
                hoSoUngTuyen: applications
            }
        });
    } catch (error) {
        logger.error('bao cao theo thoi gian that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không tổng hợp được số liệu' });
    }
};

// ===== PHAN BO THEO DANH MUC =====
export const distribution = async (req, res) => {
    try {
        const [byCategory] = await mysqlPool.query(
            `SELECT c.value AS ten, COUNT(*) AS soLuong
             FROM posts p
             JOIN detailposts d ON d.id = p.detailPostId
             JOIN allcodes c ON c.code = d.categoryJobCode AND c.type = 'JOBTYPE'
             WHERE p.statusCode = 'PS1'
             GROUP BY d.categoryJobCode, c.value ORDER BY soLuong DESC`
        );
        const [byProvince] = await mysqlPool.query(
            `SELECT d.addressCode AS ten, COUNT(*) AS soLuong
             FROM posts p JOIN detailposts d ON d.id = p.detailPostId
             WHERE p.statusCode = 'PS1' AND d.addressCode IS NOT NULL
             GROUP BY d.addressCode ORDER BY soLuong DESC LIMIT 15`
        );
        const [bySalary] = await mysqlPool.query(
            `SELECT c.value AS ten, COUNT(*) AS soLuong
             FROM posts p
             JOIN detailposts d ON d.id = p.detailPostId
             JOIN allcodes c ON c.code = d.salaryJobCode AND c.type = 'SALARYTYPE'
             WHERE p.statusCode = 'PS1'
             GROUP BY d.salaryJobCode, c.value ORDER BY soLuong DESC`
        );
        const [byRole] = await mysqlPool.query(
            `SELECT c.value AS ten, COUNT(*) AS soLuong
             FROM accounts a JOIN allcodes c ON c.code = a.roleCode AND c.type = 'ROLE'
             GROUP BY a.roleCode, c.value ORDER BY soLuong DESC`
        );

        return res.json({
            errCode: 0,
            data: {
                theoNganhNghe: byCategory,
                theoTinhThanh: byProvince,
                theoMucLuong: bySalary,
                theoVaiTro: byRole
            }
        });
    } catch (error) {
        logger.error('bao cao phan bo that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không tổng hợp được số liệu' });
    }
};

// ===== PHEU TUYEN DUNG TOAN HE THONG =====
export const recruitmentFunnel = async (req, res) => {
    try {
        const { rows } = await pgPool.query(
            `SELECT stage, COUNT(*)::int AS "soLuong" FROM applications GROUP BY stage`
        );
        const order = ['moi_ung_tuyen', 'dang_xem_xet', 'phong_van', 'de_nghi', 'nhan_viec', 'tu_choi'];
        const labels = {
            moi_ung_tuyen: 'Mới ứng tuyển', dang_xem_xet: 'Đang xem xét',
            phong_van: 'Phỏng vấn', de_nghi: 'Đề nghị nhận việc',
            nhan_viec: 'Đã nhận việc', tu_choi: 'Từ chối'
        };
        const byStage = Object.fromEntries(rows.map((r) => [r.stage, r.soLuong]));
        const funnel = order.map((s) => ({ stage: s, ten: labels[s], soLuong: byStage[s] ?? 0 }));
        const tong = funnel.reduce((a, b) => a + b.soLuong, 0);

        // Top cong ty tuyen duoc nhieu nguoi nhat.
        const { rows: topCompanies } = await pgPool.query(
            `SELECT company_id AS "congTyId", COUNT(*)::int AS "soHoSo",
                    COUNT(*) FILTER (WHERE stage = 'nhan_viec')::int AS "daTuyen"
             FROM applications GROUP BY company_id ORDER BY "soHoSo" DESC LIMIT 10`
        );

        return res.json({
            errCode: 0,
            data: {
                pheu: funnel,
                tong,
                tyLeTuyen: tong ? Number(((byStage.nhan_viec ?? 0) / tong * 100).toFixed(1)) : 0,
                topCongTy: topCompanies
            }
        });
    } catch (error) {
        logger.error('bao cao pheu that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không tổng hợp được số liệu' });
    }
};

// ===== HOAT DONG HE THONG (tu audit log) =====
export const activity = async (req, res) => {
    const { from, to } = range(req);
    try {
        const [byName, byService, timeline] = await Promise.all([
            AuditLog.aggregate([
                { $match: { createdAt: { $gte: from, $lte: to } } },
                { $group: { _id: '$name', soLuong: { $sum: 1 } } },
                { $sort: { soLuong: -1 } }, { $limit: 20 }
            ]),
            AuditLog.aggregate([
                { $match: { createdAt: { $gte: from, $lte: to }, service: { $ne: null } } },
                { $group: { _id: '$service', soLuong: { $sum: 1 } } },
                { $sort: { soLuong: -1 } }
            ]),
            AuditLog.aggregate([
                { $match: { createdAt: { $gte: from, $lte: to } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        soLuong: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ])
        ]);

        return res.json({
            errCode: 0,
            data: {
                theoLoai: byName.map((r) => ({ ten: r._id, soLuong: r.soLuong })),
                theoService: byService.map((r) => ({ ten: r._id, soLuong: r.soLuong })),
                theoNgay: timeline.map((r) => ({ ngay: r._id, soLuong: r.soLuong }))
            }
        });
    } catch (error) {
        logger.error('bao cao hoat dong that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không tổng hợp được số liệu' });
    }
};
