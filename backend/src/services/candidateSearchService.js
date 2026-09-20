import db from '../models/index';
import { Op, literal } from 'sequelize';

const invalid = (message) => ({ errCode: 1, httpStatus: 400, errMessage: message });
const scalar = (value, max = 100) => {
    if (value === undefined || value === null) return '';
    if (!['string', 'number'].includes(typeof value)) throw new Error('Tiêu chí tìm kiếm không hợp lệ.');
    const text = String(value).trim();
    if (text.length > max) throw new Error(`Tiêu chí tìm kiếm chỉ được tối đa ${max} ký tự.`);
    return text;
};
const integer = (value, min, max) => {
    const text = scalar(value);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < min || Number(text) > max) {
        throw new Error('Giới hạn, trang hoặc điểm phù hợp không hợp lệ.');
    }
    return Number(text);
};
const list = (value) => {
    const items = Array.isArray(value) ? value : scalar(value, 3000).split(',');
    if (items.length > 30) throw new Error('Chỉ được chọn tối đa 30 kỹ năng.');
    return [...new Set(items.map(item => scalar(item)).filter(Boolean))];
};
export const parseCandidateFilters = (data) => {
    const filters = {
        limit: integer(data.limit, 1, 50), offset: integer(data.offset, 0, 1000000),
        keyword: scalar(data.keyword, 120), categoryJobCode: scalar(data.categoryJobCode),
        experienceJobCode: scalar(data.experienceJobCode), salaryCode: scalar(data.salaryCode),
        provinceCode: scalar(data.provinceCode), skillMode: scalar(data.skillMode) || 'any',
        sort: scalar(data.sort) || 'match', minMatch: integer(data.minMatch ?? 0, 0, 100),
        listSkills: list(data.listSkills).map(id => integer(id, 1, Number.MAX_SAFE_INTEGER)),
        otherSkills: list(data.otherSkills),
    };
    if (filters.listSkills.length + filters.otherSkills.length > 30) throw new Error('Chỉ được chọn tối đa 30 kỹ năng.');
    if (!['any', 'all', 'rank'].includes(filters.skillMode) || !['match', 'name'].includes(filters.sort)) {
        throw new Error('Cách lọc hoặc sắp xếp không hợp lệ.');
    }
    if (filters.minMatch && !filters.listSkills.length && !filters.otherSkills.length &&
        !filters.categoryJobCode && !filters.experienceJobCode && !filters.salaryCode && !filters.provinceCode) {
        throw new Error('Hãy chọn tiêu chí trước khi lọc theo điểm phù hợp.');
    }
    return filters;
};

const preferenceFields = {
    categoryJobCode: 'categoryJobCode', experienceJobCode: 'experienceJobCode',
    salaryCode: 'salaryJobCode', provinceCode: 'addressCode',
};
const publicCode = (value) => value?.code ? { code: value.code, value: value.value } : null;
const normalizedSkill = name => name.trim().toLocaleLowerCase('vi');
const table = model => db.sequelize.getQueryInterface().queryGenerator.quoteTable(model.getTableName());

