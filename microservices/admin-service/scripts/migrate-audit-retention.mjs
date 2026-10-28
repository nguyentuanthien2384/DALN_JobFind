// Turn the legacy plain auditlogs.createdAt_1 index into the 180-day TTL index the
// AuditLog schema declares. admin-service never does this on startup because it starts
// deleting old logs; run it once the retention policy is approved.
//
//   node scripts/migrate-audit-retention.mjs                       report only (default)
//   node scripts/migrate-audit-retention.mjs --apply               convert; refuses if logs would expire
//   node scripts/migrate-audit-retention.mjs --apply --allow-expiry  also accept that older logs are deleted
//
// MONGO_URL (or --mongo-url=...) selects admin_db. Local: --mongo-url=mongodb://127.0.0.1:27019/admin_db
// VPS:   cd deploy && docker compose run --rm --no-deps admin-service node scripts/migrate-audit-retention.mjs
// Exit codes: 0 done or nothing to do, 2 needs a decision (dry run with work left, or refused), 1 error.
import mongoose from 'mongoose';
import { AUDIT_RETENTION_SECONDS } from '../src/models/AuditLog.js';
import { applyAuditRetention, inspectAuditRetention } from '../src/libs/auditRetention.js';

const args = process.argv.slice(2);
const option = (name) => args.find((value) => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const apply = args.includes('--apply');
const allowExpiry = args.includes('--allow-expiry');
const url = option('mongo-url') || process.env.MONGO_URL;
if (!url) {
    console.error('Set MONGO_URL or pass --mongo-url=mongodb://host:port/admin_db');
    process.exit(1);
}

try {
    await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });
    const db = mongoose.connection.db;
    const seconds = AUDIT_RETENTION_SECONDS;
    if (!apply) {
        const report = await inspectAuditRetention(db, { seconds });
        console.log(JSON.stringify({ mode: 'dry-run', ...report }, null, 2));
        process.exitCode = ['plain', 'ttl-other'].includes(report.state) ? 2 : 0;
    } else {
        const result = await applyAuditRetention(db, { seconds, allowExpiry });
        console.log(JSON.stringify({ mode: 'apply', ...result }, null, 2));
        if (result.reason === 'would-expire-logs') {
            console.error(`${result.report.expiring} audit log(s) are older than the cutoff and would be deleted. `
                + 'Back them up, then rerun with --allow-expiry.');
            process.exitCode = 2;
        }
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect().catch(() => {});
}
