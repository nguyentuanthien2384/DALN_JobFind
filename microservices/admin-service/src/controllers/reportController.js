import { mysqlPool, pgPool } from '../libs/sources.js';
import { AuditLog } from '../models/AuditLog.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('admin-service');

// Ngay trong bao cao la ngay lich Viet Nam (UTC+7, khong co gio mua he) va
// tinh CA ngay ket thuc: toDate=2026-10-02 lay het 23:59:59 ngay 02/10. Truoc
// day toDate bi hieu la 00:00 UTC nen chon "den hom nay" lai bo mat hom nay.
const VN_OFFSET_MS = 7 * 3600 * 1000;
const VN_TIME = "+ INTERVAL '7 hours'";
const isCalendarDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const boundary = (value, time) => new Date(isCalendarDay(value) ? `${value}T${time}+07:00` : value);

// Khoang thoi gian mac dinh: 30 ngay gan nhat.
const range = (req) => {
    const to = req.query.toDate ? boundary(req.query.toDate, '23:59:59.999') : new Date();
    const from = req.query.fromDate
        ? boundary(req.query.fromDate, '00:00:00.000')
        : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    return { from, to };
};

// MySQL cua backend luu gio Viet Nam (Sequelize timezone +07:00), nen so sanh
// bang chuoi gio Viet Nam chu khong phai chuoi UTC.
const fmt = (d) => new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');

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
        // Ngay tra ve dang chuoi YYYY-MM-DD de trinh duyet o mui gio nao cung
        // doc ra dung mot ngay.
        const daily = (table, value) => mysqlPool.query(
            `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') AS ngay, ${value} FROM ${table}
             WHERE createdAt BETWEEN ? AND ? GROUP BY ngay ORDER BY ngay`,
            [fmt(from), fmt(to)]
        );
        const [jobs] = await daily('posts', 'COUNT(*) AS soLuong');
        const [users] = await daily('accounts', 'COUNT(*) AS soLuong');
        const [revenue] = await daily('orderpackages', 'SUM(currentPrice) AS tien');
        const [revenueCv] = await daily('orderpackagecvs', 'SUM(currentPrice) AS tien');

        let applications = [];
        try {
            const { rows } = await pgPool.query(
                `SELECT to_char((applied_at AT TIME ZONE 'UTC') ${VN_TIME}, 'YYYY-MM-DD') AS ngay,
                        COUNT(*)::int AS "soLuong"
                 FROM applications WHERE applied_at BETWEEN $1 AND $2
                 GROUP BY 1 ORDER BY 1`,
                [from, to]
            );
            applications = rows;
        } catch { /* Application Service chua san sang */ }

        const money = (rows) => (rows || []).map((r) => ({ ngay: r.ngay, tien: Number(r.tien) }));
        return res.json({
            errCode: 0,
            data: {
                tinTuyenDung: jobs,
                nguoiDungMoi: users,
                doanhThu: money(revenue),
                doanhThuXemCv: money(revenueCv),
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
        // Ten cong ty nam o MySQL. Day la thong tin phu: loi thi van tra so lieu.
        const companyIds = topCompanies.map((r) => r.congTyId).filter((value) => value != null);
        let companyNames = new Map();
        if (companyIds.length) {
            try {
                const [rows] = await mysqlPool.query('SELECT id, name FROM companies WHERE id IN (?)', [companyIds]);
                companyNames = new Map(rows.map((r) => [String(r.id), r.name]));
            } catch (error) {
                logger.warn('khong doc duoc ten cong ty cho bao cao pheu', { error: error.message });
            }
        }

        return res.json({
            errCode: 0,
            data: {
                pheu: funnel,
                tong,
                tyLeTuyen: tong ? Number(((byStage.nhan_viec ?? 0) / tong * 100).toFixed(1)) : 0,
                topCongTy: topCompanies.map((r) => ({ ...r, tenCongTy: companyNames.get(String(r.congTyId)) ?? null }))
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
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+07:00' } },
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
