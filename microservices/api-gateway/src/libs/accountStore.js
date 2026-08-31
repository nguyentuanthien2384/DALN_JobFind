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

export const resolveCurrentIdentity = async (userId) => {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return null;

    const [rows] = await pool.query(
        `SELECT u.id, u.companyId, a.roleCode, a.statusCode
         FROM users u
         INNER JOIN accounts a ON a.userId = u.id
         WHERE u.id = ?
         LIMIT 1`,
        [id]
    );
    if (!rows.length) return null;

    const account = rows[0];
    return {
        id: Number(account.id),
        roleCode: account.roleCode || null,
        companyId: account.companyId === null || account.companyId === undefined
            ? null
            : Number(account.companyId),
        statusCode: account.statusCode || null
    };
};

export const closeAccountStore = async () => {
    await pool.end();
};

