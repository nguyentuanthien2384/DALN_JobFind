// Explicit migration of the audit retention index (see scripts/migrate-audit-retention.mjs).
//
// Installs created before the TTL existed have a plain { createdAt: 1 } index named
// createdAt_1. ensureAuditIndexes() keeps it on purpose: turning it into a TTL index
// makes MongoDB start deleting every log older than the retention window. This module
// reports what a conversion would do and performs it only on request.

const COLLECTION = 'auditlogs';

const isCreatedAtIndex = ({ key }) => key?.createdAt === 1 && Object.keys(key).length === 1;

export const inspectAuditRetention = async (db, { seconds, now = new Date() }) => {
    const collection = db.collection(COLLECTION);
    let indexes;
    try {
        indexes = await collection.listIndexes().toArray();
    } catch (error) {
        if (error.code !== 26 && error.codeName !== 'NamespaceNotFound') throw error;
        // No collection yet: admin-service creates it with the TTL index on startup.
        return { state: 'missing', seconds, total: 0, expiring: 0, oldest: null };
    }
    const index = indexes.find(isCreatedAtIndex);
    const cutoff = new Date(now.getTime() - seconds * 1000);
    const [total, expiring, oldestDoc] = await Promise.all([
        collection.estimatedDocumentCount(),
        collection.countDocuments({ createdAt: { $lt: cutoff } }),
        collection.findOne({ createdAt: { $type: 'date' } }, { sort: { createdAt: 1 }, projection: { createdAt: 1 } }),
    ]);
    let state = 'missing';
    if (index) {
        if (index.expireAfterSeconds == null) state = 'plain';
        else state = index.expireAfterSeconds === seconds ? 'ttl' : 'ttl-other';
    }
    return {
        state,
        index: index ? { name: index.name, expireAfterSeconds: index.expireAfterSeconds ?? null } : null,
        seconds,
        cutoff: cutoff.toISOString(),
        total,
        expiring,
        oldest: oldestDoc?.createdAt?.toISOString?.() || null,
    };
};

// Returns { applied, reason, report }. Never drops the index or deletes documents itself;
// MongoDB's TTL monitor removes expired logs (about once a minute) after the change.
export const applyAuditRetention = async (db, { seconds, allowExpiry = false, now = new Date() }) => {
    const report = await inspectAuditRetention(db, { seconds, now });
    if (report.state === 'ttl') return { applied: false, reason: 'already-applied', report };
    if (report.state === 'missing') return { applied: false, reason: 'no-legacy-index', report };
    if (report.expiring > 0 && !allowExpiry) return { applied: false, reason: 'would-expire-logs', report };
    await db.command({ collMod: COLLECTION, index: { keyPattern: { createdAt: 1 }, expireAfterSeconds: seconds } });
    const after = await inspectAuditRetention(db, { seconds, now });
    if (after.state !== 'ttl') throw new Error(`audit retention index is ${after.state} after collMod`);
    return { applied: true, reason: 'converted', report: after, before: report };
};
