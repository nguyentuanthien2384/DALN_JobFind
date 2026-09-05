import db from "../models/index";
import { PostingQuotaError, normalizePostHot, lockPostingCompany, consumeLockedPostingQuota } from '../utils/postingQuota';
import { updateLegacyPost } from '../utils/jobEdit';
const { Op } = require("sequelize");
require('dotenv').config();
var nodemailer = require('nodemailer');
const { getFrontendLink } = require('../utils/frontendUrl');
const PUBLIC_USER_ATTRIBUTES = ['id', 'firstName', 'lastName', 'image', 'companyId'];
const PUBLIC_COMPANY_ATTRIBUTES = [
    'id', 'name', 'thumbnail', 'coverimage', 'descriptionHTML',
    'website', 'address', 'phonenumber', 'amountEmployer'
];
const APPROVED_COMPANY_WHERE = { statusCode: 'S1', censorCode: 'CS1' };
let sendmail = (note, userMail, link = null) => {
    var transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_APP,
            pass: process.env.EMAIL_APP_PASSWORD,
        }
    });

    var mailOptions = {
        from: process.env.EMAIL_APP,
        to: userMail,
        subject: 'Thông báo từ trang Job Finder',
        html: note
    };
    if (link)
    {
        mailOptions.html = note + ` <br>
        xem thông tin bài viết <a href='${getFrontendLink(link)}'>Tại đây</a> `
    }

    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
        } else {
        }
    });
}
// Business failures throw inside the managed transaction so every write rolls
// back; only convert them to the legacy response shape AFTER rollback.
const withPostingTransaction = async (work) => {
    try {
        return await db.sequelize.transaction(work);
    } catch (error) {
        if (error instanceof PostingQuotaError) return { errCode: 2, errMessage: error.message };
        throw error;
    }
};

let handleCreateNewPost = async (data) => {
    if (!data.name || !data.categoryJobCode || !data.addressCode || !data.salaryJobCode || !data.amount || !data.timeEnd || !data.categoryJoblevelCode || !data.userId
        || !data.categoryWorktypeCode || !data.experienceJobCode || !data.genderPostCode || !data.descriptionHTML || !data.descriptionMarkdown || data.isHot === '') {
        return { errCode: 1, errMessage: 'Missing required parameters !' };
    }
    return withPostingTransaction(async (transaction) => {
        const isHot = normalizePostHot(data.isHot);
        const company = await lockPostingCompany(data.userId, transaction);
        await consumeLockedPostingQuota(company, isHot, transaction);
        const detailPost = await db.DetailPost.create({
            name: data.name,
            descriptionHTML: data.descriptionHTML,
            descriptionMarkdown: data.descriptionMarkdown,
            categoryJobCode: data.categoryJobCode,
            addressCode: data.addressCode,
            salaryJobCode: data.salaryJobCode,
            amount: data.amount,
            categoryJoblevelCode: data.categoryJoblevelCode,
            categoryWorktypeCode: data.categoryWorktypeCode,
            experienceJobCode: data.experienceJobCode,
            genderPostCode: data.genderPostCode
        }, { transaction });
        const newPost = await db.Post.create({
            statusCode: 'PS3', timeEnd: data.timeEnd, userId: data.userId,
            isHot, detailPostId: detailPost.id
        }, { transaction });
        return {
            errCode: 0,
            errMessage: 'Tạo bài tuyển dụng thành công hãy chờ quản trị viên duyệt',
            postId: newPost.id
        };
    });
};

