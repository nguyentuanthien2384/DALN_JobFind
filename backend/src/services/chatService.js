import db from "../models/index";
const { Op, QueryTypes } = require("sequelize");
const protocol = require("../utils/chatProtocol");
const limiter = require("../utils/realtimeLimiter");
require('dotenv').config();

const RECRUITER_ROLES = new Set(['COMPANY', 'EMPLOYER']);

const loadChatParticipants = async (senderId, receiverId) => db.User.findAll({
    where: { id: { [Op.in]: [Number(senderId), Number(receiverId)] } },
    attributes: ['id', 'companyId'],
    include: [
        {
            model: db.Account,
            as: 'userAccountData',
            attributes: ['roleCode', 'statusCode'],
            required: true
        },
        {
            model: db.Company,
            as: 'userCompanyData',
            attributes: ['id', 'statusCode', 'censorCode'],
            required: false
        }
    ],
    raw: true,
    nest: true
});

const canParticipantsChat = async (senderId, receiverId) => {
    const participants = await loadChatParticipants(senderId, receiverId);
    const sender = participants.find((user) => Number(user.id) === Number(senderId));
    const receiver = participants.find((user) => Number(user.id) === Number(receiverId));
    if (!sender || !receiver) return { allowed: false, missingReceiver: !receiver };

    const active = (user) => user.userAccountData?.statusCode === 'S1';
    const role = (user) => user.userAccountData?.roleCode;
    const recruiterIsApproved = (user) => RECRUITER_ROLES.has(role(user))
        && user.companyId !== null
        && user.companyId !== undefined
        && Number(user.userCompanyData?.id) === Number(user.companyId)
        && user.userCompanyData?.statusCode === 'S1'
        && user.userCompanyData?.censorCode === 'CS1';

    if (!active(sender) || !active(receiver)) return { allowed: false };

    // ADMIN is a super-admin and may open or answer a support/moderation
    // conversation with any other active account.
    const adminParticipant = role(sender) === 'ADMIN' || role(receiver) === 'ADMIN';
    if (adminParticipant) return { allowed: true };

    const candidateAndRecruiter = (
        role(sender) === 'CANDIDATE' && recruiterIsApproved(receiver)
    ) || (
        role(receiver) === 'CANDIDATE' && recruiterIsApproved(sender)
    );
    return { allowed: candidateAndRecruiter };
};

// Gửi tin nhắn
let handleSendMessage = async (data) => {
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    const senderId = Number(data.senderId), receiverId = Number(data.receiverId);
    if (!Number.isSafeInteger(senderId) || senderId <= 0 || !Number.isSafeInteger(receiverId) || receiverId <= 0 || !content)
        return protocol.error('PAYLOAD_INVALID', 'Missing required parameters !');
    if (content.length > 2000) return protocol.error('CHAT_MESSAGE_TOO_LONG', 'Tin nhắn không được vượt quá 2.000 ký tự', 4);
    if (senderId === receiverId) return protocol.error('CHAT_NOT_ALLOWED', 'Không thể tự gửi tin nhắn cho chính mình', 2);
    const clientMessageId = data.clientMessageId;
    if (clientMessageId !== undefined && !protocol.validate('chat:send', { receiverId, content, clientMessageId }))
        return protocol.error('PAYLOAD_INVALID', 'Mã tin nhắn không hợp lệ');
    const attempts = await limiter.consume(`send-attempt:${senderId}`, 120, 60000);
    if (!attempts.allowed) return protocol.error('RATE_LIMITED', 'Bạn thao tác quá nhanh', 7, true, { retryAfterMs: attempts.retryAfterMs });
    const relationship = await canParticipantsChat(senderId, receiverId);
    if (relationship.missingReceiver) return protocol.error('CHAT_RECEIVER_NOT_FOUND', 'Không tìm thấy người nhận', 3);
    if (!relationship.allowed) return protocol.error('CHAT_NOT_ALLOWED', 'Chỉ ứng viên và nhà tuyển dụng thuộc công ty đã duyệt mới được nhắn tin với nhau', 5);
    const replay = (message) => Number(message.receiverId) === receiverId && message.content === content
        ? { errCode: 0, data: message, duplicate: true }
        : protocol.error('IDEMPOTENCY_CONFLICT', 'Mã gửi lại đã được sử dụng cho một tin nhắn khác', 6);
    const where = { senderId, clientMessageId };
    if (clientMessageId) {
        const existing = await db.ChatMessage.findOne({ where });
        if (existing) return replay(existing);
    }
    const rate = await limiter.consume(`send:${senderId}`, 30, 60000);
    if (!rate.allowed) return protocol.error('RATE_LIMITED', 'Bạn gửi quá nhanh. Vui lòng thử lại sau.', 7, true, { retryAfterMs: rate.retryAfterMs });
    try {
        const message = await db.ChatMessage.create({ senderId, receiverId, content, isRead: 0,
            ...(clientMessageId ? { clientMessageId } : {}) });
        return { errCode: 0, data: message, errMessage: 'Gửi tin nhắn thành công' };
    } catch (error) {
        if (clientMessageId && error.name === 'SequelizeUniqueConstraintError') {
            const existing = await db.ChatMessage.findOne({ where });
            if (existing) return replay(existing);
        }
        throw error;
    }
};

