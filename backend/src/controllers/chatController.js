import chatService from "../services/chatService";
import { emitNewMessage, emitReadReceipt } from "../config/socket";
const protocol = require('../utils/chatProtocol');
const tracing = require('../utils/realtimeTracing');
const metrics = require('../utils/realtimeMetrics');

let handleSendMessage = (req, res) => tracing.run('http.chat.send', async (span) => {
    const traceId = tracing.id(span);
    try {
        if ((req.body.v !== undefined || req.body.clientMessageId !== undefined) && !protocol.validate('chat:send', req.body)) {
            return res.status(400).json(protocol.response(protocol.error('PAYLOAD_INVALID', 'Dữ liệu tin nhắn không hợp lệ')));
        }
        // The sender identity must always come from the verified JWT, never
        // from a value supplied by the browser.
        let data = await chatService.handleSendMessage({
            senderId: req.user.id,
            receiverId: req.body.receiverId,
            content: req.body.content,
            ...(req.body.attachmentId !== undefined ? { attachmentId: req.body.attachmentId } : {}),
            ...(req.body.jobPostId !== undefined ? { jobPostId: req.body.jobPostId } : {}),
            clientMessageId: req.body.clientMessageId
        });
        // Tin gui bang REST cung duoc day qua socket, nho vay nguoi nhan thay ngay
        // ma khong can cho vong poll. Neu socket chua san sang thi ham nay khong lam gi.
        if (data.errCode === 0 && !data.duplicate) {
            try { await tracing.run('chat.publish', async () => emitNewMessage(data.data, traceId)); }
            catch { metrics.increment('socket_publish_errors_total'); }
        }
        return res.status(data.errCode === 5 ? 403 : data.errCode === 6 ? 409 : data.errCode === 7 ? 429 : 200).json(protocol.response(data, traceId));
    } catch (error) {
        console.log(JSON.stringify({ event: 'chat:request', code: 'INTERNAL_ERROR' }))
        return res.status(200).json(protocol.response(protocol.error('INTERNAL_ERROR', 'Error from server', -1, true)))
    }
});

let getConversation = async (req, res) => {
    try {
        let data = await chatService.getConversation({
            userId: req.user.id,
            partnerId: req.query.partnerId,
            limit: req.query.limit,
            beforeId: req.query.beforeId,
            afterId: req.query.afterId
        });
        if (data.errCode === 0 && data.data?.length) {
            try { emitReadReceipt(req.user.id, Number(req.query.partnerId), data.data[data.data.length - 1].id); }
            catch { metrics.increment('socket_publish_errors_total'); }
        }
        return res.status(data.errCode === 5 ? 403 : 200).json(data);
    } catch (error) {
        console.log(JSON.stringify({ event: 'chat:request', code: 'INTERNAL_ERROR' }))
        return res.status(200).json(protocol.response(protocol.error('INTERNAL_ERROR', 'Error from server', -1, true)))
    }
}

let getListConversation = async (req, res) => {
    try {
        let data = await chatService.getListConversation({ userId: req.user.id, supportOnly: req.supportOnly });
        return res.status(200).json(data);
    } catch (error) {
        console.log(JSON.stringify({ event: 'chat:request', code: 'INTERNAL_ERROR' }))
        return res.status(200).json(protocol.response(protocol.error('INTERNAL_ERROR', 'Error from server', -1, true)))
    }
}

module.exports = {
    handleSendMessage: handleSendMessage,
    getConversation: getConversation,
    getListConversation: getListConversation
}
