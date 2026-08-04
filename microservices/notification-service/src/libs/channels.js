import mysql from 'mysql2/promise';
import nodemailer from 'nodemailer';
import axios from 'axios';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('notification-service');

// Ba kenh gui thong bao. Moi kenh tu chiu trach nhiem loi cua minh: mot kenh
// hong khong duoc keo hai kenh con lai chet theo. Nguoi dung tha nhan thong bao
// trong chuong ma khong co email, con hon khong nhan duoc gi.

// ===== KENH 1: LUU VAO CSDL =====
// Ghi thang vao bang `notifications` dang co cua he thong cu. Nho vay chuong
// thong bao tren giao dien hoat dong ngay, khong phai sua mot dong frontend nao.
const mysqlPool = mysql.createPool({
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

export const saveNotification = async ({ userId, typeCode, content, link }) => {
    const now = new Date();
    const [result] = await mysqlPool.query(
        `INSERT INTO notifications (userId, typeCode, isChecked, content, link, createdAt, updatedAt)
         VALUES (?, ?, 0, ?, ?, ?, ?)`,
        [userId, typeCode, String(content).slice(0, 500), link || null, now, now]
    );
    return { id: result.insertId, userId, typeCode, content, link, isChecked: 0, createdAt: now };
};

// Tim email cua nguoi dung de gui thu.
export const getUserEmail = async (userId) => {
    const [rows] = await mysqlPool.query('SELECT email, firstName, lastName FROM users WHERE id = ?', [userId]);
    if (!rows.length) return null;
    return {
        email: rows[0].email,
        name: [rows[0].firstName, rows[0].lastName].filter(Boolean).join(' ')
    };
};

// Tim nhung nguoi dang theo doi mot cong ty - de bao khi cong ty dang tin moi.
export const getCompanyFollowers = async (companyId) => {
    const [rows] = await mysqlPool.query(
        'SELECT userId FROM followcompanies WHERE companyId = ?', [companyId]
    );
    return rows.map((r) => r.userId);
};

// ===== KENH 2: EMAIL =====
const emailConfigured = () => {
    const user = process.env.EMAIL_APP;
    return Boolean(user) && !user.includes('youremail');
};

let transporter = null;
const getTransporter = () => {
    if (transporter) return transporter;
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_APP, pass: process.env.EMAIL_APP_PASSWORD }
    });
    return transporter;
};

export const sendEmail = async ({ to, subject, html }) => {
    if (!emailConfigured()) {
        logger.debug('bo qua gui email vi chua cau hinh EMAIL_APP', { to, subject });
        return { skipped: true };
    }
    if (!to) return { skipped: true };

    try {
        await getTransporter().sendMail({
            from: process.env.EMAIL_APP,
            to,
            subject,
            html
        });
        logger.info('da gui email', { to, subject });
        return { sent: true };
    } catch (error) {
        // Email hong khong duoc lam hong ca luong: thong bao trong chuong da luu roi.
        logger.warn('gui email that bai', { to, error: error.message });
        return { error: error.message };
    }
};

// ===== KENH 3: REALTIME QUA SOCKET.IO =====
// Backend cu dang giu ket noi Socket.IO voi trinh duyet, nen thay vi dung them
// mot may chu socket thu hai (buoc frontend phai mo hai ket noi), service nay
// nho backend cu day ho qua mot endpoint noi bo.
export const pushRealtime = async ({ userId, notification }) => {
    const url = process.env.LEGACY_URL || 'http://host.docker.internal:5000';
    const secret = process.env.INTERNAL_SECRET;
    if (!secret) {
        logger.debug('bo qua day realtime vi chua dat INTERNAL_SECRET');
        return { skipped: true };
    }

    try {
        await axios.post(
            `${url}/internal/emit-notification`,
            { userId, notification },
            { headers: { 'x-internal-secret': secret }, timeout: 5000 }
        );
        return { sent: true };
    } catch (error) {
        logger.warn('day realtime that bai', { userId, error: error.message });
        return { error: error.message };
    }
};

export const testMysql = async () => {
    const conn = await mysqlPool.getConnection();
    try {
        await conn.ping();
        logger.info('da ket noi MySQL', { database: process.env.MYSQL_DATABASE });
    } finally {
        conn.release();
    }
};

export const isEmailConfigured = emailConfigured;
