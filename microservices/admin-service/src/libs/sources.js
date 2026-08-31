import mysql from 'mysql2/promise';
import pg from 'pg';
import { createLogger } from '../../../shared/logger.js';
import { requireEnvironment } from '../../../shared/securityConfig.js';

const logger = createLogger('admin-service');

// Service bao cao doc du lieu tu CSDL cua cac service khac, o che do CHI DOC.
//
// Day la ngoai le co chu dich so voi nguyen tac "moi service mot CSDL rieng":
// bao cao can noi so lieu tu nhieu noi (tin tuyen dung o MySQL, ho so ung tuyen o
// PostgreSQL) va tra loi cac cau hoi khong doan truoc duoc. Neu bat moi so lieu
// phai di qua su kien, ta se phai dung san moi bang tong hop cho tung cau hoi -
// va them mot cau hoi moi la phai sua ca he thong.
//
// Doi lai, service nay TUYET DOI khong ghi vao hai CSDL do. Quyen ghi van thuoc
// ve service so huu.

export const mysqlPool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'host.docker.internal',
    port: Number(process.env.MYSQL_PORT || 3333),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'jobfindtest',
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4_general_ci',
    timezone: '+07:00'
});

export const pgPool = new pg.Pool({
    connectionString: requireEnvironment('POSTGRES_URL'),
    max: 5
});

export const testSources = async () => {
    const conn = await mysqlPool.getConnection();
    try {
        await conn.ping();
        logger.info('da ket noi MySQL (chi doc)');
    } finally {
        conn.release();
    }

    try {
        await pgPool.query('SELECT 1');
        logger.info('da ket noi PostgreSQL (chi doc)');
    } catch (error) {
        // Bao cao ve tuyen dung se trong, nhung cac bao cao khac van chay.
        logger.warn('chua ket noi duoc PostgreSQL, bao cao tuyen dung se rong', {
            error: error.message
        });
    }
};
