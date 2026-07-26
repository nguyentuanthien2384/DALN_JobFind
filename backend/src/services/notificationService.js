import db from "../models/index";
const { Op } = require("sequelize");
require('dotenv').config();

// Lấy danh sách thông báo của user (kèm số chưa đọc)
let getNotificationByUser = (data) => {
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
                    raw: true
                }
                if (data.limit && data.offset !== undefined && data.offset !== null && data.offset !== '') {
                    objectFilter.limit = +data.limit
                    objectFilter.offset = +data.offset
                }
                let res = await db.Notification.findAndCountAll(objectFilter)
                let unreadCount = await db.Notification.count({
                    where: {
                        userId: data.userId,
                        isChecked: 0
                    }
                })
                resolve({
                    errCode: 0,
                    data: res.rows,
                    count: res.count,
                    unreadCount: unreadCount
                })
            }
        } catch (error) {
            reject(error)
        }
    })
}

// Đánh dấu đã đọc (1 thông báo hoặc tất cả)
let handleMarkReadNotification = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.userId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                let whereCondition = { userId: data.userId }
                if (data.id) whereCondition.id = data.id
                await db.Notification.update(
                    { isChecked: 1 },
                    { where: whereCondition }
                )
                resolve({
                    errCode: 0,
                    errMessage: 'Đã đánh dấu đã đọc'
                })
            }
        } catch (error) {
            reject(error)
        }
    })
}

module.exports = {
    getNotificationByUser: getNotificationByUser,
    handleMarkReadNotification: handleMarkReadNotification
}
