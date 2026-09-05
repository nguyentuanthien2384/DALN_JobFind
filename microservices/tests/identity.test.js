import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';
import { expectResponseContract } from './contractAssertions.js';

const db = vi.hoisted(() => ({
    Profile: { findOne: vi.fn(), create: vi.fn() }
}));
vi.mock('../identity-service/src/models/Profile.js', () => ({ Profile: db.Profile }));

const makeProfile = (initialCvs = []) => {
    const cvs = [...initialCvs];
    cvs.id = vi.fn((id) => cvs.find((cv) => String(cv._id) === String(id)) || null);
    return {
        cvs,
        jobPreference: { location: 'HN', toObject: vi.fn(() => ({ location: 'HN' })) },
        save: vi.fn().mockResolvedValue(undefined)
    };
};

describe('identity profile and CV controller', () => {
    beforeEach(() => {
        db.Profile.findOne.mockReset();
        db.Profile.create.mockReset();
    });

    it('requires an identity for profile reads and updates', async () => {
        const { getMyProfile, updateMyProfile } = await import('../identity-service/src/controllers/profileController.js');
        for (const handler of [getMyProfile, updateMyProfile]) {
            const res = makeRes();
            await handler(makeReq(), res);
            expect(res.statusCode).toBe(401);
        }
        expect(db.Profile.findOne).not.toHaveBeenCalled();
    });

    it('creates a migrated profile with safe role/company defaults', async () => {
        const created = makeProfile();
        created.legacyUserId = 7;
        db.Profile.findOne.mockResolvedValue(null);
        db.Profile.create.mockResolvedValue(created);
        const { getMyProfile } = await import('../identity-service/src/controllers/profileController.js');
        const res = makeRes();
        await getMyProfile(makeReq({ headers: { 'x-user-id': '7' } }), res);
        expect(db.Profile.create).toHaveBeenCalledWith({ legacyUserId: 7, roleCode: 'CANDIDATE', companyId: null });
        expect(res.body).toEqual({ errCode: 0, data: created });
        expectResponseContract('profileGet', res);
    });

    it('updates only whitelisted profile fields and merges preferences', async () => {
        const profile = makeProfile();
        db.Profile.findOne.mockResolvedValue(profile);
        const { updateMyProfile } = await import('../identity-service/src/controllers/profileController.js');
        const res = makeRes();
        await updateMyProfile(makeReq({
            headers: { 'x-user-id': '8', 'x-user-role': 'ADMIN', 'x-company-id': '2' },
            body: { headline: 'Engineer', skills: ['Node'], roleCode: 'SUPERADMIN', companyId: 999, jobPreference: { salary: 10 } }
        }), res);
        expect(profile).toMatchObject({ headline: 'Engineer', skills: ['Node'], jobPreference: { location: 'HN', salary: 10 } });
        expect(profile.roleCode).toBeUndefined();
        expect(profile.companyId).toBeUndefined();
        expect(profile.save).toHaveBeenCalledOnce();
    });

    it('lists CVs with a count', async () => {
        const profile = makeProfile([{ _id: 'a' }, { _id: 'b' }]);
        db.Profile.findOne.mockResolvedValue(profile);
        const { listCvs } = await import('../identity-service/src/controllers/profileController.js');
        const res = makeRes();
        await listCvs(makeReq({ headers: { 'x-user-id': '1' } }), res);
        expect(res.body.count).toBe(2);
        expect(res.body.data).toBe(profile.cvs);
    });

    it('creates a CV with defaults and user-provided sections', async () => {
        const profile = makeProfile();
        const originalPush = profile.cvs.push.bind(profile.cvs);
        profile.cvs.push = vi.fn((cv) => originalPush({ _id: 'new', ...cv }));
        db.Profile.findOne.mockResolvedValue(profile);
        const { createCv } = await import('../identity-service/src/controllers/profileController.js');
        const res = makeRes();
        await createCv(makeReq({ headers: { 'x-user-id': '2' }, body: { fullName: 'Lan', skills: ['JS'] } }), res);
        expect(profile.cvs.push).toHaveBeenCalledWith(expect.objectContaining({ title: 'CV chưa đặt tên', template: 'basic', fullName: 'Lan', skills: ['JS'], languages: [] }));
        expect(res.statusCode).toBe(201);
        expect(res.body.data._id).toBe('new');
    });

    it('updates selected CV fields and rejects an unknown CV', async () => {
        const cv = { _id: 'cv1', title: 'Old' };
        const profile = makeProfile([cv]);
        db.Profile.findOne.mockResolvedValue(profile);
        const { updateCv } = await import('../identity-service/src/controllers/profileController.js');
        const missing = makeRes();
        await updateCv(makeReq({ headers: { 'x-user-id': '2' }, params: { cvId: 'none' }, body: {} }), missing);
        expect(missing.statusCode).toBe(404);
        const ok = makeRes();
        await updateCv(makeReq({ headers: { 'x-user-id': '2' }, params: { cvId: 'cv1' }, body: { title: 'New', template: 'modern', unsafe: true } }), ok);
        expect(cv).toMatchObject({ title: 'New', template: 'modern' });
        expect(cv.unsafe).toBeUndefined();
        expect(cv.updatedAt).toBeInstanceOf(Date);
        expect(profile.save).toHaveBeenCalledOnce();
    });

    it('deletes an existing CV and returns 404 otherwise', async () => {
        const cv = { _id: 'cv1', deleteOne: vi.fn() };
        const profile = makeProfile([cv]);
        db.Profile.findOne.mockResolvedValue(profile);
        const { deleteCv } = await import('../identity-service/src/controllers/profileController.js');
        const ok = makeRes();
        await deleteCv(makeReq({ headers: { 'x-user-id': '2' }, params: { cvId: 'cv1' } }), ok);
        expect(cv.deleteOne).toHaveBeenCalledOnce();
        expect(ok.body.errCode).toBe(0);
        const missing = makeRes();
        await deleteCv(makeReq({ headers: { 'x-user-id': '2' }, params: { cvId: 'bad' } }), missing);
        expect(missing.statusCode).toBe(404);
    });

    it('validates parsed CV data and maps imported experience fields', async () => {
        const profile = makeProfile();
        const originalPush = profile.cvs.push.bind(profile.cvs);
        profile.cvs.push = vi.fn((cv) => originalPush({ _id: 'imported', ...cv }));
        db.Profile.findOne.mockResolvedValue(profile);
        const { importParsedCv } = await import('../identity-service/src/controllers/profileController.js');
        const invalid = makeRes();
        await importParsedCv(makeReq({ headers: { 'x-user-id': '3' } }), invalid);
        expect(invalid.statusCode).toBe(400);
        const parsed = {
            fullName: 'Mai', email: 'm@example.com', title: '', skills: null,
            experiences: [{ company: 'A', position: 'Dev', duration: '2020-2022', description: 'Built' }],
            educations: [{ school: 'U' }]
        };
        const ok = makeRes();
        await importParsedCv(makeReq({ headers: { 'x-user-id': '3' }, body: { parsed, fileName: 'mai.pdf' } }), ok);
        expect(profile.cvs.push).toHaveBeenCalledWith(expect.objectContaining({
            title: 'CV của Mai', skills: [], languages: [],
            experiences: [{ company: 'A', position: 'Dev', from: '2020-2022', to: '', description: 'Built' }],
            parsedFrom: expect.objectContaining({ fileName: 'mai.pdf', raw: parsed })
        }));
        expect(ok.statusCode).toBe(201);
    });
});
