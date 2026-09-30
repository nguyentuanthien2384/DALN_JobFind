'use strict';

// Takes the fictional "[Demo]" vacancies created by `npm run seed:demo-data` off the public
// job search, or puts them back. Demo accounts, applications and chats stay untouched, so the
// recruiter and candidate walkthroughs keep working; only public listing changes.
//
//   npm run demo:hide-jobs              hide every published demo vacancy (status PS1 -> PS4)
//   npm run demo:show-jobs              restore the statuses saved by the last hide
//   ... -- --dry-run                    report without changing anything
//
// PS4 is the admin "ban" state, so an admin can also reopen a single post from the dashboard.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const mysql = require('mysql2/promise');
const configs = require('../src/config/config');
const { SEED_ID } = require('./demo-data/mysql.cjs');

const root = path.resolve(__dirname, '../..');
const stateFile = path.join(root, '.local/demo-data/hidden-demo-posts.json');
const execute = promisify(execFile);
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

function parseArgs(args) {
    const [command, ...rest] = args;
    if (!['hide', 'show'].includes(command) || rest.some(arg => arg !== '--dry-run')) {
        throw new Error('Cách dùng: node backend/scripts/demo-jobs-visibility.cjs hide|show [--dry-run]');
    }
    return { command, dryRun: rest.includes('--dry-run') };
}

async function readState() {
    try { return JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function reindexSearch() {
    // Core search mode reads Elasticsearch; legacy mode reads MySQL directly and needs nothing.
    const container = `${process.env.DEMO_COMPOSE_PROJECT || 'ai-job-portal'}-search-service-1`;
    const script = `fetch('http://127.0.0.1:4003/internal/reindex',{method:'POST',headers:{'x-internal-secret':process.env.INTERNAL_SECRET,'content-type':'application/json'},body:'{}'}).then(async r=>{const b=await r.json();if(!r.ok||b.errCode!==0)process.exit(1);console.log(b.indexed)}).catch(()=>process.exit(1))`;
    try {
        const { stdout } = await execute('docker', ['exec', container, 'node', '-e', script], { timeout: 120000, windowsHide: true });
        return `đã lập chỉ mục lại ${stdout.trim()} tin`;
    } catch {
        return 'không chạy được dịch vụ tìm kiếm (chế độ legacy không cần bước này)';
    }
}

async function main(args = process.argv.slice(2)) {
    const { command, dryRun } = parseArgs(args);
    if (process.env.NODE_ENV === 'production') throw new Error('Không thay đổi dữ liệu demo trong production.');
    const config = configs[process.env.NODE_ENV || 'development'];
    if (!LOCAL_HOSTS.includes(config.host)) throw new Error('Chỉ chạy với cơ sở dữ liệu trên máy local.');
    const db = await mysql.createConnection({ host: config.host, port: config.port, user: config.username,
        password: config.password, database: config.database, connectTimeout: 10000 });
    try {
        if (command === 'hide') {
            // Only rows the demo seeder owns and labelled "[Demo]" are touched.
            const [posts] = await db.query(`SELECT p.id, p.statusCode FROM posts p
                JOIN jobfind_demo_records r ON r.recordId = p.id AND r.tableName = 'posts' AND r.seedKey LIKE ?
                JOIN detailposts d ON d.id = p.detailPostId
                WHERE p.statusCode = 'PS1' AND d.name LIKE '[Demo]%'`, [`${SEED_ID}:%`]);
            console.log(`${posts.length} tin demo đang hiển thị công khai.`);
            if (dryRun || !posts.length) return;
            const previous = (await readState())?.posts || [];
            const saved = [...previous.filter(row => !posts.some(post => post.id === row.id)), ...posts];
            await fs.mkdir(path.dirname(stateFile), { recursive: true });
            await fs.writeFile(stateFile, JSON.stringify({ hiddenAt: new Date().toISOString(), posts: saved }, null, 2));
            await db.query(`UPDATE posts SET statusCode = 'PS4', updatedAt = NOW() WHERE id IN (?) AND statusCode = 'PS1'`, [posts.map(post => post.id)]);
            console.log(`Đã ẩn ${posts.length} tin demo khỏi trang tìm việc; trạng thái cũ lưu tại ${path.relative(root, stateFile)}.`);
        } else {
            const state = await readState();
            if (!state?.posts?.length) { console.log('Không có tin demo nào đang bị ẩn bởi script này.'); return; }
            const hidden = state.posts.map(post => post.id);
            const [current] = await db.query(`SELECT id FROM posts WHERE id IN (?) AND statusCode = 'PS4'`, [hidden]);
            console.log(`${current.length}/${hidden.length} tin demo sẽ được hiển thị lại.`);
            if (dryRun) return;
            for (const post of state.posts) {
                await db.query(`UPDATE posts SET statusCode = ?, updatedAt = NOW() WHERE id = ? AND statusCode = 'PS4'`, [post.statusCode, post.id]);
            }
            await fs.rm(stateFile, { force: true });
            console.log('Đã khôi phục trạng thái tin demo.');
        }
        console.log(`Tìm kiếm: ${await reindexSearch()}.`);
    } finally {
        await db.end();
    }
}

module.exports = { parseArgs, main };
if (require.main === module) main().catch(error => {
    const safe = error.code || (error.constructor === Error ? error.message : 'DEMO_VISIBILITY_FAILED');
    console.error(`Chưa hoàn tất: ${safe}`);
    process.exitCode = 1;
});
