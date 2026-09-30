'use strict';

// Additive, repeatable fixtures for the complete LOCAL multi-service demo.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const mysql = require('mysql2/promise');
const configs = require('../src/config/config');
const { buildCatalog } = require('./demo-data/catalog.cjs');
const { SEED_ID, PASSWORD, prepareLedger, seedMysql } = require('./demo-data/mysql.cjs');
const { seedWorkflow, verifyWorkflow } = require('./demo-data/workflow.cjs');
const { seedIdentity, verifyIdentity } = require('./demo-data/identity.cjs');
const root = path.resolve(__dirname, '../..');
const microRequire = createRequire(path.join(root, 'microservices/application-service/package.json'));
const { Client } = microRequire('pg');
const { MongoClient, ObjectId } = microRequire('mongodb');
const execute = promisify(execFile);

function parseOptions(args) {
    if (args.some(arg => !['--dry-run', '--refresh-dates'].includes(arg))) {
        throw new Error('Cách dùng: npm run seed:demo-data -- [--dry-run] [--refresh-dates]');
    }
    return { dryRun: args.includes('--dry-run'), refreshDates: args.includes('--refresh-dates') };
}

function assertLocal(host) {
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
        throw new Error('Bộ demo chỉ được nạp vào dịch vụ trên máy local.');
    }
}

async function searchCommand(container, action) {
    // Use the running service's own secret without printing it or passing it
    // through a shell/command line. Reindex uses the production projection code.
    const script = action === 'health'
        ? `fetch('http://127.0.0.1:4003/readyz').then(async r=>{if(!r.ok)process.exit(1);console.log('ready')}).catch(()=>process.exit(1))`
        : `fetch('http://127.0.0.1:4003/internal/reindex',{method:'POST',headers:{'x-internal-secret':process.env.INTERNAL_SECRET,'content-type':'application/json'},body:'{}'}).then(async r=>{const b=await r.json();if(!r.ok||b.errCode!==0)process.exit(1);console.log(JSON.stringify({indexed:b.indexed,reconciliation:b.reconciliation}))}).catch(()=>process.exit(1))`;
    const result = await execute('docker', ['exec', container, 'node', '-e', script], { timeout: 120000, windowsHide: true });
    return action === 'health' ? true : JSON.parse(result.stdout.trim());
}

