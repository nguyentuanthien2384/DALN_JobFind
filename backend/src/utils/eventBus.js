import amqplib from 'amqplib';
import db from '../models/index';
import { prepareDomainEvent } from './eventContract';
require('dotenv').config();

/**
 * Phat su kien tu backend cu sang he thong microservice.
 *
 * Vi sao can: frontend van dang tin va nop CV qua cac API cu o day. Neu backend
 * nay khong bao gi ca, Search Service se khong bao gio biet co tin moi (nguoi dung
 * tim khong ra tin vua dang), va Application Service khong biet co ho so moi
 * (nha tuyen dung khong thay ho so tren bang Kanban). Ca hai da tung xay ra that.
 *
 * Nguyen tac: RabbitMQ chet KHONG duoc lam chet API. Moi loi o day chi ghi log
 * roi di tiep - nguoi dung van dang tin duoc, chi la cac service khac cham biet
 * hon. Dong bo lai bang cach goi /internal/reindex hoac /internal/sync.
 */

const EXCHANGE = 'jobportal.events';

let connection = null;
let channel = null;
let connecting = null;
let disabled = false;

const log = (msg, extra = '') => console.log(`[eventBus] ${msg}`, extra);

const getChannel = async () => {
    if (disabled) return null;
    if (channel) return channel;
    if (connecting) return connecting;

    connecting = (async () => {
        try {
            const url = process.env.RABBITMQ_URL;
            if (!url) {
                // Chua cau hinh thi tat han, khong thu lai moi request.
                disabled = true;
                log('chua dat RABBITMQ_URL, bo qua viec phat su kien');
                return null;
            }
            connection = await amqplib.connect(url);
            connection.on('error', (err) => log('loi ket noi', err.message));
            connection.on('close', () => {
                connection = null;
                channel = null;
                connecting = null;
            });
            channel = await connection.createChannel();
            await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
            log('da ket noi RabbitMQ');
            connecting = null;
            return channel;
        } catch (error) {
            log('khong ket noi duoc RabbitMQ', error.message);
            connection = null;
            channel = null;
            connecting = null;
            return null;
        }
    })();

    return connecting;
};

const publish = async (routingKey, payload) => {
    try {
        const event = prepareDomainEvent(routingKey, payload);
        const ch = await getChannel();
        if (!ch) return;
        ch.publish(EXCHANGE, routingKey, event.body, event.properties);
        log(`da phat ${routingKey}`);
    } catch (error) {
        log(`phat ${routingKey} that bai`, error.message);
    }
};

/**
 * Doc mot tin tuyen dung day du theo dung hinh dang ma Search Service mong doi.
 *
 * Phai trung hinh dang voi cai job-core-service phat ra, neu khong Search Service
 * se dung index thieu truong: tin hien ra nhung loc theo nganh nghe/tinh thanh
 * lai khong thay.
 */
const loadJob = async (postId) => {
    const [rows] = await db.sequelize.query(
        `SELECT p.id, p.statusCode, p.timePost, p.timeEnd, p.isHot, p.userId,
                d.name, d.descriptionHTML, d.descriptionMarkdown, d.amount,
                d.categoryJobCode, d.addressCode, d.salaryJobCode,
                d.categoryJoblevelCode, d.categoryWorktypeCode,
                d.experienceJobCode, d.genderPostCode,
                u.companyId,
                c.name AS companyName, c.thumbnail AS companyLogo,
                c.statusCode AS companyStatusCode,
                c.censorCode AS companyCensorCode
         FROM posts p
         JOIN detailposts d ON d.id = p.detailPostId
         LEFT JOIN users u ON u.id = p.userId
         LEFT JOIN companies c ON c.id = u.companyId
         WHERE p.id = :postId`,
        { replacements: { postId }, type: db.sequelize.QueryTypes.SELECT }
    );
    // Sequelize tra ve mang phang voi SELECT, lay phan tu dau.
    return Array.isArray(rows) ? rows[0] : rows;
};

/** Tin tuyen dung vua duoc tao. */
export const emitJobCreated = async (postId) => {
    try {
        const job = await loadJob(postId);
        if (!job) return;
        await publish('job.created', { job });
    } catch (error) {
        log('khong tai duoc tin de phat job.created', error.message);
    }
};

/**
 * Tin tuyen dung thay doi - dung ca khi sua noi dung lan khi doi trang thai
 * (duyet, tu choi, an tin). Doi trang thai la truong hop quan trong nhat: tin
 * bi tu choi phai bien khoi ket qua tim kiem ngay lap tuc.
 */
export const emitJobUpdated = async (postId) => {
    try {
        const job = await loadJob(postId);
        if (!job) return;
        await publish('job.updated', { job });
    } catch (error) {
        log('khong tai duoc tin de phat job.updated', error.message);
    }
};

/**
 * Trang thai cong ty la mot phan cua dieu kien cong khai tin. Phat su kien nay
 * de Search Service an/hien ngay cac tin da lap chi muc cua cong ty, khong cho
 * toi dot doi chieu dinh ky.
 */
export const emitCompanyUpdated = async (companyId) => {
    try {
        const [rows] = await db.sequelize.query(
            `SELECT id AS companyId, statusCode AS companyStatusCode,
                    censorCode AS companyCensorCode
               FROM companies WHERE id = :companyId`,
            { replacements: { companyId }, type: db.sequelize.QueryTypes.SELECT }
        );
        const company = Array.isArray(rows) ? rows[0] : rows;
        if (!company) return;
        await publish('company.updated', company);
    } catch (error) {
        log('khong tai duoc cong ty de phat company.updated', error.message);
    }
};

/** Ung vien vua nop CV. */
export const emitApplicationSubmitted = async (cvId) => {
    try {
        const [rows] = await db.sequelize.query(
            `SELECT cv.id AS cvId, cv.userId AS candidateId, cv.postId AS jobId,
                cv.description, cv.createdAt,
                u.firstName, u.lastName, u.email,
                a.phonenumber,
                d.name AS jobTitle,
                owner.companyId AS companyId,
                -- Nguoi dang tin: de Notification Service biet bao cho ai.
                p.userId AS posterId
         FROM cvs cv
         LEFT JOIN users u ON u.id = cv.userId
         LEFT JOIN accounts a ON a.userId = u.id
         LEFT JOIN posts p ON p.id = cv.postId
         LEFT JOIN detailposts d ON d.id = p.detailPostId
         LEFT JOIN users owner ON owner.id = p.userId
         WHERE cv.id = :cvId`,
            { replacements: { cvId }, type: db.sequelize.QueryTypes.SELECT }
        );
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (!row || row.companyId === null || row.companyId === undefined) return;

        await publish('application.submitted', {
            cvId: row.cvId,
            jobId: row.jobId,
            jobTitle: row.jobTitle,
            candidateId: row.candidateId,
            candidateName: [row.firstName, row.lastName].filter(Boolean).join(' ') || null,
            candidateEmail: row.email,
            candidatePhone: row.phonenumber,
            companyId: row.companyId,
            posterId: row.posterId,
            coverLetter: row.description,
            appliedAt: row.createdAt
        });
    } catch (error) {
        log('khong tai duoc CV de phat application.submitted', error.message);
    }
};

export default {
    emitJobCreated,
    emitJobUpdated,
    emitCompanyUpdated,
    emitApplicationSubmitted
};
