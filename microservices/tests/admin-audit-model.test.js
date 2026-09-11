import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditLog, ensureAuditIndexes } from '../admin-service/src/models/AuditLog.js';

describe('audit identity index lifecycle', () => {
    afterEach(() => vi.restoreAllMocks());
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
        vi.spyOn(AuditLog, 'listIndexes').mockResolvedValue([]);
        const build = vi.spyOn(AuditLog, 'createIndexes').mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('index conflict'));
        const sync = vi.spyOn(AuditLog, 'syncIndexes');
        await ensureAuditIndexes();
        await expect(ensureAuditIndexes()).rejects.toThrow('index conflict');
        expect(build).toHaveBeenCalledTimes(2);
        expect(sync).not.toHaveBeenCalled();
    });

    it('preserves a legacy non-TTL time index while requiring the unique event index', async () => {
        vi.spyOn(AuditLog, 'listIndexes').mockResolvedValue([
            { name: 'createdAt_1', key: { createdAt: 1 } },
            { name: 'existing_custom_index', key: { actorRole: 1 } }
        ]);
        const build = vi.spyOn(AuditLog, 'createIndexes').mockResolvedValue(undefined);
        const sync = vi.spyOn(AuditLog, 'syncIndexes');
        const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
        await ensureAuditIndexes();
        const requested = build.mock.calls[0][0].toCreate;
        expect(requested.some(([, options]) => options.expireAfterSeconds != null)).toBe(false);
        expect(requested.find(([, options]) => options.name === 'audit_event_id_unique')[1]).toMatchObject({ unique: true });
        expect(requested.some(([keys]) => keys.createdAt === -1)).toBe(true);
        expect(sync).not.toHaveBeenCalled();
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('kept existing audit retention'));
    });

    it.each([
        [{ name: 'createdAt_1', key: { createdAt: 1 }, expireAfterSeconds: 15552000 }],
        [{ name: 'compound_time', key: { createdAt: 1, actorId: 1 } }],
        []
    ])('still requests configured TTL when no plain legacy time index exists: %j', async (...indexes) => {
        vi.spyOn(AuditLog, 'listIndexes').mockResolvedValue(indexes);
        const build = vi.spyOn(AuditLog, 'createIndexes').mockResolvedValue(undefined);
        await ensureAuditIndexes();
        expect(build.mock.calls[0][0].toCreate.some(([, options]) => options.expireAfterSeconds === 15552000)).toBe(true);
    });

    it('creates indexes for a new collection but stops on metadata access errors', async () => {
        const list = vi.spyOn(AuditLog, 'listIndexes')
            .mockRejectedValueOnce(Object.assign(new Error('missing collection'), { code: 26 }))
            .mockRejectedValueOnce(new Error('access denied'));
        const build = vi.spyOn(AuditLog, 'createIndexes').mockResolvedValue(undefined);
        await ensureAuditIndexes();
        await expect(ensureAuditIndexes()).rejects.toThrow('access denied');
        expect(list).toHaveBeenCalledTimes(2);
        expect(build).toHaveBeenCalledOnce();
    });
});
