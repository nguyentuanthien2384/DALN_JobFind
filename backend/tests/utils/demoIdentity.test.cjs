'use strict';

const { seedIdentity: seedWithDriver, verifyIdentity } = require('../../scripts/demo-data/identity.cjs');

// Stand-in for the Mongo driver's ObjectId, which lives in microservices/node_modules and is not
// installed when only the backend is tested.
class TestObjectId {
    constructor(hex) { this.hex = hex; }
    toString() { return this.hex; }
}
const seedIdentity = options => seedWithDriver({ ObjectId: TestObjectId, ...options });

function memoryMongo(initial = []) {
    const documents = new Map(initial.map(profile => [profile.legacyUserId, profile]));
    const collection = {
        updateOne: jest.fn(async (filter, update, options) => {
            const current = documents.get(filter.legacyUserId);
            if (!current && options?.upsert) {
                documents.set(filter.legacyUserId, update.$setOnInsert);
                return { upsertedCount: 1, modifiedCount: 0 };
            }
            if (current && update.$set && filter.$or && (!Object.hasOwn(current, 'cvs') || current.cvs?.length === 0)) {
                Object.assign(current, update.$set);
                return { upsertedCount: 0, modifiedCount: 1 };
            }
            return { upsertedCount: 0, modifiedCount: 0 };
        }),
        find: jest.fn(filter => ({ toArray: async () => [...documents.values()].filter(profile => filter.legacyUserId.$in.includes(profile.legacyUserId)) })),
    };
    const mongo = { db: jest.fn(name => {
        expect(name).toBe('identity_db');
        return { collection: collectionName => { expect(collectionName).toBe('profiles'); return collection; } };
    }) };
    return { mongo, collection, documents };
}

function candidate(id = 12001) {
    return { id, name: 'Nguyễn Minh An', firstName: 'Nguyễn Minh', lastName: 'An',
        email: 'minh.an@example.test', phone: '0900001234', address: 'Hà Nội', headline: 'Frontend Developer',
        summary: 'Ứng viên demo có kinh nghiệm xây dựng ứng dụng tuyển dụng.',
        skills: ['React', 'TypeScript'], languages: ['Tiếng Việt', 'Tiếng Anh B2'],
        experience: [{ company: 'Công ty Demo', position: 'Frontend Developer', from: '2023', to: '2026', description: 'Phát triển giao diện.' }],
        education: [{ school: 'Trường Đại học Demo', major: 'Công nghệ thông tin', degree: 'Cử nhân', year: '2023' }],
        projects: [{ name: 'Job Portal', description: 'Bộ lọc ứng viên và dashboard', technologies: ['React'] }],
        setting: { categoryJobCode: 'IT', addressCode: 'HN', salaryJobCode: '15-20tr', experienceJobCode: '2-nam', isFindJob: 1, isTakeMail: 1 } };
}

test('creates rich Mongo CVs once and preserves CV edits on subsequent seeding', async () => {
    const state = memoryMongo();
    const manifest = { candidates: [candidate()] };
    const first = await seedIdentity({ mongo: state.mongo, manifest, now: '2026-09-27T00:00:00Z' });
    expect(first).toMatchObject({ createdProfiles: 1, addedCvs: 2, preservedProfiles: 0 });
    const profile = state.documents.get(12001);
    expect(profile.jobPreference).toMatchObject({ isFindJob: true, isTakeMail: false });
    expect(profile.cvs).toHaveLength(2);
    expect(profile.cvs[0]).toMatchObject({ template: 'basic', experiences: [{ company: 'Công ty Demo', position: 'Frontend Developer', from: '2023', to: '2026', description: 'Phát triển giao diện.' }], educations: manifest.candidates[0].education });
    expect(profile.cvs[0].summary).toContain('Job Portal');
    expect(profile.cvs[0]).not.toHaveProperty('parsedFrom');
    expect(String(profile.cvs[0]._id)).toMatch(/^[0-9a-f]{24}$/);
    expect(String(profile.cvs[0]._id)).not.toBe(String(profile.cvs[1]._id));
    profile.cvs[0].summary = 'User edited this CV';
    const second = await seedIdentity({ mongo: state.mongo, manifest, now: '2026-10-01T00:00:00Z' });
    expect(second).toMatchObject({ createdProfiles: 0, addedCvs: 0, preservedProfiles: 1 });
    expect(profile.cvs[0].summary).toBe('User edited this CV');
    const check = await verifyIdentity({ mongo: state.mongo, manifest });
    expect(check).toMatchObject({ ok: true, profiles: 1, builderCvs: 2, demoCvs: 2 });
});

test('fills only the empty documented demo account CV array without overwriting any profile fields', async () => {
    const existing = { legacyUserId: 9003, firstName: 'Existing', headline: 'User title', updatedAt: 'unchanged', cvs: [] };
    const another = { legacyUserId: 12002, headline: 'Preserve empty user profile', cvs: [] };
    const state = memoryMongo([existing, another]);
    const result = await seedIdentity({ mongo: state.mongo, manifest: { candidates: [candidate(9003), candidate(12002)] } });
    expect(result).toMatchObject({ createdProfiles: 0, addedCvs: 2, preservedProfiles: 2 });
    expect(existing).toMatchObject({ firstName: 'Existing', headline: 'User title', updatedAt: 'unchanged' });
    expect(existing.cvs).toHaveLength(2);
    expect(another.cvs).toHaveLength(0);
    expect(state.collection.updateOne.mock.calls[1][0]).toEqual({ legacyUserId: 9003, $or: [{ cvs: { $exists: false } }, { cvs: { $size: 0 } }] });
});

test('existing demo CVs and their content remain untouched', async () => {
    const cvs = [{ _id: 'existing-cv', title: 'User authored CV', summary: 'Do not change' }];
    const state = memoryMongo([{ legacyUserId: 9003, cvs }]);
    const result = await seedIdentity({ mongo: state.mongo, manifest: { candidates: [candidate(9003)] } });
    expect(result.addedCvs).toBe(0);
    expect(state.documents.get(9003).cvs).toBe(cvs);
    expect(cvs).toEqual([{ _id: 'existing-cv', title: 'User authored CV', summary: 'Do not change' }]);
});

test('validation is completed before any write and verification remains read-only', async () => {
    const state = memoryMongo();
    await expect(seedIdentity({ mongo: state.mongo, manifest: { candidates: [candidate(), candidate()] } })).rejects.toThrow('unique positive');
    await expect(seedIdentity({ mongo: state.mongo, manifest: { candidates: [candidate()] }, now: 'invalid' })).rejects.toThrow('valid date');
    expect(state.collection.updateOne).not.toHaveBeenCalled();
    expect(await verifyIdentity({ mongo: state.mongo, manifest: { candidates: [candidate()] } })).toMatchObject({ ok: false, missingProfiles: [12001] });
    expect(state.collection.updateOne).not.toHaveBeenCalled();
});
