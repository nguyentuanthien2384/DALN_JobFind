import db from "../models/index";
import { APPROVED_COMPANY_WHERE, findPublicPost } from '../utils/publicResources';
const { Op } = require("sequelize");
require('dotenv').config();

// Bật / tắt lưu tin tuyển dụng (toggle)
let handleToggleFavoritePost = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.userId || !data.postId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let favorite = await db.FavoritePost.findOne({
                    where: {
                        userId: data.userId,
                        postId: data.postId
                    },
                    raw: false
                })
                if (favorite) {
                    await favorite.destroy()
                    resolve({
                        errCode: 0,
                        isFavorite: false,
                        errMessage: 'Đã bỏ lưu tin tuyển dụng'
                    })
                } else {
                    let post = await findPublicPost(data.postId)
                    if (!post) {
                        resolve({
                            errCode: 2,
                            errMessage: 'Không tìm thấy tin tuyển dụng'
                        })
                    } else {
                        await db.FavoritePost.create({
                            userId: data.userId,
                            postId: data.postId
                        })
                        resolve({
                            errCode: 0,
                            isFavorite: true,
                            errMessage: 'Đã lưu tin tuyển dụng'
                        })
                    }
                }
            }
        } catch (error) {
            reject(error)
        }
    })
}

// Kiểm tra 1 tin đã được user lưu hay chưa
let checkFavoriteByUser = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.userId || !data.postId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                const post = await findPublicPost(data.postId)
                if (!post) {
                    resolve({
                        errCode: 0,
                        isFavorite: false
                    })
                    return
                }
                let favorite = await db.FavoritePost.findOne({
                    where: {
                        userId: data.userId,
                        postId: data.postId
                    }
                })
                resolve({
                    errCode: 0,
                    isFavorite: favorite ? true : false
                })
            }
        } catch (error) {
            reject(error)
        }
    })
}

// Lấy danh sách tin đã lưu của user (kèm chi tiết tin + công ty)
let getFavoritePostByUser = (data) => {
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
                            model: db.Post, as: 'postFavoriteData',
                            where: { statusCode: 'PS1' },
                            required: true,
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
                                    attributes: ['id', 'firstName', 'lastName', 'image', 'companyId'],
                                    required: true,
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
                            ]
                        }
                    ]
                }
                if (data.limit && data.offset !== undefined && data.offset !== null && data.offset !== '') {
                    objectFilter.limit = +data.limit
                    objectFilter.offset = +data.offset
                }
                let res = await db.FavoritePost.findAndCountAll(objectFilter)
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
    handleToggleFavoritePost: handleToggleFavoritePost,
    checkFavoriteByUser: checkFavoriteByUser,
    getFavoritePostByUser: getFavoritePostByUser
}