// Lấy hội thoại giữa 2 user (đồng thời đánh dấu tin nhận được là đã đọc)
// Shared by the REST and Socket.IO paths so read state is persisted consistently.
let markConversationRead = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.userId || !data.partnerId) {
                return resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            }
            const relationship = await canParticipantsChat(data.userId, data.partnerId);
            if (!relationship.allowed) return resolve(protocol.error('CHAT_NOT_ALLOWED', 'Bạn không có quyền mở cuộc trò chuyện này', 5));
            const [updatedCount] = await db.ChatMessage.update(
                { isRead: 1 },
                {
                    where: {
                        senderId: data.partnerId,
                        receiverId: data.userId,
                        isRead: 0,
                        ...(data.throughMessageId ? { id: { [Op.lte]: data.throughMessageId } } : {})
                    }
                }
            )
            resolve({ errCode: 0, updatedCount })
        } catch (error) {
            reject(error)
        }
    })
}

let getConversation = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.userId || !data.partnerId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                const relationship = await canParticipantsChat(data.userId, data.partnerId)
                if (!relationship.allowed) {
                    resolve({
                        errCode: 5,
                        errMessage: 'Bạn không có quyền mở cuộc trò chuyện này'
                    })
                    return
                }
                let messages = await db.ChatMessage.findAll({
                    where: {
                        [Op.or]: [
                            { senderId: data.userId, receiverId: data.partnerId },
                            { senderId: data.partnerId, receiverId: data.userId }
                        ]
                    },
                    // Query the newest records first; an old conversation must
                    // not hide new messages after it grows past 100 entries.
                    order: [['id', 'DESC']],
                    limit: Math.min(Math.max(Number(data.limit) || 100, 1), 200),
                    raw: true
                })
                messages.reverse()
                // Mark only the snapshot that was actually returned. A newer message
                // arriving while the query runs must not be marked read accidentally.
                if (messages.length) await markConversationRead({ ...data, throughMessageId: messages[messages.length - 1].id });
                let partner = await db.User.findOne({
                    where: { id: data.partnerId },
                    attributes: ['id', 'firstName', 'lastName', 'image'],
                    nest: true,
                    raw: true,
                    include: [
                        { model: db.Company, as: 'userCompanyData', attributes: ['id', 'name', 'thumbnail'] }
                    ]
                })
                resolve({
                    errCode: 0,
                    data: messages,
                    partnerData: partner
                })
            }
        } catch (error) {
            reject(error)
        }
    })
}

// Danh sách hội thoại của user (tin nhắn mới nhất + số chưa đọc theo từng người)
let getListConversation = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.userId) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                // Aggregate in SQL: transfer one row per partner instead of the
                // entire history. Parameters are bound, never interpolated.
                const summaries = await db.sequelize.query(`
                    SELECT partnerId, MAX(id) AS lastMessageId, SUM(unread) AS unreadCount
                    FROM (
                        SELECT receiverId AS partnerId, id, 0 AS unread
                        FROM ChatMessages WHERE senderId = :userId
                        UNION ALL
                        SELECT senderId AS partnerId, id, CASE WHEN isRead = 0 THEN 1 ELSE 0 END AS unread
                        FROM ChatMessages WHERE receiverId = :userId
                    ) AS messages GROUP BY partnerId`, {
                    replacements: { userId: Number(data.userId) }, type: QueryTypes.SELECT,
                });
                const latest = summaries.length ? await db.ChatMessage.findAll({
                    where: { id: { [Op.in]: summaries.map((row) => row.lastMessageId) } }, raw: true,
                }) : [];
                const byId = new Map(latest.map((message) => [Number(message.id), message]));
                const mapConversation = Object.fromEntries(summaries.map((row) => [row.partnerId, {
                    partnerId: Number(row.partnerId), lastMessage: byId.get(Number(row.lastMessageId)), unreadCount: Number(row.unreadCount),
                }]).filter(([, value]) => value.lastMessage));
                let listPartnerId = Object.keys(mapConversation)
                let listPartner = await db.User.findAll({
                    where: { id: listPartnerId },
                    attributes: ['id', 'firstName', 'lastName', 'image'],
                    nest: true,
                    raw: true,
                    include: [
                        { model: db.Company, as: 'userCompanyData', attributes: ['id', 'name', 'thumbnail'] }
                    ]
                })
                let result = Object.values(mapConversation).map(item => {
                    item.partnerData = listPartner.find(user => +user.id === +item.partnerId)
                    return item
                })
                // Sắp xếp theo tin nhắn mới nhất
                result.sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt))
                let totalUnread = result.reduce((sum, item) => sum + item.unreadCount, 0)
                resolve({
                    errCode: 0,
                    data: result,
                    totalUnread: totalUnread
                })
            }
        } catch (error) {
            reject(error)
        }
    })
}

module.exports = {
    canParticipantsChat,
    handleSendMessage: handleSendMessage,
    getConversation: getConversation,
    getListConversation: getListConversation,
    markConversationRead: markConversationRead
}