let handleReupPost = async (data) => {
    if (!data.userId || !data.postId || !data.timeEnd) {
        return { errCode: 1, errMessage: 'Missing required parameters !' };
    }
    return withPostingTransaction(async (transaction) => {
        const company = await lockPostingCompany(data.userId, transaction);
        // Ownership is checked by the authenticated controller. Lock the source
        // here to keep its charged category/detail reference stable until commit.
        const post = await db.Post.findOne({
            where: { id: data.postId }, transaction, lock: transaction.LOCK.UPDATE, raw: false
        });
        if (!post) throw new PostingQuotaError('Bài viết không tồn tại');
        const isHot = normalizePostHot(post.isHot);
        await consumeLockedPostingQuota(company, isHot, transaction);
        const reupPost = await db.Post.create({
            statusCode: 'PS3', timeEnd: data.timeEnd, userId: data.userId,
            isHot, detailPostId: post.detailPostId
        }, { transaction });
        return {
            errCode: 0,
            errMessage: 'Tạo bài tuyển dụng thành công hãy chờ quản trị viên duyệt',
            postId: reupPost.id
        };
    });
};
let handleUpdatePost = async (data, identity) => {
    if (!data.name || !data.categoryJobCode || !data.addressCode || !data.salaryJobCode || !data.amount || !data.timeEnd || !data.categoryJoblevelCode
        || !data.categoryWorktypeCode || !data.experienceJobCode || !data.genderPostCode || !data.descriptionHTML
        || !data.descriptionMarkdown || !data.id || !data.userId) {
        return { errCode: 1, errMessage: 'Missing required parameters !' };
    }
    return updateLegacyPost(data, identity);
};
let handleBanPost = (data) => {
    return new Promise(async (resolve, reject) => {
        try {

            if (!data.postId || !data.note || !data.userId) {
                resolve({
                    errCode: 1,
                    errMessage: `Missing required parameters !`
                })
            } else {
                let foundPost = await db.Post.findOne({
                    where: { id: data.postId },
                    raw: false
                })
                if (foundPost) {
                    foundPost.statusCode = 'PS4'
                    await foundPost.save()
                    await db.Note.create({
                        postId: foundPost.id,
                        note: data.note,
                        userId: data.userId
                    })
                    let user = await db.User.findOne({
                        where: { id: foundPost.userId },
                        attributes: {
                            exclude: ['userId']
                        }
                    })
                    sendmail(`Bài viết #${foundPost.id} của bạn đã bị chặn vì ${data.note}`, user.email,`admin/list-post/${foundPost.id}`)

                    resolve({
                        errCode: 0,
                        errMessage: 'Đã chặn bài viết thành công'
                    })
                }
                else {
                    resolve({
                        errCode: 2,
                        errMessage: 'Không tồn tại bài viết'
                    })
                }
            }

        } catch (error) {
            reject(error)
        }
    })
}
let handleActivePost = (data) => {
    return new Promise(async (resolve, reject) => {
        try {

            if (!data.id || !data.userId || !data.note) {
                resolve({
                    errCode: 1,
                    errMessage: `Missing required parameters !`
                })
            } else {
                let foundPost = await db.Post.findOne({
                    where: { id: data.id },
                    raw: false
                })
                if (foundPost) {
                    foundPost.statusCode = 'PS3'
                    await foundPost.save()
                    await db.Note.create({
                        postId: foundPost.id,
                        note: data.note,
                        userId: data.userId
                    })
                    let user = await db.User.findOne({
                        where: { id: foundPost.userId },
                        attributes: {
                            exclude: ['userId']
                        }
                    })
                    sendmail(`Bài viết #${foundPost.id} của bạn đã được mở lại vì: ${data.note}`, user.email,`admin/list-post/${foundPost.id}`)
                    resolve({
                        errCode: 0,
                        errMessage: 'Đã mở lại trạng thái chờ duyệt'
                    })
                }
                else {
                    resolve({
                        errCode: 2,
                        errMessage: 'Không tồn tại bài viết'
                    })
                }
            }

        } catch (error) {
            reject(error)
        }
    })
}
let handleAcceptPost = (data) => {
    return new Promise(async (resolve, reject) => {
        try {

            if (!data.id || !data.statusCode) {
                resolve({
                    errCode: 1,
                    errMessage: `Missing required parameters !`
                })
            } else {
                let foundPost = await db.Post.findOne({
                    where: { id: data.id },
                    raw: false
                })
                if (foundPost) {
                    foundPost.statusCode = data.statusCode
                    if (data.statusCode == "PS1") {
                        foundPost.timePost = new Date().getTime()
                    }
                    await foundPost.save()
                    let note = data.statusCode == "PS1" ? "Đã duyệt bài thành công" : data.note
                    await db.Note.create({
                        postId: foundPost.id,
                        note: note,
                        userId: data.userId
                    })
                    let user = await db.User.findOne({
                        where: { id: foundPost.userId },
                        attributes: {
                            exclude: ['userId']
                        }
                    })
                    if (data.statusCode == "PS1")
                    {
                        sendmail(note, user.email,`detail-job/${foundPost.id}`)
                        // Gửi thông báo cho những người theo dõi công ty
                        try {
                            if (user.companyId) {
                                let detailPostNoti = await db.DetailPost.findOne({
                                    where: { id: foundPost.detailPostId },
                                    attributes: ['name'],
                                    raw: true
                                })
                                let companyNoti = await db.Company.findOne({
                                    where: { id: user.companyId },
                                    attributes: ['name'],
                                    raw: true
                                })
                                let listFollower = await db.FollowCompany.findAll({
                                    where: { companyId: user.companyId },
                                    raw: true
                                })
                                if (listFollower && listFollower.length > 0) {
                                    let listNotification = listFollower.map(item => {
                                        return {
                                            userId: item.userId,
                                            typeCode: 'NEW_POST',
                                            isChecked: 0,
                                            content: `${companyNoti ? companyNoti.name : 'Công ty bạn theo dõi'} vừa đăng tin: ${detailPostNoti ? detailPostNoti.name : 'tin tuyển dụng mới'}`,
                                            link: `/detail-job/${foundPost.id}`,
                                            createdAt: new Date(),
                                            updatedAt: new Date()
                                        }
                                    })
                                    await db.Notification.bulkCreate(listNotification)
                                }
                            }
                        } catch (e) {
                            console.log('Notify follower error: ', e.message)
                        }
                    }
                    else {
                        sendmail(`Bài viết #${foundPost.id} của bạn đã bị từ chối`, user.email,`admin/list-post/${foundPost.id}`)
                    }
                    resolve({
                        errCode: 0,
                        errMessage: data.statusCode == "PS1" ? 'Duyệt bài thành công' : 'Đã từ chối bài thành công'
                    })
                }
                else {
                    resolve({
                        errCode: 2,
                        errMessage: 'Không tồn tại bài viết'
                    })
                }
            }

        } catch (error) {
            reject(error)
        }
    })
}
let getListPostByAdmin = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.limit || data.offset === undefined || data.offset === null || data.offset === '' || !data.companyId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let company = await db.Company.findOne({
                    where: { id: data.companyId }
                })
                if (!company) {
                    resolve({
                        errCode: 2,
                        errorMessage: 'Không tồn tại công ty',
                    })
                }
                else {
                    let listUserOfCompany = await db.User.findAll({
                        where: { companyId: company.id },
                        attributes: ['id'],
                    })
                    listUserOfCompany = listUserOfCompany.map(item => {
                        return {
                            userId: item.id
                        }
                    })
                    let objectFilter = {
                        where: {
                            [Op.and]: [{ [Op.or]: listUserOfCompany }]
                        },
                        order: [['updatedAt', 'DESC']],
                        limit: +data.limit,
                        offset: +data.offset,
                        attributes: {
                            exclude: ['detailPostId']
                        },
                        nest: true,
                        raw: true,
                        include: [
                            {
                                model: db.DetailPost, as: 'postDetailData', attributes: ['id', 'name', 'descriptionHTML', 'descriptionMarkdown', 'amount'],
                                include: [
                                    { model: db.Allcode, as: 'jobTypePostData', attributes: ['value', 'code'] },
                                    { model: db.Allcode, as: 'workTypePostData', attributes: ['value', 'code'] },
                                    { model: db.Allcode, as: 'salaryTypePostData', attributes: ['value', 'code'] },
                                    { model: db.Allcode, as: 'jobLevelPostData', attributes: ['value', 'code'] },
                                    { model: db.Allcode, as: 'genderPostData', attributes: ['value', 'code'] },
                                    { model: db.Allcode, as: 'provincePostData', attributes: ['value', 'code'] },
                                    { model: db.Allcode, as: 'expTypePostData', attributes: ['value', 'code'] }
                                ]
                            },
                            { model: db.Allcode, as: 'statusPostData', attributes: ['value', 'code'] },
                            { model: db.User, as: 'userPostData',
                                attributes: {
                                    exclude: ['userId']
                                },
                                include: [
                                    {model : db.Company, as: 'userCompanyData'}
                                ]
                            }
                        ]
                    }
                    if (data.censorCode) {
                        objectFilter.where = {...objectFilter.where,statusCode: data.censorCode}
                    }
                    if (data.search) {
                        objectFilter.where = {
                            ...objectFilter.where,
                            [Op.or]: [
                                db.Sequelize.where(db.sequelize.col('postDetailData.name'),{
                                    [Op.like]: `%${data.search}%`
                                }),
                                {
                                    id : {
                                        [Op.like]: `%${data.search}%`
                                    }
                                }
                            ]
                        }
                    }
                    let post = await db.Post.findAndCountAll(objectFilter)
                    resolve({
                        errCode: 0,
                        data: post.rows,
                        count: post.count
                    })
                }
            }
        } catch (error) {
            reject(error.message)
        }
    })


}

