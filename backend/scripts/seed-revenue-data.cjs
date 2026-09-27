'use strict';

// Historical demo purchases only: never call PayPal or grant live posting/CV quotas.
const mysql = require('mysql2/promise');
const { createHash } = require('node:crypto');
const configs = require('../src/config/config');

const PREFIX = 'demo-revenue-v1-';
const TYPES = {
    POST: { table: 'orderpackages', packageKey: 'packagePostId' },
    CV: { table: 'orderpackagecvs', packageKey: 'packageCvId' }
};

function buildOrders({ years, now, employers, postPackages, cvPackages }) {
    if (!employers.length || !postPackages.length || !cvPackages.length) {
        throw new Error('Cần có nhà tuyển dụng, gói đăng bài và gói xem CV trước khi tạo dữ liệu mẫu.');
    }
    const orders = [];
    for (const year of years) {
        const lastMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12;
        for (let month = 1; month <= lastMonth; month++) {
            const days = year === now.getFullYear() && month === lastMonth
                ? now.getDate() : new Date(year, month, 0).getDate();
            for (const [typeIndex, type] of ['POST', 'CV'].entries()) {
                const packages = type === 'POST' ? postPackages : cvPackages;
                // Seasonal variation, with a gradual increase across years.
                const count = (type === 'POST' ? 20 : 14)
                    + ((month * 7 + typeIndex * 3) % 15) + Math.max(0, year - 2024) * 2;
                for (let index = 0; index < count; index++) {
                    const item = packages[(index + month + year) % packages.length];
                    const employer = employers[(index * 7 + month + typeIndex) % employers.length];
                    const quantity = 1 + ((index + month * 3 + typeIndex) % 5);
                    const unitPrice = Number(Number(item.price).toFixed(2));
                    if (!Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isInteger(Number(item.value)) || Number(item.value) <= 0) {
                        throw new Error('Gói dịch vụ cần có giá và số lượt hợp lệ.');
                    }
                    // Use midnight for the current day, so no demo purchase is in the future.
                    const day = 1 + Math.floor(index * days / count);
                    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 00:00:00`;
                    orders.push({
                        key: `${PREFIX}${type.toLowerCase()}-${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(3, '0')}`,
                        type, packageId: item.id, userId: employer.id, companyId: employer.companyId,
                        quantity, unitPrice, totalPrice: Number((unitPrice * quantity).toFixed(2)),
                        entitlementType: type === 'CV' ? 'ALLOW_CV' : Number(item.isHot) === 1 ? 'ALLOW_HOT_POST' : 'ALLOW_POST',
                        entitlementAmount: Number(item.value) * quantity, date
                    });
                }
            }
        }
    }
    return orders;
}

function parseOptions(args, now) {
    const currentYear = now.getFullYear();
    let years = [currentYear - 2, currentYear - 1, currentYear];
    let dryRun = false;
    for (let index = 0; index < args.length; index++) {
        if (args[index] === '--dry-run') dryRun = true;
        else if (args[index] === '--year') {
            const year = Number(args[++index]);
            if (!Number.isInteger(year) || year < 2020 || year > currentYear) {
                throw new Error(`Năm phải nằm trong khoảng 2020–${currentYear}.`);
            }
            years = [year];
        } else throw new Error('Cách dùng: npm run seed:revenue-data -- [--year YYYY] [--dry-run]');
    }
    return { years, dryRun };
}

async function seedRevenueData(args = process.argv.slice(2)) {
    const now = new Date();
    const { years, dryRun } = parseOptions(args, now);
    const config = configs[process.env.NODE_ENV || 'development'];
    if (process.env.NODE_ENV === 'production' || !config || !['localhost', '127.0.0.1', '::1'].includes(config.host)) {
        throw new Error('Lệnh tạo doanh thu mẫu chỉ dành cho cơ sở dữ liệu phát triển trên máy local.');
    }
    const connection = await mysql.createConnection({
        host: config.host, port: config.port, user: config.username,
        password: config.password, database: config.database, connectTimeout: 10000
    });
    const lockName = 'demo-revenue-' + createHash('sha256').update(config.database).digest('hex').slice(0, 40);
    let locked = false;
    let inTransaction = false;
    try {
        const [[lock]] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
        if (Number(lock.acquired) !== 1) throw new Error('Một lần tạo dữ liệu mẫu khác đang chạy.');
        locked = true;
        const [employers] = await connection.query(`SELECT u.id, u.companyId FROM users u
            JOIN accounts a ON a.userId = u.id JOIN companies c ON c.id = u.companyId
            WHERE a.roleCode = 'COMPANY' ORDER BY u.id`);
        const [postPackages] = await connection.query('SELECT id, price, value, isHot FROM packageposts WHERE isActive = 1 AND price > 0 ORDER BY id');
        const [cvPackages] = await connection.query('SELECT id, price, value FROM packagecvs WHERE isActive = 1 AND price > 0 ORDER BY id');
        const orders = buildOrders({ years, now, employers, postPackages, cvPackages });
        const [existing] = await connection.query('SELECT providerPaymentId, provider FROM paymentintents WHERE providerPaymentId LIKE ?', [`${PREFIX}%`]);
        if (existing.some(item => item.provider !== 'DEMO')) throw new Error('Mã dữ liệu mẫu bị trùng với giao dịch khác.');
        const existingKeys = new Set(existing.map(item => item.providerPaymentId));
        const pending = orders.filter(item => !existingKeys.has(item.key));
        if (!dryRun) {
            await connection.beginTransaction();
            inTransaction = true;
            for (const order of pending) {
                const [intent] = await connection.query(`INSERT INTO paymentintents
                    (provider, providerPaymentId, providerToken, userId, companyId, packageType, packageId,
                     quantity, unitPrice, totalPrice, currency, entitlementType, entitlementAmount,
                     status, expiresAt, completedAt, createdAt, updatedAt)
                    VALUES ('DEMO', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, 'COMPLETED', ?, ?, ?, ?)`,
                [order.key, `${order.key}-token`, order.userId, order.companyId, order.type, order.packageId,
                    order.quantity, order.unitPrice, order.totalPrice, order.entitlementType, order.entitlementAmount,
                    order.date, order.date, order.date, order.date]);
                const { table, packageKey } = TYPES[order.type];
                await connection.query(`INSERT INTO ${table}
                    (${packageKey}, userId, currentPrice, amount, paymentIntentId, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [order.packageId, order.userId, order.unitPrice, order.quantity, intent.insertId, order.date, order.date]);
            }
            await connection.commit();
            inTransaction = false;
        }
        const summary = { database: config.database, dryRun, years,
            through: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
            inserted: dryRun ? 0 : pending.length, wouldInsert: pending.length,
            alreadyPresent: orders.length - pending.length,
            postOrders: orders.filter(order => order.type === 'POST').length,
            cvOrders: orders.filter(order => order.type === 'CV').length };
        console.log(JSON.stringify(summary, null, 2));
        return summary;
    } catch (error) {
        if (inTransaction) await connection.rollback();
        throw error;
    } finally {
        if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
        await connection.end();
    }
}

if (require.main === module) {
    seedRevenueData().catch(error => {
        // SQL driver errors can contain credentials/queries; report only their code.
        console.error('Không tạo được dữ liệu doanh thu mẫu:', error.code || error.message);
        process.exitCode = 1;
    });
}

module.exports = { buildOrders, parseOptions, seedRevenueData };
