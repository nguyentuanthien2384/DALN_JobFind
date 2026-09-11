import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const backendRequire = createRequire(new URL('../backend/package.json', import.meta.url));
const timeoutMs = 5000;
const maxResponseBytes = 2 * 1024 * 1024;
const requiredTables = ['cvs', 'users', 'accounts', 'companies', 'posts', 'detailposts', 'outbox_events'];
const outboxColumns = ['id', 'aggregateType', 'aggregateId', 'eventType', 'payload', 'attempts',
    'lastError', 'nextAttemptAt', 'lockedAt', 'lockToken', 'createdAt', 'publishedAt'];

// Do not print driver messages: they can contain usernames, SQL, URLs or passwords.
export function safeErrorCode(error) {
    const codes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT',
        'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR',
        'PROTOCOL_SEQUENCE_TIMEOUT', 'MODULE_NOT_FOUND']);
    if (codes.has(error?.code)) return error.code;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'TIMEOUT';
    if (error?.code === 'CHECK_RESPONSE_TOO_LARGE') return 'RESPONSE_TOO_LARGE';
    return 'CHECK_FAILED';
}

export function hasUniqueCvConstraint(indexes) {
    const groups = new Map();
    for (const column of indexes) groups.set(column.name, [...(groups.get(column.name) || []), column]);
    return [...groups.values()].some(columns => columns.length === 2
        && columns.every(column => column.prefixLength == null && typeof column.col === 'string')
        && columns.some(column => column.col.toLowerCase() === 'userid')
        && columns.some(column => column.col.toLowerCase() === 'postid'));
}

async function loadConfig(overrides) {
    let fileEnv = {};
    try {
        fileEnv = backendRequire('dotenv').parse(await readFile(path.join(root, 'backend', '.env')));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const env = { ...fileEnv, ...overrides };
    const configs = JSON.parse(await readFile(path.join(root, 'backend', 'src', 'config', 'config.json'), 'utf8'));
    const defaults = configs[env.NODE_ENV || 'development'] || configs.development;
    const api = new URL(env.JOBFIND_API_URL || env.API_BASE_URL || 'http://127.0.0.1:4000');
    if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password) {
        throw new Error('Invalid API URL');
    }
    return { env, api: api.origin, database: {
        host: env.DB_HOST || defaults.host,
        port: Number(env.DB_PORT || defaults.port || 3306),
        database: env.DB_NAME || defaults.database,
        user: env.DB_USER || defaults.username,
        password: env.DB_PASSWORD || defaults.password || '',
        connectTimeout: timeoutMs,
        multipleStatements: false,
        enableKeepAlive: false
    } };
}

async function getJson(url, fetchImpl) {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    const reader = response.body?.getReader();
    if (!reader) return { status: response.status, body: null };
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxResponseBytes) throw Object.assign(new Error(), { code: 'CHECK_RESPONSE_TOO_LARGE' });
            chunks.push(value);
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
    let body = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* No raw response in reports. */ }
    return { status: response.status, body };
}

