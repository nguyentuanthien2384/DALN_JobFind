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
const RESERVED_EXAMPLE_DOMAINS = new Set(['example.com', 'example.net', 'example.org']);
const PLACEHOLDER_DOMAIN_SUFFIXES = ['.example', '.invalid', '.test', '.local', '.localhost'];

export const EMAIL_SKIP_REASONS = Object.freeze({
    NOT_CONFIGURED: 'email_not_configured',
    INVALID_RECIPIENT: 'invalid_recipient',
    PLACEHOLDER_IN_PRODUCTION: 'placeholder_recipient_in_production',
    NO_SAFE_DEMO_RECIPIENT: 'no_safe_demo_recipient'
});

export const normalizeEmailRecipient = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

export const isValidEmailRecipient = (value) => {
    const email = normalizeEmailRecipient(value);
    if (!email || email.length > 254) return false;

    const parts = email.split('@');
    if (parts.length !== 2) return false;

    const [localPart, domain] = parts;
    if (
        !localPart || localPart.length > 64
        || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')
        || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)
    ) return false;

    const labels = domain.split('.');
    if (domain.length > 253 || labels.length < 2) return false;
    return labels.every((label) => (
        label.length > 0
        && label.length <= 63
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    ));
};

export const isPlaceholderEmailRecipient = (value) => {
    const email = normalizeEmailRecipient(value);
    if (!isValidEmailRecipient(email)) return false;
    if (email === 'example@gmail.com') return true;

    const domain = email.slice(email.lastIndexOf('@') + 1);
    if ([...RESERVED_EXAMPLE_DOMAINS].some(
        (reserved) => domain === reserved || domain.endsWith(`.${reserved}`)
    )) return true;

    return PLACEHOLDER_DOMAIN_SUFFIXES.some((suffix) => domain.endsWith(suffix));
};

const isSafeEmailRecipient = (value) => (
    isValidEmailRecipient(value)
    && !isPlaceholderEmailRecipient(value)
    && !normalizeEmailRecipient(value).includes('youremail')
);

const emailConfigured = () => {
    return isSafeEmailRecipient(process.env.EMAIL_APP);
};

export const resolveEmailRecipient = (value) => {
    const recipient = normalizeEmailRecipient(value);
    if (!isValidEmailRecipient(recipient)) {
        return { skipped: true, reason: EMAIL_SKIP_REASONS.INVALID_RECIPIENT };
    }

    if (!isPlaceholderEmailRecipient(recipient)) return { to: recipient, demo: false };

    if (process.env.NODE_ENV === 'production') {
        return { skipped: true, reason: EMAIL_SKIP_REASONS.PLACEHOLDER_IN_PRODUCTION };
    }

    const demoRecipient = [process.env.EMAIL_DEMO_RECIPIENT, process.env.EMAIL_APP]
        .map(normalizeEmailRecipient)
        .find(isSafeEmailRecipient);
    if (!demoRecipient) {
        return { skipped: true, reason: EMAIL_SKIP_REASONS.NO_SAFE_DEMO_RECIPIENT };
    }

    return { to: demoRecipient, demo: true, originalTo: recipient };
};

let transporter = null;
const getTransporter = () => {
    if (transporter) return transporter;
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: normalizeEmailRecipient(process.env.EMAIL_APP), pass: process.env.EMAIL_APP_PASSWORD }
    });
    return transporter;
};

export const sendEmail = async ({ to, subject, html }) => {
    const recipient = resolveEmailRecipient(to);
    if (recipient.skipped) {
        logger.warn('bo qua gui email vi dia chi nhan khong an toan', {
            to: normalizeEmailRecipient(to), subject, reason: recipient.reason
        });
        return recipient;
    }
    if (!emailConfigured()) {
        logger.debug('bo qua gui email vi chua cau hinh EMAIL_APP', { to: recipient.to, subject });
        return { skipped: true, reason: EMAIL_SKIP_REASONS.NOT_CONFIGURED };
    }

    const outgoingSubject = recipient.demo ? `[DEMO] ${subject ?? ''}` : subject;

    try {
        await getTransporter().sendMail({
            from: normalizeEmailRecipient(process.env.EMAIL_APP),
            to: recipient.to,
            subject: outgoingSubject,
            html
        });
        logger.info('da gui email', {
            to: recipient.to,
            subject: outgoingSubject,
            demo: recipient.demo,
            originalTo: recipient.originalTo
        });
        return { sent: true };
    } catch (error) {
        // Email hong khong duoc lam hong ca luong: thong bao trong chuong da luu roi.
        logger.warn('gui email that bai', { to: recipient.to, error: error.message });
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
