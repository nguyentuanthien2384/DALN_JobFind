import db from "../models/index";
const { Op } = require("sequelize");
require('dotenv').config();

// Gửi tin nhắn
let handleSendMessage = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            const content = typeof data.content === 'string' ? data.content.trim() : ''
            if (!data.senderId || !data.receiverId || !content) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters !'
                })
            } else if (content.length > 2000) {
                resolve({
                    errCode: 4,
                    errMessage: 'Tin nhắn không được vượt quá 2.000 ký tự'
                })
            } else if (+data.senderId === +data.receiverId) {
                resolve({
                    errCode: 2,
                    errMessage: 'Không thể tự gửi tin nhắn cho chính mình'
                })
            } else {
                let receiver = await db.User.findOne({
                    where: { id: data.receiverId },
                    attributes: {
                        exclude: ['userId']
                    }
                })
                if (!receiver) {
                    resolve({
                        errCode: 3,
                        errMessage: 'Không tìm thấy người nhận'
                    })
                } else {
                    let message = await db.ChatMessage.create({
                        senderId: data.senderId,
                        receiverId: data.receiverId,
                        content: content,
                        isRead: 0
                    })
                    resolve({
                        errCode: 0,
                        data: message,
                        errMessage: 'Gửi tin nhắn thành công'
                    })
                }
            }
        } catch (error) {
            reject(error)
        }
    })
}

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
            const [updatedCount] = await db.ChatMessage.update(
                { isRead: 1 },
                {
                    where: {
                        senderId: data.partnerId,
                        receiverId: data.userId,
                        isRead: 0
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
                await markConversationRead(data)
                let messages = await db.ChatMessage.findAll({
                    where: {
                        [Op.or]: [
                            { senderId: data.userId, receiverId: data.partnerId },
                            { senderId: data.partnerId, receiverId: data.userId }
                        ]
                    },
                    // Query the newest records first; an old conversation must
                    // not hide new messages after it grows past 100 entries.
                    order: [['createdAt', 'DESC']],
                    limit: Math.min(Math.max(Number(data.limit) || 100, 1), 200),
                    raw: true
                })
                messages.reverse()
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
                let messages = await db.ChatMessage.findAll({
                    where: {
                        [Op.or]: [
                            { senderId: data.userId },
                            { receiverId: data.userId }
                        ]
                    },
                    order: [['createdAt', 'DESC']],
                    raw: true
                })
                // Gom nhóm theo đối phương, giữ tin mới nhất + đếm chưa đọc
                let mapConversation = {}
                messages.forEach(item => {
                    let partnerId = +item.senderId === +data.userId ? item.receiverId : item.senderId
                    if (!mapConversation[partnerId]) {
                        mapConversation[partnerId] = {
                            partnerId: partnerId,
                            lastMessage: item,
                            unreadCount: 0
                        }
                    }
                    if (+item.receiverId === +data.userId && +item.isRead === 0) {
                        mapConversation[partnerId].unreadCount += 1
                    }
                })
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
    handleSendMessage: handleSendMessage,
    getConversation: getConversation,
    getListConversation: getListConversation,
    markConversationRead: markConversationRead
}
