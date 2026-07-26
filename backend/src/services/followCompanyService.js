import db from "../models/index";
const { Op } = require("sequelize");
require('dotenv').config();

// Bật / tắt theo dõi công ty (toggle)
let handleToggleFollowCompany = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.userId || !data.companyId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let follow = await db.FollowCompany.findOne({
                    where: {
                        userId: data.userId,
                        companyId: data.companyId
                    },
                    raw: false
                })
                if (follow) {
                    await follow.destroy()
                    resolve({
                        errCode: 0,
                        isFollow: false,
                        errMessage: 'Đã bỏ theo dõi công ty'
                    })
                } else {
                    let company = await db.Company.findOne({ where: { id: data.companyId } })
                    if (!company) {
                        resolve({
                            errCode: 2,
                            errMessage: 'Không tìm thấy công ty'
                        })
                    } else {
                        await db.FollowCompany.create({
                            userId: data.userId,
                            companyId: data.companyId
                        })
                        resolve({
                            errCode: 0,
                            isFollow: true,
                            errMessage: 'Đã theo dõi công ty. Bạn sẽ nhận thông báo khi công ty đăng tin mới'
                        })
                    }
                }
            }
        } catch (error) {
            reject(error)
        }
    })
}

// Kiểm tra user đã theo dõi công ty chưa (kèm tổng số người theo dõi)
let checkFollowCompany = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.companyId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let countFollower = await db.FollowCompany.count({
                    where: { companyId: data.companyId }
                })
                let isFollow = false
                if (data.userId) {
                    let follow = await db.FollowCompany.findOne({
                        where: {
                            userId: data.userId,
                            companyId: data.companyId
                        }
                    })
                    isFollow = follow ? true : false
                }
                resolve({
                    errCode: 0,
                    isFollow: isFollow,
                    countFollower: countFollower
                })
            }
        } catch (error) {
            reject(error)
        }
    })
}

// Danh sách công ty user đang theo dõi
let getFollowedCompanyByUser = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.userId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let objectFilter = {
                    where: { userId: data.userId },
                    order: [['createdAt', 'DESC']],
                    nest: true,
                    raw: true,
                    include: [
                        {
                            model: db.Company, as: 'companyFollowData',
                            attributes: ['id', 'name', 'thumbnail', 'address', 'amountEmployer']
                        }
                    ]
                }
                if (data.limit && data.offset !== undefined && data.offset !== null && data.offset !== '') {
                    objectFilter.limit = +data.limit
                    objectFilter.offset = +data.offset
                }
                let res = await db.FollowCompany.findAndCountAll(objectFilter)
                resolve({
                    errCode: 0,
                    data: res.rows,
                    count: res.count
                })
            }
        } catch (error) {
            reject(error)
        }
    })
}

module.exports = {
    handleToggleFollowCompany: handleToggleFollowCompany,
    checkFollowCompany: checkFollowCompany,
    getFollowedCompanyByUser: getFollowedCompanyByUser
}
