import { Profile } from '../models/Profile.js';
import { createLogger } from '../../../shared/logger.js';
import recruitmentCatalog from '../../../shared/recruitmentCatalog.cjs';

const { normalizeProvinceCode } = recruitmentCatalog;

const logger = createLogger('identity-service');

// Reads expose the current administrative name without mutating a profile or
// its CV/free-text address merely because the user opened their account.
const profileForResponse = (profile) => {
    const addressCode = normalizeProvinceCode(profile.jobPreference?.addressCode);
    if (addressCode === profile.jobPreference?.addressCode) return profile;
    return {
        ...(profile.toObject?.() ?? profile),
        jobPreference: { ...(profile.jobPreference.toObject?.() ?? profile.jobPreference), addressCode }
    };
};

// Gateway da xac thuc va dat san danh tinh vao header.
const identity = (req) => ({
    userId: req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null,
    roleCode: req.headers['x-user-role'] || null,
    companyId: req.headers['x-company-id'] ? Number(req.headers['x-company-id']) : null
});

// Tao ho so lan dau khi nguoi dung cu (dang co trong MySQL) buoc sang he thong moi.
const findOrCreate = async ({ userId, roleCode, companyId }) => {
    let profile = await Profile.findOne({ legacyUserId: userId });
    if (!profile) {
        profile = await Profile.create({
            legacyUserId: userId,
            roleCode: roleCode || 'CANDIDATE',
            companyId: companyId ?? null
        });
        logger.info('da tao ho so moi', { userId });
    }
    return profile;
};

export const getMyProfile = async (req, res) => {
    const id = identity(req);
    if (!id.userId) {
        return res.status(401).json({ errCode: 401, errMessage: 'Chưa xác định được người dùng' });
    }
    const profile = await findOrCreate(id);
    return res.json({ errCode: 0, data: profileForResponse(profile) });
};

export const updateMyProfile = async (req, res) => {
    const id = identity(req);
    if (!id.userId) {
        return res.status(401).json({ errCode: 401, errMessage: 'Chưa xác định được người dùng' });
    }

    const profile = await findOrCreate(id);
    const b = req.body || {};

    // Chi cho phep sua nhung truong thuoc ve ho so. roleCode va companyId do he
    // thong cu quan ly - nhan tu body se thanh duong leo thang dac quyen.
    const allowed = ['headline', 'about', 'skills', 'email', 'firstName', 'lastName', 'phonenumber'];
    for (const key of allowed) {
        if (b[key] !== undefined) profile[key] = b[key];
    }
    if (b.jobPreference) {
        const preference = { ...(profile.jobPreference?.toObject?.() ?? profile.jobPreference ?? {}), ...b.jobPreference };
        if (Object.prototype.hasOwnProperty.call(preference, 'addressCode')) {
            preference.addressCode = normalizeProvinceCode(preference.addressCode);
        }
        profile.jobPreference = preference;
    }

    await profile.save();
    return res.json({ errCode: 0, data: profileForResponse(profile) });
};

// ===== CV Builder =====
export const listCvs = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const id = identity(req);
    const profile = await findOrCreate(id);
    return res.json({ errCode: 0, data: profile.cvs, count: profile.cvs.length });
};

export const createCv = async (req, res) => {
    const id = identity(req);
    const profile = await findOrCreate(id);

    profile.cvs.push({
        title: req.body?.title || 'CV chưa đặt tên',
        template: req.body?.template || 'basic',
        fullName: req.body?.fullName,
        email: req.body?.email,
        phone: req.body?.phone,
        address: req.body?.address,
        summary: req.body?.summary,
        skills: req.body?.skills || [],
        languages: req.body?.languages || [],
        experiences: req.body?.experiences || [],
        educations: req.body?.educations || [],
        parsedFrom: req.body?.parsedFrom
    });
    await profile.save();

    const created = profile.cvs[profile.cvs.length - 1];
    logger.info('da tao CV', { userId: id.userId, cvId: created._id });
    return res.status(201).json({ errCode: 0, data: created });
};

export const updateCv = async (req, res) => {
    const id = identity(req);
    const profile = await findOrCreate(id);

    const cv = profile.cvs.id(req.params.cvId);
    if (!cv) {
        return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy CV' });
    }

    const fields = [
        'title', 'template', 'fullName', 'email', 'phone', 'address',
        'summary', 'skills', 'languages', 'experiences', 'educations'
    ];
    for (const key of fields) {
        if (req.body?.[key] !== undefined) cv[key] = req.body[key];
    }
    cv.updatedAt = new Date();
    await profile.save();

    return res.json({ errCode: 0, data: cv });
};

export const deleteCv = async (req, res) => {
    const id = identity(req);
    const profile = await findOrCreate(id);

    const cv = profile.cvs.id(req.params.cvId);
    if (!cv) {
        return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy CV' });
    }
    cv.deleteOne();
    await profile.save();
    return res.json({ errCode: 0, errMessage: 'Đã xóa CV' });
};

// Luu ket qua AI Resume Parser thanh mot CV moi.
export const importParsedCv = async (req, res) => {
    const id = identity(req);
    const profile = await findOrCreate(id);
    const parsed = req.body?.parsed;

    if (!parsed) {
        return res.status(400).json({ errCode: 1, errMessage: 'Thiếu dữ liệu đã bóc tách' });
    }

    profile.cvs.push({
        title: parsed.title || `CV của ${parsed.fullName || 'tôi'}`,
        fullName: parsed.fullName,
        email: parsed.email,
        phone: parsed.phone,
        address: parsed.address,
        summary: parsed.summary,
        skills: parsed.skills || [],
        languages: parsed.languages || [],
        experiences: (parsed.experiences || []).map((e) => ({
            company: e.company, position: e.position, from: e.duration, to: '', description: e.description
        })),
        educations: parsed.educations || [],
        parsedFrom: { fileName: req.body?.fileName, parsedAt: new Date(), raw: parsed }
    });
    await profile.save();

    return res.status(201).json({ errCode: 0, data: profile.cvs[profile.cvs.length - 1] });
};
