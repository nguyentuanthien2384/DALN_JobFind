import { describe, expect, it } from 'vitest';

describe('MongoDB document schemas', () => {
    it('applies profile and embedded CV defaults', async () => {
        const { Profile } = await import('../identity-service/src/models/Profile.js');
        const profile = new Profile({ legacyUserId: 7 });
        expect(profile.roleCode).toBe('CANDIDATE');
        expect(profile.companyId).toBeNull();
        expect(profile.jobPreference.isFindJob).toBe(false);
        expect(profile.jobPreference.isTakeMail).toBe(false);
        profile.cvs.push({ fullName: 'Lan', experiences: [{ company: 'ACME' }] });
        expect(profile.cvs[0].title).toBe('CV chưa đặt tên');
        expect(profile.cvs[0].template).toBe('basic');
        expect(profile.cvs[0].experiences[0]._id).toBeUndefined();
        expect(profile.validateSync()).toBeUndefined();
        const indexes = Profile.schema.indexes();
        expect(indexes.some(([fields, options]) => fields.legacyUserId === 1 && options.unique && options.sparse)).toBe(true);
    });

    it('requires valid audit kind/name and configures retention/search indexes', async () => {
        const { AuditLog } = await import('../admin-service/src/models/AuditLog.js');
        const missing = new AuditLog({});
        expect(missing.validateSync().errors).toHaveProperty('kind');
        expect(missing.validateSync().errors).toHaveProperty('name');
        const invalid = new AuditLog({ kind: 'other', name: 'x' });
        expect(invalid.validateSync().errors.kind.kind).toBe('enum');
        expect(new AuditLog({ kind: 'event', name: 'job.created' }).validateSync()).toBeUndefined();
        const indexes = AuditLog.schema.indexes();
        expect(indexes.some(([fields, options]) => fields.createdAt === 1 && options.expireAfterSeconds === 180 * 24 * 3600)).toBe(true);
        expect(indexes.some(([fields]) => fields.targetType === 1 && fields.targetId === 1)).toBe(true);
    });

    it('requires tag identity and applies safe catalogue defaults', async () => {
        const { Tag } = await import('../admin-service/src/models/Tag.js');
        const invalid = new Tag({});
        expect(Object.keys(invalid.validateSync().errors)).toEqual(expect.arrayContaining(['type', 'name']));
        const tag = new Tag({ type: 'JOBTYPE', code: 'IT', name: 'Technology' });
        expect(tag.aliases).toEqual([]);
        expect(tag.weight).toBe(0);
        expect(tag.isActive).toBe(true);
        expect(tag.validateSync()).toBeUndefined();
        expect(Tag.schema.indexes().some(([fields, options]) => fields.type === 1 && fields.code === 1 && options.unique && options.sparse)).toBe(true);
    });
});
