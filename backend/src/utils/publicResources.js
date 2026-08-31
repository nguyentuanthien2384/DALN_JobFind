import db from '../models/index';

export const APPROVED_COMPANY_WHERE = Object.freeze({
    statusCode: 'S1',
    censorCode: 'CS1'
});

// Resolve a public company without exposing whether an inactive/pending tenant
// exists. Callers treat a null result in the same way as an unknown id.
export const findPublicCompany = (companyId) => db.Company.findOne({
    where: {
        id: companyId,
        ...APPROVED_COMPANY_WHERE
    },
    attributes: ['id']
});

// A public job must belong to an active account in an active, approved company.
// Keeping this check in the legacy backend prevents direct-id requests from
// bypassing the filters already enforced by Search and Job Core services.
export const findPublicPost = (postId) => db.Post.findOne({
    where: {
        id: postId,
        statusCode: 'PS1'
    },
    attributes: ['id', 'userId', 'timeEnd', 'statusCode'],
    include: [
        {
            model: db.User,
            as: 'userPostData',
            attributes: ['id', 'companyId'],
            required: true,
            include: [
                {
                    model: db.Account,
                    as: 'userAccountData',
                    attributes: ['statusCode'],
                    where: { statusCode: 'S1' },
                    required: true
                },
                {
                    model: db.Company,
                    as: 'userCompanyData',
                    attributes: ['id'],
                    where: APPROVED_COMPANY_WHERE,
                    required: true
                }
            ]
        }
    ],
    // The project config enables raw queries globally. Explicit raw/nest keeps
    // Sequelize from trying to hydrate a raw nested include (`result.get`).
    raw: true,
    nest: true
});

export const isPostOpenForApplications = (post, now = Date.now()) => {
    if (!post) return false;
    const timeEnd = Number(post.timeEnd);
    return Number.isFinite(timeEnd) && timeEnd >= now;
};
