import notificationService from "../services/notificationService";

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
    getNotificationByUser: getNotificationByUser,
    handleMarkReadNotification: handleMarkReadNotification
}
