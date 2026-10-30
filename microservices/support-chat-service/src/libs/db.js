import mysql from 'mysql2/promise';
import { resolveMysqlServiceCredentials } from '../../../shared/dbProvisioning.js';

const credentials = resolveMysqlServiceCredentials(process.env, 'support');

export const pool = mysql.createPool({
    ...credentials,
    waitForConnections: true,
    connectionLimit: Number(process.env.SUPPORT_DB_POOL_SIZE || 5),
    charset: 'utf8mb4_general_ci',
    timezone: '+07:00'
});
