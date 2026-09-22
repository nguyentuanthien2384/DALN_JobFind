import db from '../models/index';
import { getRecommendedPost, publicPostOwnerInclude } from './postService';
import { Op, where, cast, col } from 'sequelize';

const parseInteger = (value, fallback, min, max) => {
    if (value === undefined) return fallback;
    if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

// These are live collections: an unfollowed company or an expired posting must
// disappear even when the original notification remains in the inbox.
export const getNotificationJobs = async ({ userId, source, limit: limitValue, offset: offsetValue } = {}) => {
    const limit = parseInteger(limitValue, 10, 1, 50);
    const offset = parseInteger(offsetValue, 0, 0, 1000000);
    if (!userId || !['followed', 'recommended'].includes(source) || limit === null || offset === null) {
        return { errCode: 1, errMessage: 'Nguồn việc làm hoặc phân trang không hợp lệ.' };
    }

    if (source === 'recommended') {
        const result = await getRecommendedPost({ userId, limit, offset }, { notificationCollection: true });
        return { ...result, source };
    }

    const followed = await db.FollowCompany.findAll({
        where: { userId }, attributes: ['companyId'], raw: true
    });
    const companyIds = [...new Set(followed.map(item => item.companyId))];
    if (!companyIds.length) return { errCode: 0, data: [], count: 0, source };

    const owner = publicPostOwnerInclude();
    owner.where = { companyId: { [Op.in]: companyIds } };
    const result = await db.Post.findAndCountAll({
        where: {
            statusCode: 'PS1',
            [Op.and]: [where(cast(col('Post.timeEnd'), 'SIGNED'), { [Op.gt]: Date.now() })]
        },
        order: [['timePost', 'DESC'], ['id', 'DESC']],
        include: [
            {
                model: db.DetailPost, as: 'postDetailData', required: true,
                attributes: ['id', 'name', 'amount', 'categoryJobCode', 'addressCode', 'salaryJobCode', 'experienceJobCode'],
                include: [
                    'jobTypePostData', 'workTypePostData', 'salaryTypePostData',
                    'jobLevelPostData', 'provincePostData', 'expTypePostData'
                ].map(as => ({ model: db.Allcode, as, attributes: ['value', 'code'] }))
            },
            owner
        ],
        limit,
        offset,
        distinct: true,
        raw: true,
        nest: true
    });
    return { errCode: 0, data: result.rows, count: result.count, source };
};
