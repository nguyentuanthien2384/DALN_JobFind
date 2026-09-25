import db from "../models/index";
import { normalizeNotificationDestination } from '../utils/notificationDestination';
require('dotenv').config();

const pageInteger = (value, fallback, min, max) => {
    if (value === undefined) return fallback;
    if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

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
                const limit = pageInteger(data.limit, 10, 1, 50);
                const offset = pageInteger(data.offset, 0, 0, 1000000);
                if (limit === null || offset === null) {
                    resolve({ errCode: 1, errMessage: 'Phân trang thông báo không hợp lệ.' });
                    return;
                }
                let objectFilter = {
                    where: { userId: data.userId },
                    // A company can publish several jobs in the same instant.
                    // The ID breaks timestamp ties so page boundaries are stable.
                    order: [['createdAt', 'DESC'], ['id', 'DESC']],
                    raw: true,
                    limit,
                    offset
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
                    data: res.rows.map(normalizeNotificationDestination),
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
