import mysql from 'mysql2/promise';

// JWT chi dung de chung minh userId. Role, company va trang thai luon doc lai
// tu MySQL, vi token co han 3 ngay trong khi tai khoan co the bi khoa/chuyen cong
// ty ngay lap tuc.
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'host.docker.internal',
    port: Number(process.env.MYSQL_PORT || 3333),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'jobfindtest',
    waitForConnections: true,
    connectionLimit: Number(process.env.AUTH_DB_POOL_SIZE || 5),
    charset: 'utf8mb4_general_ci'
});

export const resolveCurrentIdentity = async (userId, sessionId = null) => {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (sessionId !== null && (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId))) return null;
    const sessionCondition = sessionId ? `AND EXISTS (
             SELECT 1 FROM AuthSessions s
             WHERE s.familyId = ? AND s.userId = u.id AND s.revokedAt IS NULL
               AND s.rotatedAt IS NULL AND s.expiresAt > NOW()
         )` : '';

    const [rows] = await pool.query(
        `SELECT u.id, u.companyId, a.roleCode, a.statusCode,
                c.statusCode AS companyStatusCode,
                c.censorCode AS companyCensorCode
         FROM users u
         INNER JOIN accounts a ON a.userId = u.id
         LEFT JOIN companies c ON c.id = u.companyId
         WHERE u.id = ? ${sessionCondition}
         LIMIT 1`,
        sessionId ? [id, sessionId] : [id]
    );
    if (!rows.length) return null;

    const account = rows[0];
    return {
        id: Number(account.id),
        roleCode: account.roleCode || null,
        companyId: account.companyId === null || account.companyId === undefined
            ? null
            : Number(account.companyId),
        statusCode: account.statusCode || null,
        companyStatusCode: account.companyStatusCode || null,
        companyCensorCode: account.companyCensorCode || null
    };
};

export const closeAccountStore = async () => {
    await pool.end();
};
export const checkAccountStore = () => pool.query('SELECT 1');
