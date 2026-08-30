import db from "../models/index";
const { Op, and } = require("sequelize");
import paypal, { order } from 'paypal-rest-sdk'
require('dotenv').config();
paypal.configure({
    'mode': 'sandbox',
    'client_id': process.env.CLIENT_ID,
    'client_secret': process.env.CLIENT_SECRET
});

let getAllPackage = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.limit || data.offset === undefined || data.offset === null || data.offset === '') {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let objectFilter = {
                    offset: +data.offset,
                    limit: +data.limit
                }
                if (data.search) {
                    objectFilter.where = {name: {[Op.like]: `%${data.search}%`}}
                }
                let packagePosts = await db.PackagePost.findAndCountAll(objectFilter)
                resolve({
                    errCode: 0,
                    data: packagePosts.rows,
                    count: packagePosts.count
                })
            }
        } catch (error) {
            reject(error)
        }
    })
}

let getPackageByType = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (data.isHot === '') {
                resolve({
                    errCode: 1,
                    errMessage: `Missing required parameters !`
                })
            } else {
                let packagePost = await db.PackagePost.findAll({
                    where: { isHot: data.isHot, isActive: 1 }
                })
                resolve({
                    errCode: 0,
                    data: packagePost
                })
            }

        } catch (error) {
            reject(error)
        }
    })
}

let getPackageById = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.id) {
                resolve({
                    errCode: 1,
                    errMessage: `Missing required parameters !`
                })
            } else {
                let packagePost = await db.PackagePost.findOne({
                    where: { id: data.id }
                })
                if (packagePost) {
                    resolve({
                        errCode: 0,
                        data: packagePost
                    })
                }
                else {
                    resolve({
                        errCode: 0,
                        errMessage: 'Không tìm thấy dữ liệu gói sản phẩm'
                    })
                }
            }

        } catch (error) {
            reject(error)
        }
    })
}

let getPaymentLink = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            const amount = Number(data.amount)
            if (!data.id || !Number.isFinite(amount) || amount <= 0) {
                resolve({
                    errCode: 1,
                    errMessage: `Missing required parameters !`

                })
            }
            else {
                let infoItem = await db.PackagePost.findOne({
                    where: { id: data.id }
                })
                if (!infoItem || Number(infoItem.isActive) === 0) {
                    resolve({
                        errCode: 2,
                        errMessage: 'Gói bài đăng không tồn tại hoặc đã ngừng kinh doanh'
                    })
                    return
                }
                let item = [{
                    "name": `${infoItem.name}`,
                    "sku": infoItem.id,
                    "price": infoItem.price,
                    "currency": "USD",
                    "quantity": amount
                }]
                const frontendUrl = (process.env.URL_REACT || 'http://localhost:3000')
                    .split(',')[0].trim().replace(/\/$/, '')

                let create_payment_json = {
                    "intent": "sale",
                    "payer": {
                        "payment_method": "paypal"
                    },
                    "redirect_urls": {
                        "return_url": `${frontendUrl}/admin/payment/success`,
                        "cancel_url": `${frontendUrl}/admin/payment/cancel`
                    },
                    "transactions": [{
                        "item_list": {
                            "items": item
                        },
                        "amount": {
                            "currency": "USD",
                            "total": amount * infoItem.price
                        },
                        "description": "This is the payment description."
                    }]
                };

                paypal.payment.create(create_payment_json, function (error, payment) {
                    if (error) {
                        resolve({
                            errCode: -1,
                            errMessage: error.message || 'Không thể tạo giao dịch PayPal',
                        })

                    } else {
                        resolve({
                            errCode: 0,
                            link: payment.links[1].href
                        })

                    }
                });
            }
        } catch (error) {
            reject(error)
        }
    })
}

