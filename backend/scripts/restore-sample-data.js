require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const databaseName = process.env.DB_NAME || 'jobfindtest';
const sqlPath = path.resolve(__dirname, '../../database/jobfindtest.sql');

async function restoreSampleData() {
    if (process.env.CONFIRM_RESTORE_SAMPLE_DATA !== 'true') {
        throw new Error(
            'Thao tác này sẽ xóa database hiện có. Hãy đặt CONFIRM_RESTORE_SAMPLE_DATA=true để xác nhận.'
        );
    }

    if (!fs.existsSync(sqlPath)) {
        throw new Error(`Không tìm thấy file dữ liệu mẫu: ${sqlPath}`);
    }

    const sql = fs.readFileSync(sqlPath, 'utf8');
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        multipleStatements: true
    });

    try {
        await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
        await connection.query(
            `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        await connection.query(`USE \`${databaseName}\``);
        await connection.query(sql);
        console.log(`Đã khôi phục dữ liệu mẫu vào database \`${databaseName}\`.`);
        console.log('Đang tạo tài khoản test (mật khẩu 123456)...');
        const createTestAccounts = require('./create-test-accounts');
        await createTestAccounts(connection);
    } finally {
        await connection.end();
    }
}

restoreSampleData().catch(error => {
    console.error(`Khôi phục dữ liệu thất bại: ${error.message}`);
    process.exitCode = 1;
});
