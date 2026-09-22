import notificationService from "../services/notificationService";
import { getNotificationJobs as findNotificationJobs } from '../services/notificationJobService';

const getNotificationJobs = async (req, res) => {
    try {
        const data = await findNotificationJobs({
            userId: req.user.id,
            source: req.query.source,
            limit: req.query.limit,
            offset: req.query.offset
        });
        return res.status(data.errCode === 1 ? 400 : 200).json(data);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ errCode: -1, errMessage: 'Không thể tải danh sách việc làm. Vui lòng thử lại.' });
    }
};

// Thong bao la du lieu rieng cua tung tai khoan, nen userId luon lay tu token
// thay vi tin theo tham so client gui len.
let getNotificationByUser = async (req, res) => {
    try {
        let data = await notificationService.getNotificationByUser({
            ...req.query,
            userId: req.user.id
        });
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let handleMarkReadNotification = async (req, res) => {
    try {
        let data = await notificationService.handleMarkReadNotification({
            ...req.body,
            userId: req.user.id
        });
        if(data.errCode===0){
            // The SQL update is already committed. A realtime outage must not
            // turn a successful read operation into an API failure.
            try{await require('../config/socket').emitNotificationRead(req.user.id);}
            catch{require('../utils/realtimeMetrics').increment('notification_read_publish_errors_total');}
        }
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

module.exports = {
    getNotificationJobs,
    getNotificationByUser: getNotificationByUser,
    handleMarkReadNotification: handleMarkReadNotification
}