let getAllPostByAdmin = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.limit || data.offset === undefined || data.offset === null || data.offset === '') {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let objectFilter = {
                    order: [['updatedAt', 'DESC']],
                    limit: +data.limit,
                    offset: +data.offset,
                    attributes: {
                        exclude: ['detailPostId']
                    },
                    nest: true,
                    raw: true,
                    include: [
                        {
                            model: db.DetailPost, as: 'postDetailData', attributes: ['id', 'name', 'descriptionHTML', 'descriptionMarkdown', 'amount'],
                            include: [
                                { model: db.Allcode, as: 'jobTypePostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'workTypePostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'salaryTypePostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'jobLevelPostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'genderPostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'provincePostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'expTypePostData', attributes: ['value', 'code'] }
                            ]
                        },
                        { model: db.Allcode, as: 'statusPostData', attributes: ['value', 'code'] },
                        {
                            model: db.User, as: 'userPostData', attributes: { exclude: ['userId'] },
                            include: [
                                { model: db.Company, as: 'userCompanyData' }
                            ]
                        }
                    ],
                    order: [['updatedAt', 'DESC']],
                }
                // if (data.search) {
                //     objectFilter.include[0].where = {name: {[Op.like]: `%${data.search}%`}}
                // }
                if (data.censorCode) {
                    objectFilter.where = {statusCode : data.censorCode}
                }
                if (data.search) {
                    objectFilter.where = { ...objectFilter.where,
                        [Op.or]: [
                            db.Sequelize.where(db.sequelize.col('postDetailData.name'),{
                                [Op.like]: `%${data.search}%`
                            }),
                            {
                                id : {
                                    [Op.like]: `%${data.search}%`
                                }
                            },
                            db.Sequelize.where(db.sequelize.col('userPostData.userCompanyData.name'),{
                                [Op.like]: `%${data.search}%`
                            }),
                        ]
                    }
                }
                let post = await db.Post.findAndCountAll(objectFilter)
                resolve({
                    errCode: 0,
                    data: post.rows,
                    count: post.count
                })
            }
        } catch (error) {
            reject(error.message)
        }
    })


}
let getDetailPostById = (id, { includeNonPublic = false } = {}) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!id) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let post = await db.Post.findOne({
                    where: {
                        id: id,
                        // Trang cong khai chi duoc doc tin da duyet. Admin va
                        // nguoi cung cong ty duoc controller cap scope rieng.
                        ...(includeNonPublic ? {} : { statusCode: 'PS1' })
                    },
                    attributes: {
                        exclude: ['detailPostId']
                    },
                    nest: true,
                    raw: true,
                    include: [
                        {
                            model: db.DetailPost, as: 'postDetailData', attributes: ['id', 'name', 'descriptionHTML', 'descriptionMarkdown', 'amount',
                                'categoryJobCode', 'addressCode', 'salaryJobCode', 'categoryJoblevelCode',
                                'categoryWorktypeCode', 'experienceJobCode', 'genderPostCode'],
                            include: [
                                { model: db.Allcode, as: 'jobTypePostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'workTypePostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'salaryTypePostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'jobLevelPostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'genderPostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'provincePostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'expTypePostData', attributes: ['value', 'code'] }
                            ]
                        }
                    ]
                })
                if (post) {
                    let user = await db.User.findOne({
                        where: { id: post.userId },
                        attributes: PUBLIC_USER_ATTRIBUTES
                    })
                    let company = user ? await db.Company.findOne({
                        where: { id: user.companyId, ...APPROVED_COMPANY_WHERE },
                        attributes: PUBLIC_COMPANY_ATTRIBUTES
                    }) : null
                    if (!company && !includeNonPublic) {
                        resolve({
                            errCode: 0,
                            errMessage: 'Không tìm thấy bài viết'
                        })
                        return
                    }
                    // Tai lieu xac minh doanh nghiep khong bao gio di kem chi
                    // tiet tin tuyen dung, ke ca khi admin dang xem tin cho duyet.
                    const companyData = company?.toJSON ? company.toJSON() : company ? { ...company } : null
                    if (companyData) delete companyData.file
                    post.companyData = companyData
                    resolve({
                        errCode: 0,
                        data: post,
                    })
                }
                else {
                    resolve({
                        errCode: 0,
                        errMessage: 'Không tìm thấy bài viết'
                    })
                }
            }
        } catch (error) {
            reject(error.message)
        }
    })
}
let getFilterPost = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            data = {
                categoryJobCode: '',
                addressCode: '',
                salaryJobCode: '',
                categoryJoblevelCode: '',
                categoryWorktypeCode: '',
                experienceJobCode: '',
                search: '',
                ...data
            }
            for (const key of ['salaryJobCode', 'categoryJoblevelCode', 'categoryWorktypeCode', 'experienceJobCode']) {
                if (Array.isArray(data[key])) data[key] = data[key].join(',')
            }
            let objectFilter = ''
            if (data.salaryJobCode !== '' || data.categoryWorktypeCode !== '' || data.experienceJobCode !== '' || data.categoryJoblevelCode !== '') {
                let querySalaryJob = ''
                if (data.salaryJobCode !== '')
                    querySalaryJob = data.salaryJobCode.split(',').map((data, index) => {
                        return { salaryJobCode: data }
                    })

                let queryWorkType = ''
                if (data.categoryWorktypeCode !== '')
                    queryWorkType = data.categoryWorktypeCode.split(',').map((data, index) => {
                        return { categoryWorktypeCode: data }
                    })

                let queryExpType = ''
                if (data.experienceJobCode !== '')
                    queryExpType = data.experienceJobCode.split(',').map((data, index) => {
                        return { experienceJobCode: data }
                    })
                let queryJobLevel = ''
                if (data.categoryJoblevelCode !== '')
                    queryJobLevel = data.categoryJoblevelCode.split(',').map((data, index) => {
                        return { categoryJoblevelCode: data }
                    })
                objectFilter = {
                    where: {
                        [Op.and]: [
                            queryExpType && { [Op.or]: [...queryExpType] },
                            queryWorkType && { [Op.or]: [...queryWorkType] },
                            querySalaryJob && { [Op.or]: [...querySalaryJob] },
                            queryJobLevel && { [Op.or]: [...queryJobLevel] }
                        ]
                    },
                    raw: true,
                    nest: true,
                    attributes: {
                        exclude: ['statusCode']
                    }
                }
            }
            else {
                objectFilter = {
                    raw: true,
                    nest: true,
                    attributes: {
                        exclude: ['statusCode']
                    }
                }
            }
            if (data.categoryJobCode && data.categoryJobCode !== '') objectFilter.where = { ...objectFilter.where, categoryJobCode: data.categoryJobCode }
            if (data.addressCode && data.addressCode !== '') objectFilter.where = { ...objectFilter.where, addressCode: data.addressCode }
            if (data.search) objectFilter.where = {...objectFilter.where,name: {[Op.like] : `%${data.search}%`}}
            let listDetailPost = await db.DetailPost.findAll(objectFilter)
            let listDetailPostId = listDetailPost.map(item => {
                return {
                    detailPostId: item.id
                }
            })

            let postFilter = {
                where: {
                    statusCode: 'PS1',
                    [Op.or]: listDetailPostId,
                },
                order: [['timePost', 'DESC']],
                include: [
                    {
                        model: db.DetailPost, as: 'postDetailData', attributes: ['id', 'name', 'descriptionHTML', 'descriptionMarkdown', 'amount'],
                        include: [
                            { model: db.Allcode, as: 'jobTypePostData', attributes: ['value', 'code'] },
                            { model: db.Allcode, as: 'workTypePostData', attributes: ['value', 'code'] },
                            { model: db.Allcode, as: 'salaryTypePostData', attributes: ['value', 'code'] },
                            { model: db.Allcode, as: 'jobLevelPostData', attributes: ['value', 'code'] },
                            { model: db.Allcode, as: 'genderPostData', attributes: ['value', 'code'] },
                            { model: db.Allcode, as: 'provincePostData', attributes: ['value', 'code'] },
                            { model: db.Allcode, as: 'expTypePostData', attributes: ['value', 'code'] }
                        ]
                    },
                    {
                        model: db.User, as: 'userPostData',
                        attributes: PUBLIC_USER_ATTRIBUTES,
                        include: [
                            {
                                model: db.Company,
                                as: 'userCompanyData',
                                attributes: PUBLIC_COMPANY_ATTRIBUTES,
                                where: APPROVED_COMPANY_WHERE,
                                required: true
                            },
                        ]
                    }
                ],
                raw: true,
                nest: true
            }
            if (data.limit && data.offset !== undefined && data.offset !== null && data.offset !== '') {
                postFilter.limit = +data.limit
                postFilter.offset = +data.offset
            }
            if (data.isHot == 1) {
                postFilter.where = { ...postFilter.where, isHot: data.isHot }
            }
            let res = await db.Post.findAndCountAll(postFilter)

            resolve({
                errCode: 0,
                data: res.rows,
                count: res.count
            })


        } catch (error) {
            reject(error)
        }
    })
}