// This checks persisted data and public GET routes. It never logs in, creates a
// record, submits a CV, sends mail, edits a schema, or runs a background relay.
export async function checkLiveData({ env = process.env, fetchImpl = fetch, connect } = {}) {
    const report = { ok: false, readOnly: true, checkedAt: new Date().toISOString(),
        counts: {}, checks: [], scope: 'Public API and MySQL consistency; no application submission performed.' };
    const record = (name, status, message, details) => {
        report.checks.push({ name, status, message, ...(details && { details }) });
    };
    let connection;
    try {
        const config = await loadConfig(env);
        report.api = config.api;
        const http = async (name, route, validate) => {
            try {
                const response = await getJson(new URL(route, config.api), fetchImpl);
                validate(response);
                return response;
            } catch (error) {
                record(name, 'fail', 'Không đọc được API.', { code: safeErrorCode(error) });
                return null;
            }
        };
        const health = await http('api.health', '/health', ({ status, body }) => {
            record('api.health', status === 200 && body?.status === 'ok' ? 'pass' : 'fail',
                'API phản hồi kiểm tra hoạt động.', { httpStatus: status });
        });
        await http('api.readiness', '/readyz', ({ status, body }) => {
            const legacy = health?.body?.service === 'legacy-monolith';
            record('api.readiness', status === 200 && body?.status === 'ready' ? 'pass'
                : status === 404 && legacy ? 'warning' : 'fail',
            status === 404 && legacy ? 'Backend legacy chưa cung cấp /readyz; MySQL được kiểm tra trực tiếp.'
                : 'API phản hồi kiểm tra sẵn sàng.', { httpStatus: status });
        });
        const list = await http('api.jobs', '/api/get-filter-post?limit=20&offset=0', ({ status, body }) => {
            const valid = status === 200 && body?.errCode === 0 && Array.isArray(body.data)
                && Number.isSafeInteger(Number(body.count)) && Number(body.count) >= 0;
            record('api.jobs', valid ? 'pass' : 'fail', 'Đọc danh sách tin tuyển dụng từ API.', { httpStatus: status });
            if (valid) report.counts.apiListedJobs = Number(body.count);
        });
        const companies = await http('api.companies', '/api/get-list-company?limit=20&offset=0', ({ status, body }) => {
            const valid = status === 200 && body?.errCode === 0 && Array.isArray(body.data)
                && Number.isSafeInteger(Number(body.count)) && Number(body.count) >= 0;
            record('api.companies', valid ? 'pass' : 'fail', 'Đọc danh sách công ty từ API.', { httpStatus: status });
            if (valid) report.counts.apiPublicCompanies = Number(body.count);
        });
        await http('api.application-guard', '/api/my-applications', ({ status }) => {
            record('api.application-guard', [401, 403].includes(status) ? 'pass' : 'warning',
                [401, 403].includes(status)
                    ? 'Lịch sử ứng tuyển yêu cầu đăng nhập; chưa kiểm chứng dịch vụ phía sau hoặc thao tác nộp CV.'
                    : 'Chưa xác nhận tuyến lịch sử ứng tuyển được bảo vệ và sẵn sàng.', { httpStatus: status });
        });
        // Only explicitly configured dependencies are contacted. A protected
        // gateway route returning 401 cannot prove that its upstream is ready.
        for (const [key, label] of [['APPLICATION_URL', 'applications'], ['JOB_CORE_URL', 'job-core'], ['IDENTITY_URL', 'identity']]) {
            if (!config.env[key]) {
                record(`dependency.${label}`, 'warning', `${key} chưa được cung cấp; chưa kiểm tra trực tiếp dịch vụ này.`);
                continue;
            }
            try {
                const target = new URL(config.env[key]);
                if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error();
                const result = await getJson(new URL('/readyz', target.origin), fetchImpl);
                record(`dependency.${label}`, result.status === 200 && result.body?.status === 'ready' ? 'pass' : 'fail',
                    'Kiểm tra sẵn sàng của dịch vụ liên quan.', { httpStatus: result.status });
            } catch (error) {
                record(`dependency.${label}`, 'fail', 'Không kết nối được dịch vụ liên quan.', { code: safeErrorCode(error) });
            }
        }

        connection = await (connect || backendRequire('mysql2/promise').createConnection)(config.database);
        const query = async (sql, values = []) => (await connection.query({ sql, values, timeout: timeoutMs }))[0];
        await query('SELECT 1 AS connected');
        record('database.connection', 'pass', 'Đã kết nối MySQL đang được backend cấu hình.');
        const tables = await query(`SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) IN (${requiredTables.map(() => '?').join(',')})`, requiredTables);
        const byName = new Map(tables.map(table => [table.name.toLowerCase(), table]));
        const missingTables = requiredTables.filter(name => !byName.has(name));
        const nonTransactional = requiredTables.filter(name => byName.has(name) && byName.get(name).engine?.toUpperCase() !== 'INNODB');
        record('database.application-tables', missingTables.length || nonTransactional.length ? 'fail' : 'pass',
            'Các bảng tham gia nộp CV phải tồn tại và dùng InnoDB.', { missingTables, nonTransactional });
        const indexes = await query(`SELECT INDEX_NAME AS name, COLUMN_NAME AS col, SEQ_IN_INDEX AS position,
            SUB_PART AS prefixLength FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'cvs' AND NON_UNIQUE = 0
            ORDER BY INDEX_NAME, SEQ_IN_INDEX`);
        record('database.cv-unique', hasUniqueCvConstraint(indexes) ? 'pass' : 'fail',
            'CV cần ràng buộc duy nhất đủ hai cột (userId, postId) để ngăn nộp trùng.');
        const columns = await query(`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'outbox_events'`);
        const missingColumns = outboxColumns.filter(name => !columns.some(column => column.name.toLowerCase() === name.toLowerCase()));
        record('database.outbox-schema', missingColumns.length ? 'fail' : 'pass',
            'Kiểm tra các cột lưu và chuyển tiếp sự kiện nộp CV.', { missingColumns });
        const dataTables = ['cvs', 'users', 'accounts', 'companies', 'posts', 'detailposts'];
        if (dataTables.some(name => !byName.has(name))) return finish(report);
        const table = name => '`' + byName.get(name).name.replaceAll('`', '``') + '`';
        const joins = `FROM ${table('posts')} p JOIN ${table('detailposts')} d ON d.id = p.detailPostId
            JOIN ${table('users')} u ON u.id = p.userId JOIN ${table('companies')} c ON c.id = u.companyId`;
        // Public list/detail require an active owner account and approved company.
        // EXISTS avoids multiplying records in older databases with duplicate accounts.
        const activeOwner = `EXISTS (SELECT 1 FROM ${table('accounts')} a WHERE a.userId = u.id AND a.statusCode = 'S1')`;
        const visible = `p.statusCode = 'PS1' AND c.statusCode = 'S1' AND c.censorCode = 'CS1' AND ${activeOwner}`;
        const validDeadline = "TRIM(p.timeEnd) REGEXP '^[+]?[0-9]+([.][0-9]+)?$'";
        const deadline = 'CAST(p.timeEnd AS DECIMAL(24,3))';
        const now = Date.now();
        const [counts] = await query(`SELECT COUNT(*) AS visibleJobs,
            COALESCE(SUM(${validDeadline} AND ${deadline} >= ?), 0) AS unexpiredJobs,
            COALESCE(SUM(${validDeadline} AND ${deadline} < ?), 0) AS expiredJobs,
            COALESCE(SUM(NOT (${validDeadline}) OR p.timeEnd IS NULL), 0) AS invalidDeadlines,
            COALESCE(SUM(${validDeadline} AND ${deadline} >= ? AND ${activeOwner}), 0) AS openForApplications
            ${joins} WHERE ${visible}`, [now, now, now]);
        for (const [name, value] of Object.entries(counts)) report.counts[name] = Number(value);
        const [totals] = await query(`SELECT (SELECT COUNT(*) FROM ${table('posts')}) AS storedJobs,
            (SELECT COUNT(*) FROM ${table('cvs')}) AS storedApplications,
            (SELECT COUNT(*) FROM ${table('companies')} WHERE statusCode = 'S1' AND censorCode = 'CS1') AS publicCompanies`);
        for (const [name, value] of Object.entries(totals)) report.counts[name] = Number(value);
        if (!report.counts.openForApplications) record('data.open-jobs', 'warning',
            'Chưa có tin công khai còn hạn đủ điều kiện nhận CV; cần nhà tuyển dụng đăng hoặc gia hạn và được duyệt.');
        else record('data.open-jobs', 'pass', 'Có tin tuyển dụng công khai còn hạn và tài khoản đăng đang hoạt động.');
        if (report.counts.expiredJobs || report.counts.invalidDeadlines) record('data.deadlines', 'warning',
            'Có tin công khai hết hạn hoặc ngày kết thúc không hợp lệ; không tự sửa dữ liệu.');

        if (companies?.body?.errCode === 0 && Array.isArray(companies.body.data)) {
            const companyIds = companies.body.data.map(row => Number(row.id)).filter(Number.isSafeInteger);
            const stored = companyIds.length ? await query(`SELECT id, name FROM ${table('companies')}
                WHERE id IN (${companyIds.map(() => '?').join(',')}) AND statusCode = 'S1' AND censorCode = 'CS1'`, companyIds) : [];
            const matches = companyIds.length === companies.body.data.length
                && companies.body.data.every(row => stored.some(item => Number(item.id) === Number(row.id) && item.name === row.name))
                && Number(companies.body.count) === report.counts.publicCompanies;
            record('data.company-consistency', matches ? 'pass' : 'fail', 'Danh sách và số công ty từ API khớp MySQL.');
        }
        if (list?.body?.errCode === 0 && Array.isArray(list.body.data)) {
            const ids = list.body.data.map(row => Number(row.id)).filter(Number.isSafeInteger);
            const stored = ids.length ? await query(`SELECT p.id, d.name, c.id AS companyId ${joins}
                WHERE ${visible} AND p.id IN (${ids.map(() => '?').join(',')})`, ids) : [];
            const matches = ids.length === list.body.data.length && list.body.data.every(row => stored.some(item =>
                Number(item.id) === Number(row.id) && item.name === row.postDetailData?.name
                && Number(item.companyId) === Number(row.userPostData?.userCompanyData?.id)));
            record('data.job-list-consistency', matches ? 'pass' : 'fail',
                'Các tin trong trang đầu API khớp tên và công ty được duyệt trong MySQL.');
            record('data.job-list-count', Number(list.body.count) === report.counts.visibleJobs ? 'pass' : 'fail',
                'Tổng số tin API phải khớp các tin công khai trong MySQL.');
        }
        const [sample] = await query(`SELECT p.id, p.timeEnd, d.name, c.id AS companyId, c.name AS companyName,
            (SELECT COUNT(*) FROM ${table('cvs')} cv WHERE cv.postId = p.id) AS applicationCount
            ${joins} WHERE ${visible}
            ORDER BY (${validDeadline} AND ${deadline} >= ? AND ${activeOwner}) DESC, p.timePost DESC, p.id DESC LIMIT 1`, [now]);
        if (sample) {
            report.sampleJob = { id: Number(sample.id), title: sample.name, applicationCount: Number(sample.applicationCount) };
            await http('data.job-detail-consistency', `/api/get-detail-post-by-id?id=${encodeURIComponent(sample.id)}`, ({ status, body }) => {
                const detail = body?.data;
                const matches = status === 200 && body?.errCode === 0 && Number(detail?.id) === Number(sample.id)
                    && detail?.postDetailData?.name === sample.name && Number(detail?.companyData?.id) === Number(sample.companyId)
                    && detail?.companyData?.name === sample.companyName
                    && Number(detail?.applicationCount) === Number(sample.applicationCount);
                record('data.job-detail-consistency', matches ? 'pass' : 'fail',
                    'Chi tiết API khớp tên tin, công ty và số CV thực tế trong MySQL.', { jobId: Number(sample.id), httpStatus: status });
            });
        } else record('data.job-detail-consistency', 'warning', 'Chưa có tin PS1 thuộc công ty được duyệt để đối chiếu chi tiết.');
    } catch (error) {
        record('database.or-config', 'fail', 'Không hoàn tất kiểm tra cấu hình hoặc MySQL.', { code: safeErrorCode(error) });
    } finally {
        // destroy() is synchronous and closes the socket even after a timed-out query.
        connection?.destroy();
    }
    return finish(report);
}

function finish(report) {
    report.ok = !report.checks.some(check => check.status === 'fail');
    report.summary = Object.fromEntries(['pass', 'warning', 'fail'].map(status =>
        [status, report.checks.filter(check => check.status === status).length]));
    return report;
}

async function main() {
    const report = await checkLiveData();
    if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
        console.log(`Kiểm tra dữ liệu thật: ${report.ok ? 'ĐẠT' : 'CẦN KHẮC PHỤC'} (chỉ đọc)`);
        for (const check of report.checks) {
            const mark = { pass: 'OK', warning: 'LƯU Ý', fail: 'LỖI' }[check.status];
            console.log(`[${mark}] ${check.name}: ${check.message}${check.details ? ` ${JSON.stringify(check.details)}` : ''}`);
        }
        console.log(`Số liệu: ${JSON.stringify(report.counts)}`);
        console.log('Chưa thử ghi dữ liệu, đăng nhập hoặc nộp CV. Dùng --json để xem báo cáo có cấu trúc.');
    }
    process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
