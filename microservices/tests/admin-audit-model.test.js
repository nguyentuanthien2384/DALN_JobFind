import { describe, expect, it, vi } from 'vitest';
import { AuditLog, ensureAuditIndexes } from '../admin-service/src/models/AuditLog.js';

describe('audit identity index lifecycle', () => {
    it('uses a partial unique index without affecting old actions/events or TTL retention', () => {
        expect(AuditLog.schema.options.autoIndex).toBe(false);
        const indexes = AuditLog.schema.indexes();
        expect(indexes.find(([, options]) => options.name === 'audit_event_id_unique')).toEqual([
            { eventId: 1 }, expect.objectContaining({
                unique: true, partialFilterExpression: { kind: 'event', eventId: { $type: 'string' } },
                collation: { locale: 'simple' }
            })
        ]);
        expect(indexes.find(([, options]) => options.expireAfterSeconds)).toEqual([
            { createdAt: 1 }, expect.objectContaining({ expireAfterSeconds: 180 * 24 * 3600 })
        ]);
        expect(new AuditLog({ kind: 'event', name: 'legacy' }).validateSync()).toBeUndefined();
        expect(new AuditLog({ kind: 'action', name: 'POST /x' }).validateSync()).toBeUndefined();
    });

    it('awaits index creation and propagates failures without dropping existing indexes', async () => {
        const build = vi.spyOn(AuditLog, 'createIndexes').mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('index conflict'));
        const sync = vi.spyOn(AuditLog, 'syncIndexes');
        await ensureAuditIndexes();
        await expect(ensureAuditIndexes()).rejects.toThrow('index conflict');
        expect(build).toHaveBeenCalledTimes(2);
        expect(sync).not.toHaveBeenCalled();
    });
});
