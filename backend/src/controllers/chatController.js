import chatService from "../services/chatService";
import { emitNewMessage } from "../config/socket";

let handleSendMessage = async (req, res) => {
    try {
        let data = await chatService.handleSendMessage(req.body);
        // Tin gui bang REST cung duoc day qua socket, nho vay nguoi nhan thay ngay
        // ma khong can cho vong poll. Neu socket chua san sang thi ham nay khong lam gi.
        if (data.errCode === 0) {
            emitNewMessage(data.data);
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

let getConversation = async (req, res) => {
    try {
        let data = await chatService.getConversation(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let getListConversation = async (req, res) => {
    try {
        let data = await chatService.getListConversation(req.query);
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
    handleSendMessage: handleSendMessage,
    getConversation: getConversation,
    getListConversation: getListConversation
}