export const searchCandidates = async (data, companyId = null) => {
    let filters;
    try { filters = parseCandidateFilters(data); } catch (error) { return invalid(error.message); }
    const selectedSkills = filters.listSkills.length ? await db.Skill.findAll({
        where: { id: { [Op.in]: filters.listSkills } }, attributes: ['id', 'name'], raw: true,
    }) : [];
    if (selectedSkills.length !== filters.listSkills.length) return invalid('Một số kỹ năng không còn tồn tại. Hãy chọn lại.');
    const requiredSkills = [...new Map([...selectedSkills.map(skill => skill.name), ...filters.otherSkills]
        .map(name => [normalizedSkill(name), name])).values()];
    const escape = value => db.sequelize.escape(value);
    // EXISTS avoids duplicate profiles/counts when a skill is attached more than once.
    // Only escaped values enter these expressions; identifiers come from our models.
    const skillExists = condition => `EXISTS (SELECT 1 FROM ${table(db.UserSkill)} cs
        INNER JOIN ${table(db.Skill)} sk ON sk.id = cs.SkillId
        WHERE cs.UserId = \`UserSetting\`.userId AND ${condition})`;
    const skillMatches = requiredSkills.map(name => skillExists(`LOWER(TRIM(sk.name)) = ${escape(normalizedSkill(name))}`));
    const conditions = [literal('LENGTH(`UserSetting`.`file`) > 0')];
    const where = { isFindJob: 1, [Op.and]: conditions };
    const preferences = Object.entries(preferenceFields).filter(([key]) => filters[key]);
    preferences.forEach(([key, column]) => { where[column] = filters[key]; });
    if (filters.keyword) {
        // LOCATE treats %, _, +, # and quotes as text, not LIKE wildcards.
        const keyword = escape(filters.keyword.toLocaleLowerCase('vi'));
        conditions.push(literal(`(LOCATE(${keyword}, LOWER(CONCAT_WS(' ', \`userSettingData\`.firstName, \`userSettingData\`.lastName))) > 0
            OR ${skillExists(`LOCATE(${keyword}, LOWER(sk.name)) > 0`)})`));
    }
    if (skillMatches.length && filters.skillMode !== 'rank') {
        conditions.push(literal(`(${skillMatches.join(filters.skillMode === 'all' ? ' AND ' : ' OR ')})`));
    }
    const criterionCount = preferences.length + requiredSkills.length;
    // Hard filters already guarantee that every selected preference matches.
    const scoreSql = criterionCount ? `ROUND(100.0 * (${preferences.length}${skillMatches.map(sql => ` + (${sql})`).join('')}) / ${criterionCount})` : '0';
    if (filters.minMatch) conditions.push(literal(`(${scoreSql}) >= ${filters.minMatch}`));
    const result = await db.UserSetting.findAndCountAll({
        where,
        attributes: ['id', 'userId', ...Object.values(preferenceFields),
            [literal(scoreSql), 'matchScore'], ...skillMatches.map((sql, index) => [literal(sql), `matchedSkill${index}`])],
        include: [
            { model: db.User, as: 'userSettingData', required: true, attributes: ['id', 'firstName', 'lastName', 'image'],
                include: [{ model: db.Account, as: 'userAccountData', attributes: [], required: true,
                    where: { roleCode: 'CANDIDATE', statusCode: 'S1' } }] },
            { model: db.Allcode, as: 'jobTypeSettingData', attributes: ['value', 'code'] },
            { model: db.Allcode, as: 'expTypeSettingData', attributes: ['value', 'code'] },
            { model: db.Allcode, as: 'salaryTypeSettingData', attributes: ['value', 'code'] },
            { model: db.Allcode, as: 'provinceSettingData', attributes: ['value', 'code'] },
        ],
        // Ranking and the threshold must run before LIMIT, across the full result set.
        order: filters.sort === 'name'
            ? [[{ model: db.User, as: 'userSettingData' }, 'firstName', 'ASC'], [{ model: db.User, as: 'userSettingData' }, 'lastName', 'ASC'], ['id', 'ASC']]
            : [[literal('`matchScore`'), 'DESC'], ['id', 'ASC']],
        limit: filters.limit, offset: filters.offset, distinct: true, raw: true, nest: true,
    });
    const userIds = result.rows.map(row => row.userId);
    const [skills, company] = await Promise.all([userIds.length ? db.UserSkill.findAll({
        where: { UserId: { [Op.in]: userIds } }, attributes: ['UserId'],
        include: [{ model: db.Skill, attributes: ['id', 'name'] }], raw: true, nest: true,
    }) : [], Number.isSafeInteger(companyId) && companyId > 0 ? db.Company.findOne({
        where: { id: companyId }, attributes: ['allowCvFree', 'allowCv'], raw: true,
    }) : null]);
    const byUser = new Map();
    for (const item of skills) {
        if (!item.Skill?.id) continue;
        const candidateSkills = byUser.get(Number(item.UserId)) || new Map();
        candidateSkills.set(item.Skill.id, { id: item.Skill.id, name: item.Skill.name });
        byUser.set(Number(item.UserId), candidateSkills);
    }
    return {
        errCode: 0, count: result.count, isHiddenPercent: !criterionCount,
        allowance: company ? { free: Number(company.allowCvFree || 0), paid: Number(company.allowCv || 0) } : null,
        data: result.rows.map(row => ({
            id: row.id, userId: row.userId,
            userSettingData: { id: row.userSettingData?.id, firstName: row.userSettingData?.firstName,
                lastName: row.userSettingData?.lastName, image: row.userSettingData?.image },
            jobTypeSettingData: publicCode(row.jobTypeSettingData), expTypeSettingData: publicCode(row.expTypeSettingData),
            salaryTypeSettingData: publicCode(row.salaryTypeSettingData), provinceSettingData: publicCode(row.provinceSettingData),
            skills: [...(byUser.get(Number(row.userId))?.values() || [])],
            matchScore: criterionCount ? Number(row.matchScore) : null,
            matchedSkills: requiredSkills.filter((_, index) => Number(row[`matchedSkill${index}`]) === 1),
            missingSkills: requiredSkills.filter((_, index) => Number(row[`matchedSkill${index}`]) !== 1),
            matchedCriteria: preferences.map(([key]) => key), criterionCount,
        })),
    };
};

