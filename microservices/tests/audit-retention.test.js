import { describe, expect, it, vi } from 'vitest';
import { AUDIT_RETENTION_SECONDS } from '../admin-service/src/models/AuditLog.js';
import { applyAuditRetention, inspectAuditRetention } from '../admin-service/src/libs/auditRetention.js';

const now = new Date('2026-10-28T00:00:00.000Z');
const day = 24 * 3600 * 1000;

// Minimal stand-in for the MongoDB driver Db the migration script passes in.
const fakeDb = ({ indexes = [{ name: '_id_', key: { _id: 1 } }, { name: 'createdAt_1', key: { createdAt: 1 } }], docs = [], missing = false } = {}) => {
    const state = { indexes: indexes.map((index) => ({ ...index })), docs };
    const collection = {
        listIndexes: () => ({
            toArray: async () => {
                if (missing) throw Object.assign(new Error('ns does not exist'), { code: 26, codeName: 'NamespaceNotFound' });
                return state.indexes.map((index) => ({ ...index }));
            },
        }),
        estimatedDocumentCount: async () => state.docs.length,
        countDocuments: async ({ createdAt: { $lt: cutoff } }) => state.docs.filter((doc) => doc.createdAt < cutoff).length,
        findOne: async () => [...state.docs].sort((a, b) => a.createdAt - b.createdAt)[0] || null,
    };
    const db = {
        state,
        collection: vi.fn(() => collection),
        command: vi.fn(async ({ collMod, index }) => {
            expect(collMod).toBe('auditlogs');
            const target = state.indexes.find((item) => item.key.createdAt === 1);
            target.expireAfterSeconds = index.expireAfterSeconds;
            return { ok: 1 };
        }),
    };
    return db;
};

describe('audit retention migration', () => {
    it('keeps the 180-day policy the schema declares', () => {
        expect(AUDIT_RETENTION_SECONDS).toBe(15552000);
    });

    it('reports a legacy plain index and how many logs a conversion would delete', async () => {
        const db = fakeDb({ docs: [
            { createdAt: new Date(now.getTime() - 200 * day) },
            { createdAt: new Date(now.getTime() - 10 * day) },
        ] });
        const report = await inspectAuditRetention(db, { seconds: AUDIT_RETENTION_SECONDS, now });
        expect(report).toMatchObject({
            state: 'plain', index: { name: 'createdAt_1', expireAfterSeconds: null },
            total: 2, expiring: 1, cutoff: '2026-05-01T00:00:00.000Z',
        });
        expect(report.oldest).toBe(new Date(now.getTime() - 200 * day).toISOString());
        expect(db.command).not.toHaveBeenCalled();
    });

    it('refuses to convert when logs would expire unless that is explicitly accepted', async () => {
        const db = fakeDb({ docs: [{ createdAt: new Date(now.getTime() - 181 * day) }] });
        const refused = await applyAuditRetention(db, { seconds: AUDIT_RETENTION_SECONDS, now });
        expect(refused).toMatchObject({ applied: false, reason: 'would-expire-logs', report: { expiring: 1 } });
        expect(db.command).not.toHaveBeenCalled();

        const accepted = await applyAuditRetention(db, { seconds: AUDIT_RETENTION_SECONDS, now, allowExpiry: true });
        expect(accepted).toMatchObject({ applied: true, reason: 'converted', report: { state: 'ttl' } });
        expect(db.command).toHaveBeenCalledWith({
            collMod: 'auditlogs', index: { keyPattern: { createdAt: 1 }, expireAfterSeconds: 15552000 },
        });
    });

    it('converts in place when nothing would expire and is idempotent afterwards', async () => {
        const db = fakeDb({ docs: [{ createdAt: new Date(now.getTime() - 30 * day) }] });
        await expect(applyAuditRetention(db, { seconds: AUDIT_RETENTION_SECONDS, now })).resolves.toMatchObject({ applied: true });
        await expect(applyAuditRetention(db, { seconds: AUDIT_RETENTION_SECONDS, now })).resolves.toMatchObject({
            applied: false, reason: 'already-applied',
        });
        expect(db.command).toHaveBeenCalledTimes(1);
        expect(db.state.indexes.find((index) => index.name === 'createdAt_1').expireAfterSeconds).toBe(15552000);
    });

    it('changes a TTL index with another window only through the same checks', async () => {
        const db = fakeDb({ indexes: [{ name: 'createdAt_1', key: { createdAt: 1 }, expireAfterSeconds: 3600 }] });
        expect((await inspectAuditRetention(db, { seconds: AUDIT_RETENTION_SECONDS, now })).state).toBe('ttl-other');
        await expect(applyAuditRetention(db, { seconds: AUDIT_RETENTION_SECONDS, now })).resolves.toMatchObject({ applied: true });
    });

    it('does nothing for new installs (no collection or no legacy index)', async () => {
        for (const db of [fakeDb({ missing: true }), fakeDb({ indexes: [{ name: '_id_', key: { _id: 1 } }] })]) {
            const result = await applyAuditRetention(db, { seconds: AUDIT_RETENTION_SECONDS, now });
            expect(result).toMatchObject({ applied: false, reason: 'no-legacy-index' });
            expect(db.command).not.toHaveBeenCalled();
        }
    });

    it('fails loudly if MongoDB did not apply the TTL', async () => {
        const db = fakeDb();
        db.command.mockResolvedValueOnce({ ok: 1 });
        await expect(applyAuditRetention(db, { seconds: AUDIT_RETENTION_SECONDS, now })).rejects.toThrow('audit retention index is plain after collMod');
    });
});
