require('dotenv').config();

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

/**
 * Tạo/cập nhật 3 tài khoản TEST với mật khẩu đã biết = "123456".
 *
 *  SĐT (đăng nhập)   | Vai trò    | Mật khẩu | userId
 *  ------------------|-----------|----------|-------
 *  0900000001        | ADMIN     | 123456   | 9001
 *  0900000002        | COMPANY   | 123456   | 9002
 *  0900000003        | CANDIDATE | 123456   | 9003
 *
 * Ba tài khoản này dùng user/account id riêng (9001-9003) nên KHÔNG đụng vào bất
 * kỳ bản ghi nào của dữ liệu demo gốc. Bảng `accounts` có unique index trên cả
 * `phonenumber` lẫn `userId`: nếu trỏ test account vào userId của demo (1, 2, 5)
 * thì câu ON DUPLICATE KEY sẽ khớp unique `userId` và ghi đè mật khẩu của tài
 * khoản demo thay vì tạo tài khoản mới — đó là lý do phải cấp userId riêng.
 *
 * Tài khoản COMPANY được gán companyId = 6 (Công ty TNHH CMC GLOBAL) để trang
 * quản trị nhà tuyển dụng có sẵn tin tuyển dụng/CV mẫu để demo.
 *
 * Chạy sau khi đã có dữ liệu mẫu (import SQL hoặc db:seed:all):
 *   npm run seed:test-accounts
 */
const TEST_COMPANY_ID = 6;

const TEST_ACCOUNTS = [
    {
        id: 9001, phonenumber: '0900000001', roleCode: 'ADMIN', userId: 9001,
        firstName: 'Tài khoản', lastName: 'Quản trị', companyId: null
    },
    {
        id: 9002, phonenumber: '0900000002', roleCode: 'COMPANY', userId: 9002,
        firstName: 'Tài khoản', lastName: 'Nhà tuyển dụng', companyId: TEST_COMPANY_ID
    },
    {
        id: 9003, phonenumber: '0900000003', roleCode: 'CANDIDATE', userId: 9003,
        firstName: 'Tài khoản', lastName: 'Ứng viên', companyId: null
    }
];

async function createTestAccounts(existingConnection) {
    const databaseName = process.env.DB_NAME || 'jobfindtest';
    const connection = existingConnection || await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: databaseName
    });

    try {
        // `connection` dùng lại từ restore-sample-data.js không gắn sẵn database.
        await connection.query(`USE \`${databaseName}\``);

        const hash = bcrypt.hashSync('123456', 10);
        for (const acc of TEST_ACCOUNTS) {
            // Bảng users không có createdAt/updatedAt (model User đặt timestamps: false).
            await connection.query(
                `INSERT INTO users (id, firstName, lastName, email, address, genderCode, dob, companyId)
                 VALUES (?, ?, ?, ?, 'Việt Nam', 'M', '01/01/2000', ?)
                 ON DUPLICATE KEY UPDATE firstName = VALUES(firstName), lastName = VALUES(lastName),
                     companyId = VALUES(companyId)`,
                [acc.userId, acc.firstName, acc.lastName, `test${acc.userId}@jobfind.local`, acc.companyId]
            );
            await connection.query(
                `INSERT INTO accounts (id, phonenumber, password, roleCode, statusCode, userId, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, 'S1', ?, NOW(), NOW())
                 ON DUPLICATE KEY UPDATE password = VALUES(password), roleCode = VALUES(roleCode),
                     statusCode = 'S1', updatedAt = NOW()`,
                [acc.id, acc.phonenumber, hash, acc.roleCode, acc.userId]
            );
            console.log(`  ✔ Tài khoản ${acc.roleCode.padEnd(9)} — SĐT: ${acc.phonenumber} — Mật khẩu: 123456`);
        }
    } finally {
        if (!existingConnection) await connection.end();
    }
}

module.exports = createTestAccounts;

if (require.main === module) {
    createTestAccounts()
        .then(() => console.log('Đã tạo xong tài khoản test.'))
        .catch(error => {
            console.error(`Tạo tài khoản test thất bại: ${error.message}`);
            process.exitCode = 1;
        });
}