let paymentOrderSuccess = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            const amount = Number(data.amount)
            if (!data.PayerID || !data.paymentId || !data.token || !data.packageId
                || !data.userId || !Number.isFinite(amount) || amount <= 0) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameter !'
                })
            } else {
                let infoItem = await db.PackagePost.findOne({
                    where: { id: data.packageId }
                })
                if (!infoItem || Number(infoItem.isActive) === 0) {
                    resolve({
                        errCode: 2,
                        errMessage: 'Gói bài đăng không tồn tại hoặc đã ngừng kinh doanh'
                    })
                    return
                }

                // Validate the authenticated purchaser and target company before
                // asking PayPal to execute the charge. This prevents recording an
                // order for a missing/spoofed account after money was captured.
                let user = await db.User.findOne({
                    where: { id: data.userId },
                    attributes: {
                        exclude: ['userId']
                    }
                })
                if (!user || !user.companyId) {
                    resolve({
                        errCode: 2,
                        errMessage: 'Người dùng không thuộc công ty'
                    })
                    return
                }
                let company = await db.Company.findOne({
                    where: { id: user.companyId },
                    raw: false
                })
                if (!company) {
                    resolve({
                        errCode: 2,
                        errMessage: 'Không tìm thấy công ty'
                    })
                    return
                }
                let execute_payment_json = {
                    "payer_id": data.PayerID,
                    "transactions": [{
                        "amount": {
                            "currency": "USD",
                            "total": amount * infoItem.price
                        }
                    }]
                };

                let paymentId = data.paymentId;

                paypal.payment.execute(paymentId, execute_payment_json, async function (error, payment) {
                    if (error) {
                        resolve({
                            errCode: -1,
                            errMessage: error.message || 'PayPal từ chối giao dịch'
                        })
                    } else {
                        try {
                            let orderPackage = await db.OrderPackage.create({
                                packagePostId: data.packageId,
                                userId: data.userId,
                                currentPrice: infoItem.price,
                                amount: amount
                            })
                            if (!orderPackage) {
                                resolve({
                                    errCode: 2,
                                    errMessage: 'Không thể ghi nhận lịch sử mua gói'
                                })
                                return
                            }
                            if (infoItem.isHot == 0) {
                                company.allowPost += +infoItem.value * amount
                            }
                            else {
                                company.allowHotPost += +infoItem.value * amount
                            }
                            await company.save({silent: true})
                            resolve({
                                errCode: 0,
                                errMessage: 'Hệ thống đã ghi nhận lịch sử mua của bạn'
                            })
                        } catch (callbackError) {
                            reject(callbackError)
                        }
                    }
                });
            }
        } catch (error) {
            reject(error)
        }
    })
}

let setActiveTypePackage = (data) => {
    return new Promise(async (resolve, reject) => {
        try {

            if (!data.id || data.isActive === '') {
                resolve({
                    errCode: 1,
                    errMessage: `Missing required parameters !`
                })
            } else {
                let packagePost = await db.PackagePost.findOne({
                    where: { id: data.id },
                    raw: false
                })
                if (!packagePost) {
                    resolve({
                        errCode: 2,
                        errMessage: `Gói sản phẩm không tồn tại`
                    })
                }
                else {
                    packagePost.isActive = data.isActive
                    await packagePost.save()
                    resolve({
                        errCode: 0,
                        errMessage: data.isActive == 0 ? `Gói sản phẩm đã ngừng kích hoạt` : `Gói sản phẩm đã hoạt động`
                    })

                }
            }

        } catch (error) {
            reject(error)
        }
    })
}

let creatNewPackagePost = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.name || !data.price || !data.value || data.isHot === '') {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let packagePost = await db.PackagePost.create({
                    name: data.name,
                    value: data.value,
                    isHot: data.isHot,
                    price: data.price,
                    isActive: 1
                })
                if (packagePost) {
                    resolve({
                        errCode: 0,
                        errMessage: 'Tạo gói sản phẩm thành công'
                    })
                }
                else {
                    resolve({
                        errCode: 2,
                        errMessage: 'Tạo gói sản phẩm thất bại'
                    })
                }
            }
        } catch (error) {
            if (error.message.includes('Validation error')) {
                resolve({
                    errCode: 2,
                    errMessage: 'Tên gói sản phẩm đã tồn tại'
                })
            }
            else {
                reject(error)
            }
        }
    })
}

let updatePackagePost = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.name || !data.price || !data.value || data.isHot === '' || !data.id) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let packagePost = await db.PackagePost.findOne({
                    where: { id: data.id },
                    raw: false
                })
                if (packagePost) {
                    packagePost.name = data.name
                    packagePost.price = data.price
                    packagePost.value = data.value
                    packagePost.isHot = data.isHot
                    await packagePost.save()
                    resolve({
                        errCode: 0,
                        errMessage: 'Cập nhật thành công'
                    })
                }
                else {
                    resolve({
                        errCode: 2,
                        errMessage: 'Cập nhật thất bại'
                    })
                }
            }
        } catch (error) {
            if (error.message.includes('Validation error')) {
                resolve({
                    errCode: 2,
                    errMessage: 'Tên gói sản phẩm đã tồn tại'
                })
            }
            else {
                reject(error)
            }
        }
    })
}