let getStatisticalTypePost = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            const getCompanyScope = () => data.companyId ? [{
                model: db.User,
                as: 'userPostData',
                attributes: [],
                where: { companyId: data.companyId },
                required: true
            }] : []
            let res = await db.Post.findAll({
                where: {
                    statusCode: 'PS1'
                },
                include: [
                    ...getCompanyScope(),
                    {
                        model: db.DetailPost, as: 'postDetailData', attributes: [],
                        include: [
                            { model: db.Allcode, as: 'jobTypePostData', attributes: ['value', 'code'] }
                        ],
                    }
                ],
                attributes: [[db.sequelize.fn('COUNT', db.sequelize.col('postDetailData.categoryJobCode')), 'amount']],
                group: ['postDetailData.categoryJobCode'],
                order: [[db.sequelize.literal('amount'), 'DESC']],
                limit: +data.limit,
                raw: true,
                nest: true
            })
            let totalPost = await db.Post.findAndCountAll({
                where: {
                    statusCode: 'PS1'
                },
                include: getCompanyScope()
            })
            resolve({
                errCode: 0,
                data: res,
                totalPost: totalPost.count
            })
        }
        catch (error) {
            reject(error)
        }
    })
}

let getListNoteByPost = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.id) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let res = await db.Note.findAndCountAll({
                    where: {postId: data.id},
                    limit: +data.limit,
                    offset: +data.offset,
                    include: [
                        {model: db.User , as: 'userNoteData' ,
                            attributes: {
                                exclude: ['userId']
                            }
                        }
                    ],
                    order: [['createdAt', 'DESC']],
                    raw: true,
                    nest: true
                })
                resolve({
                    errCode: 0,
                    data: res.rows,
                    count: res.count
                })

            }
        } catch (error) {
            reject(error.message)
        }
    })
}