export const skillsFromDescription = (description, skills) => {
    const text = String(description || '').replace(/<[^>]*>/g, ' ').toLocaleLowerCase('vi');
    return skills.filter(skill => {
        const name = normalizedSkill(skill.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\p{L}\\p{N}_])${name}(?=$|[^\\p{L}\\p{N}_+#])`, 'u').test(text);
    });
};

export const listCandidateSearchJobs = async (data, companyId) => {
    if (!Number.isSafeInteger(companyId) || companyId <= 0) return { errCode: 3, httpStatus: 403, errMessage: 'Bạn cần thuộc một công ty để chọn tin tuyển dụng.' };
    let search, limit, offset;
    try {
        search = scalar(data.search, 120);
        limit = integer(data.limit ?? 20, 1, 50);
        offset = integer(data.offset ?? 0, 0, 1000000);
    } catch (error) { return invalid(error.message); }
    const result = await db.Post.findAndCountAll({
        attributes: ['id'],
        include: [
            { model: db.User, as: 'userPostData', attributes: [], required: true, where: { companyId } },
            { model: db.DetailPost, as: 'postDetailData', required: true,
                attributes: ['name', 'categoryJobCode', 'experienceJobCode', 'salaryJobCode', 'addressCode', 'descriptionHTML', 'descriptionMarkdown'],
                ...(search ? { where: literal(`LOCATE(${db.sequelize.escape(search)}, \`postDetailData\`.name) > 0`) } : {}) },
        ],
        order: [['id', 'DESC']], limit, offset, distinct: true, raw: true, nest: true,
    });
    const codes = [...new Set(result.rows.map(row => row.postDetailData.categoryJobCode).filter(Boolean))];
    const skills = codes.length ? await db.Skill.findAll({ where: { categoryJobCode: { [Op.in]: codes } },
        attributes: ['id', 'name', 'categoryJobCode'], raw: true }) : [];
    return { errCode: 0, count: result.count, data: result.rows.map(row => {
        const detail = row.postDetailData;
        return { id: row.id, name: detail.name, criteria: {
            categoryJobCode: detail.categoryJobCode || '', experienceJobCode: detail.experienceJobCode || '',
            salaryCode: detail.salaryJobCode || '', provinceCode: detail.addressCode || '',
            listSkills: skillsFromDescription(`${detail.descriptionHTML || ''} ${detail.descriptionMarkdown || ''}`,
                skills.filter(skill => skill.categoryJobCode === detail.categoryJobCode)).map(skill => ({ id: skill.id, name: skill.name })),
        } };
    }) };
};
