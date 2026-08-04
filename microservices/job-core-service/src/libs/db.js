import mysql from 'mysql2/promise';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('job-core-service');

// Dung lai dung CSDL MySQL cua he thong hien tai thay vi dung mot CSDL moi:
// du lieu tin tuyen dung, goi cuoc va giao dich da nam o day, va MySQL bao dam
// ACID cho cac giao dich mua goi - dung nhu vai tro cua ben Ghi trong CQRS.

export const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'host.docker.internal',
    port: Number(process.env.MYSQL_PORT || 3333),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'jobfindtest',
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4_general_ci',
    timezone: '+07:00'
});

export const testConnection = async () => {
    const conn = await pool.getConnection();
    try {
        await conn.ping();
        logger.info('da ket noi MySQL', {
            host: process.env.MYSQL_HOST,
            database: process.env.MYSQL_DATABASE
        });
    } finally {
        conn.release();
    }
};

// Chay nhieu cau lenh trong mot giao dich. Tao tin tuyen dung cham vao hai bang
// (detailposts va posts) nen phai hoac thanh cong ca hai, hoac khong gi ca -
// neu khong se con lai ban ghi mo coi.
export const withTransaction = async (work) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await work(conn);
        await conn.commit();
        return result;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
};
