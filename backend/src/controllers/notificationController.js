import notificationService from "../services/notificationService";

let getNotificationByUser = async (req, res) => {
    try {
        let data = await notificationService.getNotificationByUser(req.query);
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
        let data = await notificationService.handleMarkReadNotification(req.body);
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
