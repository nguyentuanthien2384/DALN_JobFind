/**
 * Sinh cac cau INSERT con thieu de dong bo file database/jobfindtest.sql voi CSDL.
 *
 * Vi sao khong dung mysqldump hay mysql CLI: tren Windows, client dong lenh xuat
 * theo codepage cua console, lam hong tieng Viet ("Tai khoan" thanh "T\x85i kho?n").
 * Doc bang driver rooi tu ghi file UTF-8 thi giu nguyen dau.
 *
 * Cach dung:
 *   node scripts/sync-sql-dump.js <ten_csdl_doi_chieu>
 * Vi du: nap file SQL vao mot CSDL trong ten `jobfind_verify`, roi chay lenh nay
 * de biet CSDL that dang co gi ma file chua co.
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const REFERENCE_DB = process.argv[2] || 'jobfind_verify';

// Bang nao can doi chieu, va cot nao dua vao cau INSERT.
const TABLES = [
    { name: 'users', columns: ['id', 'firstName', 'lastName', 'email', 'address', 'genderCode', 'image', 'dob', 'companyId'], updateOn: 'firstName' },
    { name: 'accounts', columns: ['id', 'phonenumber', 'password', 'roleCode', 'statusCode', 'userId', 'createdAt', 'updatedAt'], updateOn: 'phonenumber' },
    { name: 'chatmessages', columns: ['id', 'senderId', 'receiverId', 'content', 'isRead', 'createdAt', 'updatedAt'], updateOn: 'content' },
    { name: 'favoriteposts', columns: ['id', 'userId', 'postId', 'createdAt', 'updatedAt'], updateOn: 'postId' },
    { name: 'followcompanies', columns: ['id', 'userId', 'companyId', 'createdAt', 'updatedAt'], updateOn: 'companyId' },
    { name: 'notifications', columns: ['id', 'userId', 'typeCode', 'isChecked', 'content', 'link', 'createdAt', 'updatedAt'], updateOn: 'content' },
    { name: 'companyreviews', columns: ['id', 'userId', 'companyId', 'star', 'content', 'createdAt', 'updatedAt'], updateOn: 'content' },
    { name: 'notes', columns: ['id', 'note', 'postId', 'userId', 'createdAt', 'updatedAt'], updateOn: 'note' }
];

const quote = (value) => {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (value instanceof Date) {
        // Dinh dang datetime cua MySQL, giu gio dia phuong nhu khi doc ra.
        const pad = (n) => String(n).padStart(2, '0');
        return `'${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
            `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}'`;
    }
    if (Buffer.isBuffer(value)) value = value.toString('utf8');
    return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
};

const run = async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3333),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'jobfindtest',
        charset: 'utf8mb4'
    });

    const blocks = [];
    for (const table of TABLES) {
        const [rows] = await conn.query(
            `SELECT ${table.columns.map((c) => `\`${c}\``).join(', ')} FROM \`${table.name}\`
             WHERE id NOT IN (SELECT id FROM \`${REFERENCE_DB}\`.\`${table.name}\`) ORDER BY id`
        );
        if (!rows.length) continue;

        const lines = rows.map((row) => {
            const values = table.columns.map((c) => quote(row[c])).join(', ');
            return `INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${values}) ` +
                `ON DUPLICATE KEY UPDATE ${table.updateOn} = VALUES(${table.updateOn});`;
        });
        blocks.push({ table: table.name, count: rows.length, sql: lines.join('\n') });
        console.log(`${table.name}: ${rows.length} bản ghi cần bổ sung`);
    }

    await conn.end();

    if (!blocks.length) {
        console.log('File SQL đã khớp với CSDL, không cần bổ sung gì.');
        return;
    }

    const out = path.join(__dirname, '..', '..', 'database', 'sync-append.sql');
    fs.writeFileSync(out,
        blocks.map((b) => `-- ${b.table} (${b.count} bản ghi)\n${b.sql}`).join('\n\n') + '\n',
        'utf8');
    console.log(`\nĐã ghi ${out}`);
};

run().catch((error) => {
    console.error('Lỗi:', error.message);
    process.exitCode = 1;
});
