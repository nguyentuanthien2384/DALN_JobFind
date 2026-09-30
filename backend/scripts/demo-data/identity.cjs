'use strict';

const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');

const serviceRequire = createRequire(path.resolve(__dirname, '../../..', 'microservices/package.json'));
// The Mongo driver is installed with the microservices, not the backend. Load it only when a seed
// actually writes, so backend-only test runs (e.g. the realtime CI job) never need it.
const driverObjectId = () => serviceRequire('mongodb').ObjectId;
const DATASET = 'jobfind-comprehensive-demo-v1';
const DATABASE = 'identity_db';

const text = value => value == null ? '' : String(value).trim();
const list = value => Array.isArray(value) ? value : [];
const strings = value => list(value).map(item => typeof item === 'string' ? item : item?.name).map(text).filter(Boolean);
const stableHex = (userId, variant) => createHash('sha256')
    .update(`${DATASET}:profile:${userId}:${variant}`).digest('hex').slice(0, 24);

function candidatesFrom(manifest) {
    if (!Array.isArray(manifest?.candidates)) throw new Error('Identity demo requires manifest.candidates');
    const ids = new Set();
    for (const candidate of manifest.candidates) {
        if (!Number.isSafeInteger(candidate?.id) || candidate.id <= 0 || ids.has(candidate.id)) {
            throw new Error('Identity demo requires unique positive candidate IDs');
        }
        ids.add(candidate.id);
    }
    return manifest.candidates;
}

function makeCvs(candidate, now, ObjectId) {
    const experiences = list(candidate.experience ?? candidate.experiences).map(item => ({
        company: text(item.company), position: text(item.position ?? item.role ?? item.title),
        from: text(item.from ?? item.start ?? item.startDate), to: text(item.to ?? item.end ?? item.endDate),
        description: Array.isArray(item.description) ? item.description.map(text).join('\n') : text(item.description),
    }));
    const educations = list(candidate.education ?? candidate.educations).map(item => ({
        school: text(item.school ?? item.institution), major: text(item.major ?? item.degree), degree: text(item.degree),
        year: text(item.year ?? item.endDate?.slice(0, 4)),
    }));
    // CV Builder has no project section. Keep the supplied project facts visible
    // in its supported summary field instead of writing an unused schema field.
    const projects = list(candidate.projects).map(item => typeof item === 'string' ? item :
        [item.name ?? item.title, Array.isArray(item.description) ? item.description.join(' ') : item.description, strings(item.technologies ?? item.skills).join(', ')]
            .map(text).filter(Boolean).join(' — ')).filter(Boolean);
    const projectSummary = projects.length ? `\n\nDự án tiêu biểu:\n${projects.map(item => `• ${item}`).join('\n')}` : '';
    const common = {
        template: 'basic', fullName: text(candidate.name) || [candidate.firstName, candidate.lastName].map(text).filter(Boolean).join(' '),
        email: text(candidate.email), phone: text(candidate.phone), address: text(candidate.address),
        summary: `${text(candidate.summary)}${projectSummary}`.trim(), skills: strings(candidate.skills),
        languages: list(candidate.languages).map(item => typeof item === 'string' ? item : `${item.language}: ${item.level}`),
        experiences, educations, createdAt: now, updatedAt: now,
    };
    return [
        { ...common, _id: new ObjectId(stableHex(candidate.id, 'general')), title: `CV tổng quan — ${text(candidate.headline) || common.fullName}` },
        { ...common, _id: new ObjectId(stableHex(candidate.id, 'projects')), title: `CV dự án — ${text(candidate.headline) || common.fullName}`,
            summary: [text(candidate.headline), common.summary].filter(Boolean).join('\n\n') },
    ];
}

function makeProfile(candidate, now, ObjectId) {
    const preference = candidate.setting || {};
    return {
        _id: new ObjectId(stableHex(candidate.id, 'profile')), legacyUserId: candidate.id,
        phonenumber: text(candidate.phone), email: text(candidate.email),
        firstName: text(candidate.firstName), lastName: text(candidate.lastName),
        roleCode: 'CANDIDATE', companyId: null, headline: text(candidate.headline),
        about: text(candidate.summary), skills: strings(candidate.skills),
        jobPreference: {
            categoryJobCode: text(preference.categoryJobCode), addressCode: text(preference.addressCode),
            salaryJobCode: text(preference.salaryJobCode), experienceJobCode: text(preference.experienceJobCode),
            isFindJob: Boolean(preference.isFindJob), isTakeMail: false,
        },
        cvs: makeCvs(candidate, now, ObjectId), createdAt: now, updatedAt: now,
    };
}

async function seedIdentity({ mongo, manifest, now = new Date(), ObjectId }) {
    const candidates = candidatesFrom(manifest);
    const timestamp = new Date(now);
    if (!Number.isFinite(timestamp.getTime())) throw new Error('Identity demo requires a valid date');
    const IdType = ObjectId || driverObjectId();
    const profiles = mongo.db(DATABASE).collection('profiles');
    const result = { database: DATABASE, candidates: candidates.length, createdProfiles: 0, addedCvs: 0, preservedProfiles: 0 };
    for (const candidate of candidates) {
        const inserted = await profiles.updateOne({ legacyUserId: candidate.id },
            { $setOnInsert: makeProfile(candidate, timestamp, IdType) }, { upsert: true });
        if (inserted.upsertedCount) {
            result.createdProfiles += 1;
            result.addedCvs += 2;
            continue;
        }
        result.preservedProfiles += 1;
        // 9003 is the documented local demo candidate. Only fill its empty CV
        // collection; a concurrent user-created CV wins over this atomic filter.
        if (candidate.id === 9003) {
            const supplemented = await profiles.updateOne({ legacyUserId: candidate.id,
                $or: [{ cvs: { $exists: false } }, { cvs: { $size: 0 } }] },
            { $set: { cvs: makeCvs(candidate, timestamp, IdType) } });
            if (supplemented.modifiedCount) result.addedCvs += 2;
        }
    }
    return result;
}

async function verifyIdentity({ mongo, manifest }) {
    const candidates = candidatesFrom(manifest);
    const ids = candidates.map(candidate => candidate.id);
    const profiles = await mongo.db(DATABASE).collection('profiles').find({ legacyUserId: { $in: ids } },
        { projection: { legacyUserId: 1, 'cvs._id': 1, 'cvs.title': 1, 'cvs.skills': 1, 'cvs.experiences': 1,
            'cvs.educations': 1, 'cvs.summary': 1 } }).toArray();
    const byId = new Map(profiles.map(profile => [profile.legacyUserId, profile]));
    const missingProfiles = ids.filter(id => !byId.has(id));
    const profilesWithoutCvs = profiles.filter(profile => !Array.isArray(profile.cvs) || !profile.cvs.length)
        .map(profile => profile.legacyUserId);
    const generatedCvs = profiles.flatMap(profile => list(profile.cvs).filter(cv =>
        ['general', 'projects'].some(variant => String(cv._id) === stableHex(profile.legacyUserId, variant))));
    return {
        ok: missingProfiles.length === 0 && profilesWithoutCvs.length === 0,
        database: DATABASE, profiles: profiles.length, builderCvs: profiles.reduce((sum, profile) => sum + list(profile.cvs).length, 0),
        demoCvs: generatedCvs.length, missingProfiles, profilesWithoutCvs,
    };
}

module.exports = { seedIdentity, verifyIdentity };
