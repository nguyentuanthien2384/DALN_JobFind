import mysql from 'mysql2/promise';
import { pool } from '../libs/db.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('application-service');

// Dong bo ho so ung tuyen dang nam trong MySQL cua he thong cu sang pipeline moi.
//
// Khong the bat nha tuyen dung bat dau tu mot bang Kanban trong tron: nhung ho so
// da nop tu truoc van phai quan ly duoc. Ham nay chay mot lan luc khoi dong, va co
// the goi lai bat cu luc nao - ho so da dong bo se bi bo qua nho rang buoc UNIQUE
// tren legacy_cv_id.

const mysqlPool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'host.docker.internal',
    port: Number(process.env.MYSQL_PORT || 3333),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'jobfindtest',
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4_general_ci'
});

export const syncFromLegacy = async () => {
    try {
        const [rows] = await mysqlPool.query(
            `SELECT cv.id AS cv_id, cv.userId AS candidate_id, cv.postId AS job_id,
                    cv.isChecked, cv.description, cv.createdAt,
                    u.firstName, u.lastName, u.email,
                    a.phonenumber,
                    d.name AS job_title,
                    owner.companyId AS company_id
             FROM cvs cv
             LEFT JOIN users u ON u.id = cv.userId
             LEFT JOIN accounts a ON a.userId = u.id
             LEFT JOIN posts p ON p.id = cv.postId
             LEFT JOIN detailposts d ON d.id = p.detailPostId
             LEFT JOIN users owner ON owner.id = p.userId`
        );

        let imported = 0;
        for (const r of rows) {
            // Khong co cong ty thi khong biet xep ho so vao bang Kanban cua ai.
            if (r.company_id === null || r.company_id === undefined) continue;

            const fullName = [r.firstName, r.lastName].filter(Boolean).join(' ') || null;
            // Trang thai cu chi co doc/chua doc, nen anh xa sang hai buoc dau cua pipeline.
            const stage = r.isChecked ? 'dang_xem_xet' : 'moi_ung_tuyen';

            const { rowCount } = await pool.query(
                `INSERT INTO applications
                   (legacy_cv_id, job_id, job_title, candidate_id, candidate_name,
                    candidate_email, candidate_phone, company_id, stage, cover_letter,
                    is_read, applied_at, stage_changed_at, cv_snapshot)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13)
                 ON CONFLICT (legacy_cv_id) DO NOTHING`,
                [
                    r.cv_id, r.job_id, r.job_title, r.candidate_id, fullName,
                    r.email, r.phonenumber, r.company_id, stage, r.description,
                    Boolean(r.isChecked), r.createdAt,
                    // Snapshot: giu lai ho so ung vien dung nhu luc nop.
                    JSON.stringify({
                        fullName, email: r.email, phone: r.phonenumber,
                        source: 'legacy_mysql', importedAt: new Date().toISOString()
                    })
                ]
            );
            if (rowCount) imported += 1;
        }

        logger.info('da dong bo ho so tu he thong cu', { tong: rows.length, moi: imported });
        return { total: rows.length, imported };
    } catch (error) {
        // Khong lam sap service: pipeline van dung duoc voi ho so nop moi.
        logger.error('dong bo that bai', { error: error.message });
        return { total: 0, imported: 0, error: error.message };
    }
};

export const syncEndpoint = async (req, res) => {
    const result = await syncFromLegacy();
    return res.json({ errCode: result.error ? -1 : 0, data: result });
};