async function writeAssets() {
    const directory = path.join(root, 'frontend/public/demo');
    await fs.mkdir(directory, { recursive: true });
    const colors = ['#176B87','#6D4C91','#AD5A36','#32756A','#385A91','#806035','#8A4774','#37745C'];
    for (let i = 0; i < colors.length; i++) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="28" fill="${colors[i]}"/><path d="M40 112V48h34v64m12 0V68h34v44" fill="none" stroke="white" stroke-width="8"/><text x="80" y="142" text-anchor="middle" fill="white" font-family="Arial" font-size="15">DEMO ${i + 1}</text></svg>`;
        await fs.writeFile(path.join(directory, `company-${i + 1}.svg`), svg, 'utf8');
    }
    await fs.writeFile(path.join(directory, 'avatar.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" rx="28" fill="#e6f2ef"/><circle cx="80" cy="58" r="26" fill="#398778"/><path d="M30 141v-17a50 42 0 0 1 100 0v17" fill="#398778"/></svg>');
    await fs.writeFile(path.join(directory, 'company-cover.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360"><rect width="1200" height="360" fill="#163c52"/><circle cx="990" cy="150" r="240" fill="#245c69"/><circle cx="1140" cy="310" r="210" fill="#317777"/><text x="65" y="170" fill="white" font-family="Arial" font-size="52">JobFind Demo</text><text x="68" y="225" fill="#d0eeeb" font-family="Arial" font-size="24">Careers · People · Opportunities</text></svg>');
}

async function seedProjectDemo(args = process.argv.slice(2)) {
    const options = parseOptions(args);
    const now = new Date();
    const config = configs[process.env.NODE_ENV || 'development'];
    if (!config || process.env.NODE_ENV === 'production') throw new Error('Không chạy dữ liệu demo trong production.');
    assertLocal(config.host);
    const microEnv = require('dotenv').parse(await fs.readFile(path.join(root, 'microservices/.env')));
    const pgHost = process.env.DEMO_PG_HOST || '127.0.0.1';
    const mongoUrl = process.env.DEMO_MONGO_URL || 'mongodb://127.0.0.1:27019';
    assertLocal(pgHost);
    assertLocal(new URL(mongoUrl).hostname);
    const container = `${process.env.DEMO_COMPOSE_PROJECT || 'ai-job-portal'}-search-service-1`;
    const pg = new Client({ host: pgHost, port: Number(process.env.DEMO_PG_PORT || 5435),
        user: microEnv.POSTGRES_USER, password: microEnv.POSTGRES_PASSWORD,
        database: process.env.DEMO_PG_DATABASE || 'application_db', connectionTimeoutMillis: 10000 });
    const mongo = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 10000 });
    let db, locked = false, inTransaction = false;
    try {
        db = await mysql.createConnection({ host: config.host, port: config.port, user: config.username,
            password: config.password, database: config.database, connectTimeout: 10000, timezone: '+07:00' });
        // Preflight all stores before mutating any of them.
        await pg.connect();
        await pg.query('SELECT 1 FROM applications LIMIT 1');
        await mongo.connect();
        await mongo.db('identity_db').command({ ping: 1 });
        await searchCommand(container, 'health');
        const catalog = buildCatalog(now);
        const [[existing]] = await db.query(`SELECT COUNT(DISTINCT c.id) count FROM companies c
            JOIN users u ON u.companyId=c.id JOIN accounts a ON a.userId=u.id
            WHERE c.statusCode='S1' AND c.censorCode='CS1' AND a.statusCode='S1' AND a.roleCode IN ('COMPANY','EMPLOYER')`);
        if (options.dryRun) {
            const summary = { dryRun: true, seedId: SEED_ID, catalogCompanies: catalog.companies.length,
                catalogJobs: catalog.jobs.length, catalogCandidates: catalog.candidates.length,
                approvedCompaniesCurrently: Number(existing.count), jobsPerExistingCompany: 6, applicationsPerCompany: 18,
                storesReady: ['MySQL', 'PostgreSQL', 'MongoDB', 'Elasticsearch'],
                note: 'Chỉ kiểm tra và lập kế hoạch; không tạo file, bảng hay bản ghi. Các khóa đã tồn tại sẽ được giữ nguyên.' };
            console.log(JSON.stringify(summary, null, 2));
            return summary;
        }
        const [[lock]] = await db.query('SELECT GET_LOCK(?, 10) acquired', [SEED_ID]);
        if (Number(lock.acquired) !== 1) throw new Error('Một lần nạp demo khác đang chạy.');
        locked = true;
        await prepareLedger(db);
        await db.beginTransaction();
        inTransaction = true;
        const { manifest, changes } = await seedMysql(db, catalog, { now });
        if (options.refreshDates) {
            // Deliberate opt-in: renew only fixture PS1 jobs; respect closed jobs.
            await db.query(`UPDATE posts p JOIN jobfind_demo_records r ON r.recordId=p.id AND r.tableName='posts'
                SET p.timeEnd=?,p.updatedAt=? WHERE r.seedKey LIKE ? AND p.statusCode='PS1'`,
            [String(now.getTime() + 90 * 86400000), now, `${SEED_ID}:%`]);
        }
        await db.commit();
        inTransaction = false;
        console.log('Đã nạp dữ liệu MySQL; đang đồng bộ quy trình tuyển dụng và CV Builder…');
        // Cross-store writes are resumable, not one distributed transaction.
        // Each module has stable identities and preserves user edits on retry.
        const workflow = await seedWorkflow({ client: pg, manifest, now, databaseHost: pgHost, apply: true });
        const identity = await seedIdentity({ mongo, manifest, now, ObjectId });
        const search = await searchCommand(container, 'reindex');
        await writeAssets();
        const workflowCheck = await verifyWorkflow({ client: pg, manifest });
        const identityCheck = await verifyIdentity({ mongo, manifest });
        if (workflowCheck.missingCvIds.length || workflowCheck.mismatchedCvIds.length || workflowCheck.unsupportedStageCvIds.length || identityCheck.ok === false) {
            throw new Error('Dữ liệu liên kết chưa đầy đủ; hãy chạy lại lệnh để tiếp tục đồng bộ.');
        }
        const [counts] = await db.query(`SELECT tableName,COUNT(*) count FROM jobfind_demo_records WHERE seedKey LIKE ? GROUP BY tableName`, [`${SEED_ID}:%`]);
        const report = { seedId: SEED_ID, generatedAt: now.toISOString(), changes, ownedRecords: counts,
            companiesCovered: manifest.companies.length, candidates: manifest.candidates.length,
            jobs: manifest.posts.length, applications: manifest.cvs.length,
            workflow, identity, search, workflowCheck, identityCheck,
            accounts: { recruiter: '0918800001', candidate: '0928800001', password: PASSWORD } };
        const output = path.join(root, '.local/demo-data');
        await fs.mkdir(output, { recursive: true });
        await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
        await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ ...manifest,
            candidates: manifest.candidates.map(({ file, ...candidate }) => candidate) }, null, 2));
        console.log(JSON.stringify(report, null, 2));
        return report;
    } finally {
        if (inTransaction) await db.rollback().catch(() => {});
        if (locked) await db.query('SELECT RELEASE_LOCK(?)', [SEED_ID]).catch(() => {});
        await Promise.allSettled([db?.end(), pg.end(), mongo.close()]);
    }
}

module.exports = { assertLocal, parseOptions, seedProjectDemo };
if (require.main === module) seedProjectDemo().catch(error => {
    // Driver/child-process error messages may contain SQL, credentials or URLs.
    const safe = error.code || (error.constructor === Error ? error.message : 'DEMO_SEED_FAILED');
    console.error(`Nạp dữ liệu demo chưa hoàn tất: ${safe}. Có thể chạy lại cùng lệnh để tiếp tục.`);
    process.exitCode = 1;
});
