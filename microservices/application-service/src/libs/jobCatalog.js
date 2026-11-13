import mysql from 'mysql2/promise';
import { createLogger } from '../../../shared/logger.js';
import { resolveMysqlServiceCredentials } from '../../../shared/dbProvisioning.js';
import { domainLabelOf, normalizeDomainCode } from '../../../shared/assessmentTemplates.js';

const logger = createLogger('application-service');

let mysqlPool = null;
const ensurePool = () => {
    if (mysqlPool) return mysqlPool;
    mysqlPool = mysql.createPool({
        ...resolveMysqlServiceCredentials(process.env, 'application'),
        waitForConnections: true,
        connectionLimit: 5,
        charset: 'utf8mb4_general_ci'
    });
    return mysqlPool;
};

export const closeJobCatalogPool = async () => {
    if (!mysqlPool) return;
    const target = mysqlPool;
    mysqlPool = null;
    await target.end();
};

export const getJobDomainContext = async (jobId) => {
    const id = Number(jobId);
    if (!Number.isSafeInteger(id) || id < 1) return null;
    try {
        const db = ensurePool();
        const [rows] = await db.query(
            `SELECT p.id AS jobId, d.name AS jobTitle, d.categoryJobCode, d.descriptionHTML, u.companyId
             FROM posts p
             JOIN detailposts d ON d.id = p.detailPostId
             LEFT JOIN users u ON u.id = p.userId
             WHERE p.id = ? LIMIT 1`,
            [id]
        );
        const row = rows?.[0];
        if (!row) return null;
        const domainCode = normalizeDomainCode(row.categoryJobCode || '');
        return {
            jobId: Number(row.jobId),
            jobTitle: row.jobTitle || null,
            companyId: row.companyId !== null && row.companyId !== undefined ? Number(row.companyId) : null,
            categoryJobCode: domainCode || null,
            domainCode: domainCode || null,
            domainLabel: domainCode ? domainLabelOf(domainCode) : null,
            descriptionHTML: row.descriptionHTML || ''
        };
    } catch (error) {
        logger.warn('khong doc duoc thong tin nganh cua tin tuyen dung tu MySQL', { jobId: id, error: error.message });
        return null;
    }
};
