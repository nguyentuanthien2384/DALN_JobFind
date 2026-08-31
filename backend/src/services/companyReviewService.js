import db from "../models/index";
import { findPublicCompany } from '../utils/publicResources';
const { Op } = require("sequelize");
require('dotenv').config();

// Tạo mới hoặc cập nhật đánh giá (mỗi user chỉ có 1 đánh giá / công ty)
let handleCreateReview = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.userId || !data.companyId || !data.star) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else if (+data.star < 1 || +data.star > 5) {
                resolve({
                    errCode: 2,
                    errMessage: 'Số sao đánh giá phải từ 1 đến 5'
                })
            } else {
                let company = await findPublicCompany(data.companyId)
                if (!company) {
                    resolve({
                        errCode: 3,
                        errMessage: 'Không tìm thấy công ty'
                    })
                } else {
                    let review = await db.CompanyReview.findOne({
                        where: {
                            userId: data.userId,
                            companyId: data.companyId
                        },
                        raw: false
                    })
                    if (review) {
                        review.star = +data.star
                        review.content = data.content ? data.content : review.content
                        await review.save()
                        resolve({
                            errCode: 0,
                            errMessage: 'Cập nhật đánh giá thành công'
                        })
                    } else {
                        await db.CompanyReview.create({
                            userId: data.userId,
                            companyId: data.companyId,
                            star: +data.star,
                            content: data.content ? data.content : ''
                        })
                        resolve({
                            errCode: 0,
                            errMessage: 'Gửi đánh giá thành công'
                        })
                    }
                }
            }
        } catch (error) {
            reject(error)
        }
    })
}

// Lấy danh sách đánh giá của công ty (kèm điểm trung bình)
let getReviewByCompany = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.companyId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                const company = await findPublicCompany(data.companyId)
                if (!company) {
                    resolve({
                        errCode: 3,
                        errMessage: 'Không tìm thấy công ty'
                    })
                    return
                }
                let objectFilter = {
                    where: { companyId: data.companyId },
                    order: [['createdAt', 'DESC']],
                    nest: true,
                    raw: true,
                    include: [
                        {
                            model: db.User, as: 'userReviewData',
                            attributes: ['id', 'firstName', 'lastName', 'image']
                        }
                    ]
                }
                if (data.limit && data.offset !== undefined && data.offset !== null && data.offset !== '') {
                    objectFilter.limit = +data.limit
                    objectFilter.offset = +data.offset
                }
                let res = await db.CompanyReview.findAndCountAll(objectFilter)
                let sumStar = await db.CompanyReview.sum('star', {
                    where: { companyId: data.companyId }
                })
                let countAll = await db.CompanyReview.count({
                    where: { companyId: data.companyId }
                })
                resolve({
                    errCode: 0,
                    data: res.rows,
                    count: countAll,
                    averageStar: countAll > 0 ? Math.round((sumStar / countAll) * 10) / 10 : 0
                })
            }
        } catch (error) {
            reject(error)
        }
    })
}

// Xóa đánh giá (chủ đánh giá hoặc admin)
let handleDeleteReview = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.id || !data.userId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let review = await db.CompanyReview.findOne({
                    where: { id: data.id },
                    raw: false
                })
                if (!review) {
                    resolve({
                        errCode: 2,
                        errMessage: 'Không tìm thấy đánh giá'
                    })
                } else {
                    let account = await db.Account.findOne({
                        where: { userId: data.userId }
                    })
                    let isAdmin = account && account.roleCode === 'ADMIN'
                    if (+review.userId !== +data.userId && !isAdmin) {
                        resolve({
                            errCode: 3,
                            errMessage: 'Bạn không có quyền xóa đánh giá này'
                        })
                    } else {
                        await review.destroy()
                        resolve({
                            errCode: 0,
                            errMessage: 'Xóa đánh giá thành công'
                        })
                    }
                }
            }
        } catch (error) {
            reject(error)
        }
    })
}

module.exports = {
    handleCreateReview: handleCreateReview,
    getReviewByCompany: getReviewByCompany,
    handleDeleteReview: handleDeleteReview
}
