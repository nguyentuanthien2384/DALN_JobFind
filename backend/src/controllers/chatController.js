import chatService from "../services/chatService";

let handleSendMessage = async (req, res) => {
    try {
        let data = await chatService.handleSendMessage(req.body);
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
