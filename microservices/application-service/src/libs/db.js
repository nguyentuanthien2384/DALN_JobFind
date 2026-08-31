import pg from 'pg';
import { createLogger } from '../../../shared/logger.js';
import { requireEnvironment } from '../../../shared/securityConfig.js';

const logger = createLogger('application-service');

export const pool = new pg.Pool({
    connectionString: requireEnvironment('POSTGRES_URL'),
    max: 10,
    idleTimeoutMillis: 30000
});

// Cac buoc trong quy trinh tuyen dung. Thu tu o day chinh la thu tu cot tren bang Kanban.
export const STAGES = ['moi_ung_tuyen', 'dang_xem_xet', 'phong_van', 'de_nghi', 'nhan_viec', 'tu_choi'];

export const STAGE_LABELS = {
    moi_ung_tuyen: 'Mới ứng tuyển',
    dang_xem_xet: 'Đang xem xét',
    phong_van: 'Phỏng vấn',
    de_nghi: 'Đề nghị nhận việc',
    nhan_viec: 'Đã nhận việc',
    tu_choi: 'Từ chối'
};

export const initSchema = async () => {
    // cv_snapshot giu ban sao ho so tai thoi diem ung vien bam nop.
    //
    // Neu chi luu khoa ngoai roi doc nguoc ve ho so goc, thi ung vien sua CV mot
    // thang sau se lam thay doi ca nhung ho so da nop tu truoc - nha tuyen dung
    // xem lai se thay mot noi dung khac han cai ho da doc va da danh gia. Snapshot
    // giu dung cai da nop, va bien ban tuyen dung nho vay moi doi chieu duoc.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS applications (
            id              BIGSERIAL PRIMARY KEY,
            legacy_cv_id    INTEGER UNIQUE,
            job_id          INTEGER NOT NULL,
            job_title       TEXT,
            candidate_id    INTEGER NOT NULL,
            candidate_name  TEXT,
            candidate_email TEXT,
            candidate_phone TEXT,
            company_id      INTEGER NOT NULL,
            stage           TEXT NOT NULL DEFAULT 'moi_ung_tuyen',
            rating          SMALLINT CHECK (rating BETWEEN 1 AND 5),
            match_score     SMALLINT,
            cover_letter    TEXT,
            cv_snapshot     JSONB,
            is_read         BOOLEAN NOT NULL DEFAULT FALSE,
            applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // Loc theo cong ty la truy van chay nhieu nhat (moi lan mo bang Kanban), nen
    // danh index theo company + stage.
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_company_stage ON applications (company_id, stage)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_job ON applications (job_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_candidate ON applications (candidate_id)`);

    // Lich su chuyen trang thai: ai chuyen, tu dau sang dau, luc nao.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS application_events (
            id             BIGSERIAL PRIMARY KEY,
            application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
            from_stage     TEXT,
            to_stage       TEXT NOT NULL,
            actor_id       INTEGER,
            reason         TEXT,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_events ON application_events (application_id, created_at DESC)`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS application_notes (
            id             BIGSERIAL PRIMARY KEY,
            application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
            author_id      INTEGER NOT NULL,
            body           TEXT NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_notes ON application_notes (application_id, created_at DESC)`);

    // Kho ung vien: nha tuyen dung luu lai nguoi hay nhung chua hop vi tri nay,
    // de con tim lai khi mo vi tri khac.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS talent_pool (
            id             BIGSERIAL PRIMARY KEY,
            company_id     INTEGER NOT NULL,
            candidate_id   INTEGER NOT NULL,
            candidate_name TEXT,
            saved_by       INTEGER,
            tags           TEXT[],
            note           TEXT,
            saved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (company_id, candidate_id)
        )
    `);

    logger.info('da khoi tao lo do PostgreSQL');
};

export const withTransaction = async (work) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const testConnection = async () => {
    const { rows } = await pool.query('SELECT version()');
    logger.info('da ket noi PostgreSQL', { version: rows[0].version.split(',')[0] });
};
