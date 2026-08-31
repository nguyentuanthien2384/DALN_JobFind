// Chup anh CSDL truoc khi kiem thu, va tra lai nguyen trang sau khi xong.
//
// Vi sao can: bo kiem thu tao tin tuyen dung that, nop CV that, sinh thong bao
// that - tat ca ghi thang vao CSDL that cua du an. Khong don thi moi lan chay
// de lai khoang 16 dong rac, cong voi cac o dem goi dich vu (allowPost,
// allowCvFree) bi tru dan. Hau qua khong chi la CSDL ban: file
// database/jobfindtest.sql se lech them sau moi lan chay, va den luc can dong
// bo lai thi khong con phan biet duoc dau la du lieu that cua nguoi dung, dau
// la vet kiem thu.
//
// Nguyen tac: moi thu bo kiem thu tao ra deu mang tien to TEST_PREFIX, nen
// don sach duoc bang cach doi chieu ten. Rieng cac o dem thi khong the suy ra
// tu ten, nen phai chup lai gia tri truoc khi chay.

import mysql from 'mysql2/promise';
import pg from 'pg';

const { Pool } = pg;

// Moi ban ghi do kiem thu sinh ra deu bat dau bang chuoi nay.
const TEST_PREFIX = 'Kiem Thu ';

const ES = process.env.ELASTICSEARCH_PUBLIC_URL || 'http://localhost:9201';
const PG = process.env.POSTGRES_PUBLIC_URL || 'postgres://jobportal:jobportal@localhost:5435/application_db';
const FIXTURE_LOCK = 'jobfind_microservices_smoke_fixture';
const FIXTURE_LOCK_TIMEOUT_SECONDS = 90;

const mysqlConfig = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3333),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'jobfindtest',
    charset: 'utf8mb4'
};

const quiet = (label) => (error) => {
    // Don dep that bai khong duoc lam hong ket qua kiem thu - bao roi di tiep.
    console.log(`  (khong don duoc ${label}: ${error.message})`);
};

const restoreCompanyQuotas = async (conn, companies = []) => {
    for (const company of companies) {
        await conn.query(
            'UPDATE companies SET allowPost = ?, allowCV = ?, allowCvFree = ? WHERE id = ?',
            [company.allowPost, company.allowCV, company.allowCvFree, company.id]
        );
    }
};

// --- Chup anh truoc khi chay ---
export const snapshot = async () => {
    const conn = await mysql.createConnection(mysqlConfig);
    let keepConnectionForRestore = false;
    let companies = [];
    let quotasBoosted = false;
    try {
        // Hai smoke test chay song song co the chup phai han muc da duoc cong tam
        // cua nhau, sau do hoan nguyen sai +50. MySQL advisory lock duoc giu tren
        // chinh connection nay cho den khi restore() hoan tat.
        const [[lock]] = await conn.query(
            'SELECT GET_LOCK(?, ?) AS acquired',
            [FIXTURE_LOCK, FIXTURE_LOCK_TIMEOUT_SECONDS]
        );
        if (Number(lock?.acquired) !== 1) {
            throw new Error('Không lấy được khóa chạy smoke test độc quyền');
        }

        // O dem goi dich vu: bi tru moi lan dang tin hoac xem CV.
        [companies] = await conn.query(
            'SELECT id, allowPost, allowCV, allowCvFree FROM companies'
        );
        // Cac tac vu AI sinh ra trong luc chay can duoc phan biet voi tac vu cu.
        const [tasks] = await conn.query('SELECT id FROM ai_tasks').catch(() => [[]]);

        // Cap tam han muc de kiem thu dang duoc tin. Neu khong, bo kiem thu se
        // that bai tren nhung du an co o dem da ve 0 - va do khong phai loi he
        // thong, chi la het luot dang trong goi dich vu. restore() se dat lai
        // dung gia tri vua chup o tren.
        await conn.query(
            'UPDATE companies SET allowPost = allowPost + 50, allowCV = allowCV + 50, allowCvFree = allowCvFree + 50'
        );
        quotasBoosted = true;

        keepConnectionForRestore = true;
        return { companies, taskIds: tasks.map((t) => t.id), lockConnection: conn };
    } catch (error) {
        if (quotasBoosted) {
            await restoreCompanyQuotas(conn, companies).catch(quiet('hạn mức công ty'));
        }
        throw error;
    } finally {
        if (!keepConnectionForRestore) {
            await conn.query('SELECT RELEASE_LOCK(?)', [FIXTURE_LOCK]).catch(() => {});
            await conn.end();
        }
    }
};