// Lấy danh sách việc làm tương tự (cùng lĩnh vực, đang hoạt động)
let getRelatedPost = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.postId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let post = await db.Post.findOne({
                    where: { id: data.postId, statusCode: 'PS1' },
                    raw: true
                })
                if (!post) {
                    resolve({
                        errCode: 2,
                        errMessage: 'Không tìm thấy tin tuyển dụng'
                    })
                } else {
                    let detailPost = await db.DetailPost.findOne({
                        where: { id: post.detailPostId },
                        raw: true
                    })
                    let listDetailPost = await db.DetailPost.findAll({
                        where: {
                            categoryJobCode: detailPost.categoryJobCode,
                            id: { [Op.ne]: detailPost.id }
                        },
                        attributes: ['id'],
                        raw: true
                    })
                    let listDetailPostId = listDetailPost.map(item => {
                        return { detailPostId: item.id }
                    })
                    if (listDetailPostId.length === 0) {
                        resolve({
                            errCode: 0,
                            data: []
                        })
                    } else {
                        let res = await db.Post.findAll({
                            where: {
                                statusCode: 'PS1',
                                id: { [Op.ne]: post.id },
                                [Op.or]: listDetailPostId,
                            },
                            order: [['isHot', 'DESC'], ['timePost', 'DESC']],
                            limit: data.limit ? +data.limit : 5,
                            include: [
                                {
                                    model: db.DetailPost, as: 'postDetailData', attributes: ['id', 'name', 'amount'],
                                    include: [
                                        { model: db.Allcode, as: 'jobTypePostData', attributes: ['value', 'code'] },
                                        { model: db.Allcode, as: 'workTypePostData', attributes: ['value', 'code'] },
                                        { model: db.Allcode, as: 'salaryTypePostData', attributes: ['value', 'code'] },
                                        { model: db.Allcode, as: 'jobLevelPostData', attributes: ['value', 'code'] },
                                        { model: db.Allcode, as: 'provincePostData', attributes: ['value', 'code'] },
                                        { model: db.Allcode, as: 'expTypePostData', attributes: ['value', 'code'] }
                                    ]
                                },
                                {
                                    model: db.User, as: 'userPostData',
                                    attributes: PUBLIC_USER_ATTRIBUTES,
                                    include: [
                                        {
                                            model: db.Company,
                                            as: 'userCompanyData',
                                            attributes: ['id', 'name', 'thumbnail'],
                                            where: APPROVED_COMPANY_WHERE,
                                            required: true
                                        },
                                    ]
                                }
                            ],
                            raw: true,
                            nest: true
                        })
                        resolve({
                            errCode: 0,
                            data: res
                        })
                    }
                }
            }
        } catch (error) {
            reject(error)
        }
    })
}

