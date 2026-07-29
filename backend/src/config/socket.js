import { Server } from "socket.io";
import chatService from "../services/chatService";
const jwt = require('jsonwebtoken');
require('dotenv').config();

/**
 * Tang realtime cho tinh nang chat (Socket.IO).
 *
 * Thiet ke: KHONG thay the API REST san co. Cac endpoint
 * /api/send-chat-message, /api/get-chat-conversation... van hoat dong y nguyen,
 * nen neu socket khong ket noi duoc thi giao dien tu quay ve co che poll cu.
 * Socket chi lam nhiem vu day tin nhan den nguoi nhan ngay lap tuc.
 *
 * Moi user duoc cho vao mot "room" rieng ten `user:<id>`, nho vay muon gui cho
 * ai chi can emit vao room cua nguoi do, khong phai tu quan ly danh sach socket.
 */

let io = null;

// Lay userId tu token JWT trong handshake. Tra ve null neu token sai/thieu.
const getUserIdFromHandshake = (socket) => {
    const raw = (socket.handshake.auth && socket.handshake.auth.token)
        || socket.handshake.query.token;
    if (!raw) return null;
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        return payload.sub;
    } catch (error) {
        return null;
    }
};

const roomOf = (userId) => `user:${userId}`;

let initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: process.env.URL_REACT || 'http://localhost:3000',
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    // Chi cho phep ket noi khi co token hop le -> khong the gia mao nguoi khac.
    io.use((socket, next) => {
        const userId = getUserIdFromHandshake(socket);
        if (!userId) return next(new Error('UNAUTHORIZED'));
        socket.userId = userId;
        next();
    });

    io.on('connection', (socket) => {
        socket.join(roomOf(socket.userId));

        // Gui tin nhan qua socket. senderId luon lay tu token, khong lay tu client
        // gui len, tranh viec mao danh nguoi khac de gui tin.
        socket.on('chat:send', async (payload, ack) => {
            try {
                const data = {
                    senderId: socket.userId,
                    receiverId: payload && payload.receiverId,
                    content: payload && payload.content
                };
                const res = await chatService.handleSendMessage(data);
                if (res.errCode === 0) {
                    emitNewMessage(res.data);
                }
                if (typeof ack === 'function') ack(res);
            } catch (error) {
                console.log('socket chat:send error:', error.message);
                if (typeof ack === 'function') {
                    ack({ errCode: -1, errMessage: 'Error from server' });
                }
            }
        });

        // Bao "dang soan tin" cho doi phuong
        socket.on('chat:typing', (payload) => {
            const receiverId = payload && payload.receiverId;
            if (!receiverId) return;
            io.to(roomOf(receiverId)).emit('chat:typing', {
                fromUserId: socket.userId
            });
        });

        // Bao da doc de phia gui cap nhat lai so tin chua doc
        socket.on('chat:read', (payload) => {
            const partnerId = payload && payload.partnerId;
            if (!partnerId) return;
            io.to(roomOf(partnerId)).emit('chat:read', {
                byUserId: socket.userId
            });
        });
    });

    console.log('Socket.IO da san sang cho chat realtime');
    return io;
};

/**
 * Day mot tin nhan vua luu xuong cho ca nguoi nhan lan nguoi gui
 * (nguoi gui co the dang mo nhieu tab). Ham nay duoc goi ca tu socket
 * lan tu controller REST, nen gui bang duong nao cung deu realtime.
 */
let emitNewMessage = (message) => {
    if (!io || !message) return;
    io.to(roomOf(message.receiverId)).emit('chat:new-message', message);
    io.to(roomOf(message.senderId)).emit('chat:new-message', message);
};

/** Day thong bao (duyet tin, cong ty dang tin moi...) den 1 user. */
let emitNotification = (userId, notification) => {
    if (!io || !userId) return;
    io.to(roomOf(userId)).emit('notification:new', notification);
};

module.exports = {
    initSocket,
    emitNewMessage,
    emitNotification,
    getIO: () => io
};