// --- Tra lai nguyen trang ---
export const restore = async (before) => {
    const conn = before.lockConnection || await mysql.createConnection(mysqlConfig);
    let removed = 0;
    let quotasRestored = false;

    try {
        // Tim cac tin do kiem thu tao. Ten nam o bang detailposts.
        const [posts] = await conn.query(
            `SELECT p.id, p.detailPostId FROM posts p
               JOIN detailposts d ON d.id = p.detailPostId
              WHERE d.name LIKE ?`, [TEST_PREFIX + '%']
        );
        const postIds = posts.map((p) => p.id);
        const detailIds = posts.map((p) => p.detailPostId).filter(Boolean);

        if (postIds.length) {
            // Xoa theo dung thu tu khoa ngoai: con truoc, cha sau.
            const [cvs] = await conn.query('SELECT id FROM cvs WHERE postId IN (?)', [postIds]);
            await conn.query('DELETE FROM cvs WHERE postId IN (?)', [postIds]);
            await conn.query('DELETE FROM notes WHERE postId IN (?)', [postIds]);
            await conn.query('DELETE FROM posts WHERE id IN (?)', [postIds]);
            if (detailIds.length) {
                await conn.query('DELETE FROM detailposts WHERE id IN (?)', [detailIds]);
            }
            removed += cvs.length + postIds.length + detailIds.length;
        }

        // Thong bao sinh ra deu nhac ten tin kiem thu trong noi dung.
        const [notif] = await conn.query(
            'DELETE FROM notifications WHERE content LIKE ?', [`%${TEST_PREFIX}%`]
        );
        removed += notif.affectedRows || 0;

        // Tra lai cac o dem ve dung gia tri truoc khi chay.
        await restoreCompanyQuotas(conn, before.companies);
        quotasRestored = true;

        // Tac vu AI moi phat sinh trong lan chay nay.
        if (before.taskIds.length) {
            await conn.query('DELETE FROM ai_tasks WHERE id NOT IN (?)', [before.taskIds])
                .catch(() => {});
        } else {
            await conn.query('DELETE FROM ai_tasks').catch(() => {});
        }

        // Xoa ho so tuong ung ben PostgreSQL, neu khong bang Kanban se con lai
        // nhung the ung vien tro toi tin da bi xoa.
        await (async () => {
            const pool = new Pool({ connectionString: PG });
            try {
                await pool.query(
                    `DELETE FROM applications WHERE job_title LIKE $1`, [TEST_PREFIX + '%']
                );
            } finally {
                await pool.end();
            }
        })().catch(quiet('PostgreSQL'));

        // Va xoa ban sao trong chi muc tim kiem.
        await fetch(`${ES}/jobs/_delete_by_query?refresh=true`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: { prefix: { 'name.keyword': TEST_PREFIX } } })
        }).catch(quiet('Elasticsearch'));

        console.log(`\nĐã dọn ${removed} bản ghi kiểm thử, trả các ô đếm gói dịch vụ về như cũ.`);
    } finally {
        // Uu tien bao toan han muc ngay ca khi viec don MySQL/PostgreSQL/ES gap
        // loi. Dong connection cung tu dong nha advisory lock neu RELEASE_LOCK
        // khong thanh cong.
        if (!quotasRestored) {
            await restoreCompanyQuotas(conn, before.companies).catch(quiet('hạn mức công ty'));
        }
        if (before.lockConnection) {
            await conn.query('SELECT RELEASE_LOCK(?)', [FIXTURE_LOCK]).catch(() => {});
        }
        await conn.end();
    }
};

export { TEST_PREFIX };