// Gợi ý việc làm theo kỹ năng và cài đặt tìm việc của ứng viên
let getRecommendedPost = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.userId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                // 1. Kỹ năng của ứng viên
                let listUserSkill = await db.UserSkill.findAll({
                    where: { userId: data.userId },
                    raw: true
                })
                // Model UserSkill khong khai bao thuoc tinh nao, hai cot khoa ngoai la do
                // association tu sinh nen ten thuoc tinh Sequelize tra ve la 'UserId'/'SkillId'
                // (chu hoa) chu khong phai ten cot 'userId'/'skillId' trong DB. Doc sai chu hoa
                // se ra toan null -> phan goi y viec lam bo qua het ky nang cua ung vien.
                let listSkillId = listUserSkill.map(item => item.SkillId)
                let listSkill = listSkillId.length > 0 ? await db.Skill.findAll({
                    where: { id: listSkillId },
                    raw: true
                }) : []
                let skillNames = listSkill.map(item => item.name.toLowerCase())
                let skillCategories = [...new Set(listSkill.map(item => item.categoryJobCode))]

                // 2. Cài đặt tìm việc
                let userSetting = await db.UserSetting.findOne({
                    where: { userId: data.userId },
                    raw: true
                })

                // 3. Tin đang hoạt động
                let listPost = await db.Post.findAll({
                    where: { statusCode: 'PS1' },
                    order: [['timePost', 'DESC']],
                    include: [
                        {
                            model: db.DetailPost, as: 'postDetailData',
                            attributes: ['id', 'name', 'amount', 'categoryJobCode', 'addressCode', 'salaryJobCode', 'experienceJobCode'],
                            include: [
                                { model: db.Allcode, as: 'jobTypePostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'workTypePostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'salaryTypePostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'jobLevelPostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'provincePostData', attributes: ['value', 'code'] },
                                { model: db.Allcode, as: 'expTypePostData', attributes: ['value', 'code'] }
                            ]
                        },
                        {
                            model: db.User, as: 'userPostData',
                            attributes: PUBLIC_USER_ATTRIBUTES,
                            include: [
                                {
                                    model: db.Company,
                                    as: 'userCompanyData',
                                    attributes: PUBLIC_COMPANY_ATTRIBUTES,
                                    where: APPROVED_COMPANY_WHERE,
                                    required: true
                                },
                            ]
                        }
                    ],
                    raw: true,
                    nest: true
                })

                // 4. Chấm điểm phù hợp
                let scoredPost = listPost.map(post => {
                    let score = 0
                    let detail = post.postDetailData
                    let postName = detail.name ? detail.name.toLowerCase() : ''
                    if (skillCategories.includes(detail.categoryJobCode)) score += 3
                    skillNames.forEach(skill => {
                        if (skill && postName.includes(skill)) score += 2
                    })
                    if (userSetting) {
                        if (userSetting.categoryJobCode && userSetting.categoryJobCode === detail.categoryJobCode) score += 3
                        if (userSetting.addressCode && userSetting.addressCode === detail.addressCode) score += 1
                        if (userSetting.salaryJobCode && userSetting.salaryJobCode === detail.salaryJobCode) score += 1
                        if (userSetting.experienceJobCode && userSetting.experienceJobCode === detail.experienceJobCode) score += 1
                    }
                    post.matchScore = score
                    return post
                })

                // 5. Lọc và sắp xếp
                let result = scoredPost
                    .filter(post => post.matchScore > 0)
                    .sort((a, b) => b.matchScore - a.matchScore || (+b.timePost) - (+a.timePost))
                if (result.length === 0) {
                    result = scoredPost
                }
                let limit = data.limit ? +data.limit : 6
                resolve({
                    errCode: 0,
                    data: result.slice(0, limit)
                })
            }
        } catch (error) {
            reject(error)
        }
    })
}

module.exports = {
    handleCreateNewPost: handleCreateNewPost,
    handleUpdatePost: handleUpdatePost,
    handleBanPost: handleBanPost,
    handleAcceptPost: handleAcceptPost,
    getListPostByAdmin: getListPostByAdmin,
    getAllPostByAdmin: getAllPostByAdmin,
    getDetailPostById: getDetailPostById,
    handleActivePost: handleActivePost,
    getFilterPost: getFilterPost,
    getRelatedPost: getRelatedPost,
    getRecommendedPost: getRecommendedPost,
    getStatisticalTypePost: getStatisticalTypePost,
    getListNoteByPost: getListNoteByPost,
    handleReupPost: handleReupPost
}
