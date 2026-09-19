import crypto from 'crypto';
import db from '../models';
import chatService from '../services/chatService';
import { emitNewMessage } from '../config/socket';
const { executeSupportTool } = require('../services/supportJobTools');

export const trustedSupport = (req, res, next) => {
    const actual = Buffer.from(String(req.headers['x-internal-secret'] || ''));
    const expected = Buffer.from(process.env.INTERNAL_SECRET || '');
    if (!expected.length || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return res.sendStatus(403);
    return next();
};
export const publicTool = async (req, res) => {
    try {
        if (!['search_jobs', 'get_job_details'].includes(req.body?.name)) return res.status(400).json({ errCode: 400 });
        const data = await executeSupportTool(req.body.name, req.body.args);
        return res.json({ errCode: 0, data });
    } catch { return res.status(503).json({ errCode: 503, errMessage: 'Chưa đọc được tin tuyển dụng.' }); }
};
export const deliverHandoff = async (req, res) => {
    try {
        const agentId = Number(req.headers['x-user-id']);
        if (!Number.isSafeInteger(agentId) || agentId < 1) return res.sendStatus(403);
        const account = await db.Account.findOne({ where: { userId: agentId, roleCode: 'ADMIN', statusCode: 'S1' }, attributes: ['userId'] });
        if (!account || !/^[a-f0-9-]{36}$/i.test(req.body?.ticketId || '')) return res.sendStatus(403);
        // The sender, recipient and transcript come only from the durable, explicitly requested ticket.
        const [rows] = await db.sequelize.query(`SELECT h.id,h.user_id,h.agent_id,h.transcript AS messages FROM support_handoffs h JOIN support_conversations c ON c.id=h.conversation_id WHERE h.id=:id AND h.agent_id=:agent AND h.status='assigned' AND c.expires_at>:now`, { replacements: { id: req.body.ticketId, agent: agentId, now: Date.now() } });
        if (!rows.length) return res.sendStatus(404);
        const ticket = rows[0];
        const messages = typeof ticket.messages === 'string' ? JSON.parse(ticket.messages) : ticket.messages;
        const summary = messages.filter(m => m.status === 'complete').slice(-6).map(m => `${m.role === 'user' ? 'Khách' : 'Trợ lý'}: ${m.text}`).join('\n').slice(0, 1750);
        const result = await chatService.handleSendMessage({ senderId: ticket.user_id, receiverId: ticket.agent_id, clientMessageId: ticket.id, content: `[Yêu cầu hỗ trợ ${ticket.id}]\n${summary}` });
        if (result.errCode !== 0) return res.status(503).json({ errCode: 503, errMessage: 'Chưa chuyển được tin nhắn.' });
        if (!result.duplicate) emitNewMessage(result.data);
        return res.json({ errCode: 0, data: { delivered: true } });
    } catch { return res.status(503).json({ errCode: 503, errMessage: 'Yêu cầu đã lưu; vui lòng thử chuyển lại.' }); }
};