let getStatisticalPackage = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.fromDate || !data.toDate) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            }
            else {
                let filterListPackage = {}
                if (data.limit && data.offset !== undefined && data.offset !== null && data.offset !== '') {
                    filterListPackage.limit = +data.limit
                    filterListPackage.offset = +data.offset
                }
                let listPackage = await db.PackagePost.findAndCountAll(filterListPackage)
                let listOrderPackage = await db.OrderPackage.findAll({
                    where: {
                        createdAt: { [Op.and]: [{ [Op.gte]: `${data.fromDate} 00:00:00` }, { [Op.lte]: `${data.toDate} 23:59:59` }] }
                    },
                    attributes: ['packagePostId',[db.sequelize.literal('SUM(amount)'), 'count'],[db.sequelize.literal('SUM(currentPrice * amount)'), 'total']],
                    order: [[db.Sequelize.literal('total'), 'DESC']],
                    group: ['packagePostId'],
                    nest: true,
                })
                const sum = listOrderPackage.reduce(
                    (previousValue, currentValue) => previousValue + currentValue.total,
                    0
                  );
                listPackage.rows = listPackage.rows.map(packagePost => {
                    let count = 1
                    let length = listOrderPackage.length
                    if (length == 0) {
                        return {
                            ...packagePost,
                            count: 0,
                            total: 0
                        }
                    }
                    for (let order of listOrderPackage) {
                        if (order.packagePostId == packagePost.id) {
                            return {
                                ...packagePost,
                                count: order.count,
                                total: order.total
                            }
                        }
                        else if (count == length) {
                            return {
                                ...packagePost,
                                total: 0,
                                count: 0
                            }
                        }
                        count++
                    }
                }
                )
                resolve({
                    errCode: 0,
                    data: listPackage.rows,
                    count: listPackage.count,
                    sum: sum
                })
            }
        }
        catch (error) {
            reject(error)
        }
    })
}

let getHistoryTrade = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.companyId) {
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
                        attributes: {
                            exclude: ['packageCvId']
                        },
                        where: {
                            [Op.and]: [{ [Op.or]: listUserOfCompany }]
                        },
                        order: [['updatedAt', 'DESC']],
                        nest: true,
                        raw: true,
                        include: [
                            { model: db.User, as: 'userOrderData',
                                attributes: {
                                    exclude: ['userId']
                                },
                            },
                            { model: db.PackagePost, as: 'packageOrderData'}
                        ]
                    }

                    if (data.limit && data.offset !== undefined && data.offset !== null && data.offset !== '') {
                        objectFilter = {
                            ...objectFilter,
                            limit: +data.limit,
                            offset: +data.offset
                        }
                    }

                    if (data.fromDate && data.toDate) {
                        objectFilter.where = {
                            ...objectFilter.where,
                            createdAt: { [Op.and]: [{ [Op.gte]: `${data.fromDate} 00:00:00` }, { [Op.lte]: `${data.toDate} 23:59:59` }] }
                        }
                    }

                    let res = await db.OrderPackage.findAndCountAll(objectFilter)

                    resolve({
                        errCode: 0,
                        data: res.rows,
                        count: res.count
                    })
                }
            }
        } catch (error) {
            reject(error)
        }
    })
}

let getSumByYear = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.year) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                    let objectFilter = {
                        attributes: [[db.sequelize.literal('SUM(currentPrice * amount)'), 'total'], [db.sequelize.fn('MONTH', db.sequelize.col('createdAt')),'month']],
                        where: {
                            [Op.and]: [
                                db.sequelize.where(db.sequelize.fn('YEAR', db.sequelize.col('createdAt')), data.year),
                            ],
                        },
                        group: db.sequelize.fn('MONTH', db.sequelize.col('createdAt'))
                    }

                    let res = await db.OrderPackage.findAll(objectFilter)

                    resolve({
                        errCode: 0,
                        data: res
                    })
                
            }
        } catch (error) {
            reject(error)
        }
    })
}
module.exports = {
    getPackageByType, getPaymentLink, paymentOrderSuccess, getAllPackage, setActiveTypePackage,
    getPackageById, creatNewPackagePost, updatePackagePost, getStatisticalPackage, getHistoryTrade,
    getSumByYear
}
