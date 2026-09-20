import { Server } from "socket.io";
import chatService from "../services/chatService";
import db from "../models/index";
import { getJwtSecret, getJwtVerifyOptions, hasAccessTokenClaims } from '../utils/securityConfig';
import { validAccessSession } from '../utils/authAccess';
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const protocol = require('../utils/chatProtocol');
const limiter = require('../utils/realtimeLimiter');
const metrics = require('../utils/realtimeMetrics');
const tracing = require('../utils/realtimeTracing');
const presence = require('../services/realtimePresenceService');
require('dotenv').config();
let io = null;
const roomOf = (id) => `user:${id}`;
const authError = (code) => Object.assign(new Error(code), { data: { code, retryable: false } });
const getIdentity = (socket) => {
    const raw = socket.handshake.auth?.token;
    if (typeof raw !== 'string' || raw.length > 8192) throw authError('AUTH_INVALID');
    try {
        const claims = jwt.verify(raw.startsWith('Bearer ') ? raw.slice(7) : raw, getJwtSecret(), getJwtVerifyOptions());
        if (!hasAccessTokenClaims(claims)) throw authError('AUTH_INVALID');
        if (claims.exp * 1000 <= Date.now()) throw authError('AUTH_EXPIRED');
        return { userId: Number(claims.sub), authExp: claims.exp, sid: claims.sid || null, claims };
    } catch (error) { throw authError(error.name === 'TokenExpiredError' || error.message === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'AUTH_INVALID'); }
};
const activeAccount = (userId) => db.Account.findOne({ where: { userId, statusCode: 'S1' }, attributes: ['userId', 'roleCode'], include: [{model:db.User,as:'userAccountData',attributes:[],required:true}], raw: true });
const dashboardRoom = async (userId, roleCode) => {
    if (roleCode === 'ADMIN') return 'feature:dashboard:admin';
    if (!['COMPANY', 'EMPLOYER'].includes(roleCode)) return null;
    const user = await db.User.findByPk(userId, { attributes: ['companyId'], raw: true });
    if (!user?.companyId) return null;
    const company = await db.Company.findOne({ where: { id: user.companyId, statusCode: 'S1', censorCode: 'CS1' }, attributes: ['id'], raw: true });
    return company ? `feature:dashboard:company:${company.id}` : null;
};
const endSession = (socket, code) => {
    socket.emit('auth:expired', { v: 1, code });
    socket.disconnect(true);
};
const initSocket = (server, adapter) => {
    tracing.init();
    const handshakeLimit = Number(process.env.SOCKET_HANDSHAKE_LIMIT_PER_MINUTE || 120);
    if (!Number.isSafeInteger(handshakeLimit) || handshakeLimit < 1) throw new Error('Invalid handshake limit');
    const origins = new Set((process.env.URL_REACT || 'http://localhost:3000,http://localhost:3001').split(',').map((s) => s.trim()).filter(Boolean));
    io = new Server(server, {
        ...(adapter ? { adapter } : {}),
        cors: { origin: [...origins], methods: ['GET', 'POST'], credentials: true },
        maxHttpBufferSize: 64 * 1024, perMessageDeflate: false,
        pingInterval: 25000, pingTimeout: 20000,
        connectionStateRecovery: { maxDisconnectionDuration: 120000, skipMiddlewares: false },
        allowRequest: (req, callback) => {
            if (typeof req.headers.origin !== 'string' || !origins.has(req.headers.origin)) {
                metrics.increment('socket_origin_reject_total');
                return callback(null, false);
            }
            // Do not trust a client-supplied X-Forwarded-For. The proxy may also
            // enforce per-IP limits; this bounds attempts per direct peer here.
            limiter.consume(`connect:${req.socket.remoteAddress}`, handshakeLimit, 60000)
                .then((rate) => callback(null, rate.allowed)).catch(() => callback(null, false));
        },
    });
    const runtime = io;
    runtime.use(async (socket, next) => {
        try {
            const identity = getIdentity(socket);
            // Recovery credentials must never transfer a previous user's rooms.
            if (socket.recovered && socket.data.userId !== identity.userId) throw authError('AUTH_INVALID');
            if (!await validAccessSession(identity.claims)) throw authError('AUTH_INVALID');
            const account = await activeAccount(identity.userId);
            if (!account) throw authError('AUTH_INACTIVE');
            const rate = await limiter.consume(`login:${identity.userId}`, 30, 60000);
            if (!rate.allowed) throw authError('RATE_LIMITED');
            const authorizedDashboardRoom = await dashboardRoom(identity.userId, account.roleCode);
            const connectionLease = randomUUID();
            if (!await limiter.slot(identity.userId, connectionLease)) throw authError('CONNECTION_LIMITED');
            const { claims, ...safeIdentity } = identity;
            socket.data = { ...safeIdentity, roleCode: account.roleCode, connectionLease, dashboardRoom: authorizedDashboardRoom };
            // Also release if the transport closes before namespace acceptance.
            socket.conn.once('close', () => { limiter.release(identity.userId, connectionLease).catch(() => {}); });
            socket.userId = identity.userId;
            metrics.increment('socket_connections_total', '{result="accepted"}');
            next();
        } catch (error) {
            const code = error.data?.code || 'AUTH_UNAVAILABLE';
            metrics.increment('socket_connections_total', '{result="rejected"}');
            metrics.increment('socket_auth_failure_total', `{reason="${code}"}`);
            next(authError(code));
        }
    });
    runtime.on('connection', (socket) => {
        const { userId, authExp, roleCode, connectionLease } = socket.data;
        socket.join(roomOf(userId));
        const touchPresence = () => presence.touch(userId).catch(() => metrics.increment('socket_presence_store_errors_total'));
        touchPresence();
        // A recovered session may contain rooms from a previous company/role.
        for (const room of socket.rooms || []) if (room.startsWith('feature:dashboard')) socket.leave(room);
        if (socket.data.dashboardRoom) socket.join(socket.data.dashboardRoom);
        metrics.connect();
        let transport = socket.conn.transport?.name;
        metrics.transport(transport,1);
        socket.conn.on?.('upgrade', (next) => {metrics.transport(transport,-1);transport=next.name;metrics.transport(transport,1);});
        metrics.increment('socket_recovery_total', `{result="${socket.recovered ? 'recovered' : 'fresh'}"}`);
        const expiry = setTimeout(() => endSession(socket, 'AUTH_EXPIRED'), Math.max(0, authExp * 1000 - Date.now()));
        expiry.unref?.();
        let checking = false;
        const revalidate = setInterval(async () => {
            if (checking) return;
            checking = true;
            try {
                if (!await validAccessSession({ sid: socket.data.sid, sub: userId })) return endSession(socket, 'AUTH_INVALID');
                const account = await activeAccount(userId);
                if (!account) endSession(socket, 'AUTH_INACTIVE');
                else if (account.roleCode !== roleCode || await dashboardRoom(userId, account.roleCode) !== (socket.data.dashboardRoom || null)) socket.disconnect(true);
                else if (!await limiter.slot(userId, connectionLease, true)) endSession(socket, 'AUTH_UNAVAILABLE');
                else await touchPresence();
            }
            catch { endSession(socket, 'AUTH_UNAVAILABLE'); }
            finally { checking = false; }
        }, 30000);
        revalidate.unref?.();
        socket.on('disconnect', (reason) => {
            clearTimeout(expiry); clearInterval(revalidate); metrics.disconnect(); metrics.transport(transport,-1);
            limiter.release(userId, connectionLease).catch(() => {});
            touchPresence();
            const safeReason = ['ping timeout', 'transport close', 'transport error', 'server namespace disconnect', 'client namespace disconnect', 'server shutting down'].includes(reason) ? reason : 'other';
            metrics.increment('socket_disconnect_total', `{reason="${safeReason}"}`);
        });
        let malformed = 0;
        const register = (event, action) => socket.on(event, (payload, ack) => tracing.run(`socket.${event}`, async (span) => {
            const start = Date.now(), traceId = tracing.id(span);
            let result;
            try {
                metrics.payload(event, Buffer.byteLength(JSON.stringify(payload) || ''));
                if (authExp * 1000 <= Date.now()) {
                    result = protocol.error('AUTH_EXPIRED', 'Phiên đăng nhập đã hết hạn');
                    endSession(socket, 'AUTH_EXPIRED');
                } else {
                    const rate = await limiter.consume(`event:${userId}:${event}`, event === 'chat:typing' ? 60 : 120, 60000);
                    if (!rate.allowed) result = protocol.error('RATE_LIMITED', 'Bạn thao tác quá nhanh', 7, true, { retryAfterMs: rate.retryAfterMs });
                    else if (!protocol.validate(event, payload)) {
                        result = protocol.error('PAYLOAD_INVALID', 'Dữ liệu sự kiện không hợp lệ');
                        if (++malformed >= 5) socket.disconnect(true);
                    } else if (!await activeAccount(userId)) {
                        result = protocol.error('AUTH_INACTIVE', 'Tài khoản đã bị vô hiệu hóa');
                        endSession(socket, 'AUTH_INACTIVE');
                    } else result = await action(payload, traceId);
                }
            } catch {
                result = protocol.error('INTERNAL_ERROR', 'Error from server', -1, true);
            }
            const response = protocol.response(result, traceId);
            span.setAttribute('app.result',response.code);
            if (typeof ack === 'function') ack(response);
            metrics.increment('socket_event_total', `{event="${event}",result="${response.code}"}`);
            if (response.code === 'RATE_LIMITED') metrics.increment('socket_rate_limit_total', `{event="${event}"}`);
            metrics.observe(event, (Date.now() - start) / 1000);
            if (process.env.SOCKET_LOG_EVENTS === 'true') console.info(JSON.stringify({ event, traceId, outcome: response.code, latencyMs: Date.now() - start }));
        }));
        register('chat:telemetry', async ({outcome,durationMs}) => {
            metrics.ack(outcome,durationMs/1000);return {errCode:0};
        });
        register('chat:send', async (payload, traceId) => {
            const result = await chatService.handleSendMessage({ senderId: userId, receiverId: payload.receiverId, content: payload.content, clientMessageId: payload.clientMessageId,
                ...(payload.attachmentId ? { attachmentId: payload.attachmentId } : {}), ...(payload.jobPostId ? { jobPostId: payload.jobPostId } : {}) });
            if (result.duplicate) metrics.increment('chat_duplicate_replay_total');
            if (result.errCode === 0 && !result.duplicate) {
                try { await tracing.run('chat.publish', async () => emitNewMessage(result.data, traceId)); }
                catch { metrics.increment('socket_publish_errors_total'); }
            }
            return result;
        });
        register('chat:typing', async ({ receiverId }) => {
            const relation = await chatService.canParticipantsChat(userId, receiverId);
            if (!relation.allowed) return protocol.error('CHAT_NOT_ALLOWED', 'Bạn không có quyền mở cuộc trò chuyện này', 5);
            const rate = await limiter.consume(`typing:${userId}:${receiverId}`, 1, 750);
            if (rate.allowed) runtime.to(roomOf(receiverId)).volatile.emit('chat:typing', { v: 1, fromUserId: userId });
            return { errCode: 0 };
        });
        register('chat:read', async ({ partnerId, throughMessageId }) => {
            const result = await chatService.markConversationRead({ userId, partnerId, throughMessageId });
            if (result.errCode === 0) emitReadReceipt(userId, partnerId, throughMessageId);
            return result;
        });
        register('chat:presence', async ({ partnerId }) => {
            const relation = await chatService.canParticipantsChat(userId, partnerId);
            if (!relation.allowed) return protocol.error('CHAT_NOT_ALLOWED', 'Bạn không có quyền mở cuộc trò chuyện này', 5);
            const sockets = await runtime.in(roomOf(partnerId)).fetchSockets();
            const online = sockets.some((peer) => peer.data.authExp * 1000 > Date.now());
            return { errCode: 0, data: { partnerId, online, lastSeenAt: online ? null : await presence.lastSeen(partnerId), checkedAt: new Date().toISOString() } };
        });
    });
    return runtime;
};
const emitNewMessage = (message, traceId) => {
    if (!io || !message) return;
    const value = message.toJSON ? message.toJSON() : message;
    const event = { ...value, ...(traceId ? {traceId} : {}), v: 1, eventId: `chat:${value.id}`, occurredAt: value.createdAt };
    io.to(roomOf(value.receiverId)).emit('chat:new-message', event);
    io.to(roomOf(value.senderId)).emit('chat:new-message', event);
};
const emitReadReceipt = (userId, partnerId, throughMessageId) => {
    if (!io) return;
    const event = { v: 1, byUserId: Number(userId), partnerId: Number(partnerId), throughMessageId };
    io.to(roomOf(partnerId)).emit('chat:read', event);
    io.to(roomOf(userId)).emit('chat:read', event);
};
const emitNotification = (userId, notification) => {
    if (io && userId) io.to(roomOf(userId)).emit('notification:new', notification);
};
const emitNotificationRead = userId => {
    if (io && userId) io.to(roomOf(userId)).emit('notification:read', { v: 1 });
};
const emitDashboardChanged = async (type, scope = {}) => {
    if (!io) return;
    try {
        let companyId = Number(scope.companyId), ownerId = Number(scope.userId);
        if (scope.postId) {
            const post = await db.Post.findByPk(scope.postId, { attributes: ['userId'], raw: true });
            ownerId = Number(post?.userId);
        }
        if (ownerId) {
            const owner = await db.User.findByPk(ownerId, { attributes: ['companyId'], raw: true });
            companyId = Number(owner?.companyId);
        }
        const rooms = ['feature:dashboard:admin'];
        if (Number.isSafeInteger(companyId) && companyId > 0) rooms.push(`feature:dashboard:company:${companyId}`);
        io.to(rooms).emit('dashboard:changed', { v: 1, type, at: Date.now() });
    } catch { metrics.increment('socket_publish_errors_total'); }
};
const disconnectUser = (userId) => {
    if (io && userId) {
        io.to(roomOf(userId)).emit('auth:expired', { v: 1, code: 'AUTH_INACTIVE' });
        io.in(roomOf(userId)).disconnectSockets(true);
    }
};
module.exports = { initSocket, emitNewMessage, emitReadReceipt, emitNotification, emitNotificationRead, emitDashboardChanged, disconnectUser, getIO: () => io };
