import crypto from 'crypto';
import db from '../models';
import chatService from '../services/chatService';
import rewardService from '../services/rewardService';
import { emitNewMessage } from '../config/socket';
const { executeSupportTool, PUBLIC_TOOL_NAMES } = require('../services/supportJobTools');

export const trustedSupport = (req, res, next) => {
    const actual = Buffer.from(String(req.headers['x-internal-secret'] || ''));
    const expected = Buffer.from(process.env.INTERNAL_SECRET || '');
    if (!expected.length || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return res.sendStatus(403);
    return next();
};
export const publicTool = async (req, res) => {
    try {
        if (!PUBLIC_TOOL_NAMES.includes(req.body?.name)) return res.status(400).json({ errCode: 400 });
        const data = await executeSupportTool(req.body.name, req.body.args);
        return res.json({ errCode: 0, data });
    } catch { return res.status(503).json({ errCode: 503, errMessage: 'Chưa đọc được tin tuyển dụng.' }); }
};
export const privateTool = async (req, res) => {
    try {
        const userId = Number(req.headers['x-user-id']);
        const roleCode = String(req.headers['x-user-role'] || '');
        const companyId = Number(req.headers['x-company-id'] || 0);
        const companyStatus = String(req.headers['x-company-status'] || '');
        const companyCensor = String(req.headers['x-company-censor'] || '');
        if (!Number.isSafeInteger(userId) || userId < 1) return res.sendStatus(401);
        if (req.body?.name !== 'getMyRewards') return res.status(400).json({ errCode: 400 });

        if (roleCode === 'CANDIDATE') {
            const overview = await rewardService.getCandidateRewardOverview(userId);
            if (overview.errCode !== 0 || !overview.data) return res.status(503).json({ errCode: 503, errMessage: 'Chưa đọc được điểm thưởng.' });
            const { wallet, missions } = overview.data;
            return res.json({
                errCode: 0,
                data: {
                    title: 'Điểm thưởng & hạng thành viên',
                    lines: [
                        `Số dư hiện tại: ${wallet.balance ?? 0} điểm (${Number(wallet.valueVnd || 0).toLocaleString('vi-VN')} VNĐ)`,
                        `Hạng thành viên: ${wallet.tierLabel || 'Đồng'} (tích lũy ${wallet.lifetimeEarned ?? 0} điểm)`,
                        `Điểm danh hôm nay: ${missions?.checkedInToday ? 'Đã nhận (+1 điểm)' : 'Chưa điểm danh (+1 điểm)'}`,
                        `Thưởng hoàn thiện hồ sơ: ${missions?.profileCompletionClaimed ? 'Đã nhận (+20 điểm)' : `Hoàn thiện ${missions?.profileCompletionPercent ?? 0}% (+20 điểm khi đạt 100%)`}`
                    ],
                    href: '/candidate/info'
                }
            });
        }

        if (['COMPANY', 'EMPLOYER'].includes(roleCode)) {
            if (!Number.isSafeInteger(companyId) || companyId < 1 || companyStatus !== 'S1' || companyCensor !== 'CS1') return res.sendStatus(403);
            const overview = await rewardService.getEmployerRewardOverview(companyId, { canRedeem: roleCode === 'COMPANY' });
            if (overview.errCode !== 0 || !overview.data) return res.status(503).json({ errCode: 503, errMessage: 'Chưa đọc được quỹ lượt công ty.' });
            const { wallet, allowances } = overview.data;
            return res.json({
                errCode: 0,
                data: {
                    title: 'Top Point & Quỹ lượt công ty',
                    lines: [
                        `Số dư Top Point: ${wallet.balance ?? 0} điểm · Hạng ${wallet.tierLabel || 'Thành viên'} (x${wallet.multiplier ?? 1})`,
                        `Tin đăng còn lại: ${allowances.allowPost ?? 0} tin thường · ${allowances.allowHotPost ?? 0} tin nổi bật`,
                        `Lượt xem CV còn lại: ${allowances.allowCv ?? 0} lượt mua · ${allowances.allowCvFree ?? 0} lượt miễn phí`,
                        roleCode === 'COMPANY'
                            ? 'Quyền thao tác: Chủ công ty có thể mua gói hoặc đổi Top Point ngay'
                            : 'Quyền thao tác: Nhân viên chỉ xem — liên hệ Chủ công ty để mua gói/đổi điểm'
                    ],
                    href: '/admin/rewards'
                }
            });
        }

        return res.sendStatus(403);
    } catch {
        return res.status(503).json({ errCode: 503, errMessage: 'Chưa đọc được dữ liệu điểm thưởng.' });
    }
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
        const rawTranscript = typeof ticket.messages === 'string' ? JSON.parse(ticket.messages) : ticket.messages;
        const messages = Array.isArray(rawTranscript) ? rawTranscript : (Array.isArray(rawTranscript?.messages) ? rawTranscript.messages : []);
        const summary = messages.filter(m => m.status === 'complete').slice(-6).map(m => `${m.role === 'user' ? 'Khách' : 'Trợ lý'}: ${m.text}`).join('\n').slice(0, 1750);
        const result = await chatService.handleSendMessage({ senderId: ticket.user_id, receiverId: ticket.agent_id, clientMessageId: ticket.id, content: `[Yêu cầu hỗ trợ ${ticket.id}]\n${summary}` });
        if (result.errCode !== 0) return res.status(503).json({ errCode: 503, errMessage: 'Chưa chuyển được tin nhắn.' });
        if (!result.duplicate) emitNewMessage(result.data);
        return res.json({ errCode: 0, data: { delivered: true } });
    } catch { return res.status(503).json({ errCode: 503, errMessage: 'Yêu cầu đã lưu; vui lòng thử chuyển lại.' }); }
};
