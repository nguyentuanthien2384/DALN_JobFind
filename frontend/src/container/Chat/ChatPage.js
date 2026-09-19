import React from "react";
import { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate, useParams, Link, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import moment from "moment";
import {
    getListChatConversationService,
    getChatConversationService,
    sendChatMessageService,
} from "../../service/userService";
import { getSocket } from "../../socket";
import { readPending, preparePending, clearPending, sendReliably } from "./reliableSend";
import PushSettings from "../../push/PushSettings";
import ChatAvatar from "./ChatAvatar";
import WaitingReply from "./WaitingReply";
import { mergeMessages, synchronizeConversation } from './conversationSync';

const ChatPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { partnerId } = useParams();
    const [listConversation, setListConversation] = useState([]);
    const [messages, setMessages] = useState([]);
    const [partnerData, setPartnerData] = useState(null);
    const [conversationMeta, setConversationMeta] = useState(null);
    const [content, setContent] = useState("");
    const [isRealtime, setIsRealtime] = useState(false);
    const [partnerTyping, setPartnerTyping] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [sendUncertain, setSendUncertain] = useState(false);
    const [partnerOnline, setPartnerOnline] = useState(null);
    const [partnerLastSeen, setPartnerLastSeen] = useState(null);
    const [hasOlder, setHasOlder] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [syncError, setSyncError] = useState('');
    const syncCursorRef = useRef({ partnerId, id: 0 });
    const historyLockRef = useRef(false);
    const messageListRef = useRef(null);
    const activePartnerRef = useRef(partnerId);
    activePartnerRef.current = partnerId;
    const sendLockRef = useRef(false);
    const fetchSequenceRef = useRef(0);
    const listSequenceRef = useRef(0);
    const messagesEndRef = useRef(null);
    const typingTimerRef = useRef(null);
    const typingEmitTimerRef = useRef(null);
    const [userData] = useState(() => JSON.parse(localStorage.getItem("userData")));
    const chatBasePath = location.pathname.startsWith("/admin/chat")
        ? "/admin/chat"
        : "/chat";

    const scrollToBottom = useCallback(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, []);

    const fetchListConversation = useCallback(async () => {
        const sequence = ++listSequenceRef.current;
        const res = await getListChatConversationService();
        if (sequence === listSequenceRef.current && res && res.errCode === 0) {
            setListConversation(res.data);
        }
    }, []);

    const fetchConversation = useCallback(async (scroll) => {
        const sequence = ++fetchSequenceRef.current;
        const current = () => activePartnerRef.current === partnerId && sequence === fetchSequenceRef.current;
        const cursor = syncCursorRef.current.partnerId === partnerId ? syncCursorRef.current.id : 0;
        let res;
        try { res = await synchronizeConversation({ partnerId, afterId: cursor, fetchPage: getChatConversationService, current }); }
        catch { res = { errCode: -1, errMessage: 'Chưa đồng bộ được hội thoại. Vui lòng thử lại.' }; }
        if (activePartnerRef.current !== partnerId || sequence !== fetchSequenceRef.current) return;
        if (res && res.errCode === 0) {
            setMessages((prev) => {
                const list = messageListRef.current;
                const nearBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 120;
                if (scroll || (nearBottom && Number(res.data.at(-1)?.id) > Number(prev.at(-1)?.id || 0))) {
                    setTimeout(scrollToBottom, 100);
                }
                return mergeMessages(prev, res.data);
            });
            if (!cursor) setHasOlder(Boolean(res.pageInfo?.hasMore));
            syncCursorRef.current = { partnerId, id: Math.max(cursor, ...res.data.map((message) => Number(message.id)), 0) };
            setSyncError('');
            setPartnerData(res.partnerData);
            setConversationMeta(res.conversationMeta || null);
            // The REST snapshot marks its boundary read even while the socket
            // is offline. Refresh counters after that commit, not in parallel.
            fetchListConversation();
            const socket = getSocket();
            if (socket && socket.connected && res.data.length && !document.hidden) {
                socket.emit("chat:read", { partnerId: Number(partnerId), throughMessageId: Math.max(...res.data.map((m) => Number(m.id))) });
            }
        } else if (res) {
            if (res.errCode === 5) setConversationMeta(null);
            setSyncError(res.errMessage || 'Chưa đồng bộ được hội thoại. Vui lòng thử lại.');
        }
    }, [partnerId, scrollToBottom, fetchListConversation]);

    useEffect(() => {
        if (!userData) {
            toast.error("Xin hãy đăng nhập để sử dụng tính năng nhắn tin");
            localStorage.setItem("lastUrl", window.location.href);
            navigate("/login");
            return;
        }
        fetchListConversation();
    }, [fetchListConversation, navigate, userData]);

    useEffect(() => {
        if (!userData) return;
        let timer, stopped = false, refreshing = false, offlineDelay = 5000;
        const refresh = async () => {
            if (stopped || refreshing) return;
            refreshing = true;
            if (!document.hidden && navigator.onLine !== false) {
                await Promise.allSettled([fetchListConversation(), partnerId ? fetchConversation(false) : Promise.resolve()]);
            }
            refreshing = false;
            if (stopped) return;
            offlineDelay = Math.min(30000, offlineDelay * 1.5);
            timer = setTimeout(refresh, isRealtime ? 120000 : offlineDelay + Math.random() * 1000);
        };
        const onVisible = () => {
            if (!document.hidden) { clearTimeout(timer); refresh(); }
        };
        timer = setTimeout(refresh, isRealtime ? 120000 : offlineDelay);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onVisible);
        return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onVisible); };
    }, [fetchConversation, fetchListConversation, isRealtime, partnerId, userData]);

    // ---- Socket.IO: nhan tin nhan tuc thi ----
    useEffect(() => {
        if (!userData) return;
        const socket = getSocket();
        if (!socket) return;

        const onConnect = () => {
            setIsRealtime(true);
            // Always reconcile persisted state, even after transport recovery:
            // a process may have committed a message before it could broadcast.
            fetchListConversation();
            if (partnerId && !document.hidden) fetchConversation(false);
        };
        const onDisconnect = () => { setIsRealtime(false); setPartnerOnline(null); setPartnerLastSeen(null); };

        const onNewMessage = (msg) => {
            const involved =
                +msg.senderId === +userData.id || +msg.receiverId === +userData.id;
            if (!involved) return;

            // Tin thuoc cuoc tro chuyen dang mo -> chen thang vao khung chat
            const inOpenChat =
                partnerId &&
                (+msg.senderId === +partnerId || +msg.receiverId === +partnerId);
            if (inOpenChat) {
                setMessages((prev) => {
                    if (prev.some((m) => +m.id === +msg.id)) return prev;
                    setTimeout(scrollToBottom, 50);
                    return [...prev, msg].sort((a, b) => Number(a.id) - Number(b.id));
                });
                setPartnerTyping(false);
                if (+msg.receiverId === +userData.id && !document.hidden) {
                    socket.emit("chat:read", { partnerId: Number(partnerId), throughMessageId: Number(msg.id) });
                }
            }
            // Luon lam moi danh sach hoi thoai de cap nhat tin cuoi + so chua doc
            fetchListConversation();
        };

        const onTyping = ({ fromUserId }) => {
            if (!partnerId || +fromUserId !== +partnerId) return;
            setPartnerTyping(true);
            clearTimeout(typingTimerRef.current);
            typingTimerRef.current = setTimeout(() => setPartnerTyping(false), 2500);
        };

        const onMessagesRead = ({ byUserId, throughMessageId }) => {
            fetchListConversation();
            if (!partnerId || +byUserId !== +partnerId) return;
            setMessages((prev) =>
                prev.map((message) =>
                    +message.senderId === +userData.id && (!throughMessageId || +message.id <= +throughMessageId)
                        ? { ...message, isRead: 1 }
                        : message
                )
            );
        };

        socket.on("connect", onConnect);
        socket.on("disconnect", onDisconnect);
        socket.on("chat:new-message", onNewMessage);
        socket.on("chat:typing", onTyping);
        socket.on("chat:read", onMessagesRead);
        if (socket.connected) setIsRealtime(true);

        return () => {
            socket.off("connect", onConnect);
            socket.off("disconnect", onDisconnect);
            socket.off("chat:new-message", onNewMessage);
            socket.off("chat:typing", onTyping);
            socket.off("chat:read", onMessagesRead);
            clearTimeout(typingTimerRef.current);
            clearTimeout(typingEmitTimerRef.current);
        };
    }, [fetchConversation, fetchListConversation, partnerId, scrollToBottom, userData]);

    useEffect(() => {
        if (partnerId && userData && !document.hidden) {
            fetchConversation(true);
        }
    }, [fetchConversation, partnerId, userData]);

    useEffect(() => {
        syncCursorRef.current = { partnerId, id: 0 };
        setHasOlder(false); setLoadingOlder(false); setSyncError('');
        setMessages([]); setPartnerData(null); setConversationMeta(null); setPartnerTyping(false); setPartnerOnline(null); setPartnerLastSeen(null);
        const pending = userData && partnerId ? readPending(userData.id, partnerId) : null;
        setContent(pending?.content || ''); setSendUncertain(Boolean(pending));
    }, [partnerId, userData]);

    useEffect(() => {
        if (!partnerId || !isRealtime) return;
        let stopped = false;
        const check = async () => {
            const socket = getSocket();
            if (!socket?.connected || document.hidden) return;
            try {
                const res = await socket.timeout(3000).emitWithAck('chat:presence', { partnerId: Number(partnerId) });
                if (!stopped) {
                    setPartnerOnline(res?.errCode === 0 ? res.data.online : null);
                    setPartnerLastSeen(res?.errCode === 0 ? res.data.lastSeenAt : null);
                }
            } catch { if (!stopped) setPartnerOnline(null); }
        };
        check();
        const interval = setInterval(check, 30000);
        return () => { stopped = true; clearInterval(interval); };
    }, [isRealtime, partnerId]);

    const handleSend = async () => {
        if (!content.trim() || !partnerId || sendLockRef.current) return;
        const text = content.trim(), target = partnerId;
        sendLockRef.current = true;
        setIsSending(true);
        try {
            const wasPending = Boolean(readPending(userData.id, target));
            const payload = preparePending(userData.id, target, text);
            const res = await sendReliably(getSocket(), payload, sendChatMessageService);
            if (res?.errCode === 0) {
                clearPending(userData.id, target, payload.clientMessageId);
                if (activePartnerRef.current === target) {
                    setContent(''); setSendUncertain(false);
                    if (res.data) setMessages((prev) => prev.some((m) => +m.id === +res.data.id) ? prev : [...prev, res.data].sort((a, b) => a.id - b.id));
                    Promise.allSettled([fetchConversation(true), fetchListConversation()]);
                }
            } else {
                const definitive = !wasPending && res && !res.deliveryUncertain && res.errCode !== -1 && !['network', 'timeout', 'unavailable', 'cancelled'].includes(res.errorType);
                if (definitive) clearPending(userData.id, target, payload.clientMessageId);
                if (activePartnerRef.current === target) setSendUncertain(!definitive);
                toast.error(res?.errMessage || 'Chưa xác nhận được tin nhắn. Hãy gửi lại để kiểm tra.');
            }
        } catch (error) {
            if (activePartnerRef.current === target) setSendUncertain(Boolean(readPending(userData.id, target)));
            toast.error(error.message || 'Chưa xác nhận được tin nhắn. Hãy gửi lại để kiểm tra.');
        } finally { sendLockRef.current = false; setIsSending(false); }
    };

    const loadOlder = async () => {
        if (!messages.length || historyLockRef.current) return;
        historyLockRef.current = true; setLoadingOlder(true);
        const target = partnerId, oldest = Number(messages[0].id);
        const list = messageListRef.current, previousHeight = list?.scrollHeight || 0;
        try {
            const res = await getChatConversationService({ partnerId: target, beforeId: oldest });
            if (activePartnerRef.current !== target) return;
            if (res?.errCode !== 0) { setSyncError(res?.errMessage || 'Không tải được tin nhắn cũ.'); return; }
            setMessages((prev) => mergeMessages(res.data, prev));
            setHasOlder(Boolean(res.pageInfo?.hasMore)); setSyncError('');
            requestAnimationFrame(() => {
                if (activePartnerRef.current === target && list) list.scrollTop += list.scrollHeight - previousHeight;
            });
        } catch {
            if (activePartnerRef.current === target) setSyncError('Không tải được tin nhắn cũ. Vui lòng thử lại.');
        } finally { historyLockRef.current = false; if (activePartnerRef.current === target) setLoadingOlder(false); }
    };

    const handleTyping = (value) => {
        setContent(value);
        clearTimeout(typingEmitTimerRef.current);
        typingEmitTimerRef.current = setTimeout(() => {
            const socket = getSocket();
            if (value.trim() && socket && socket.connected && partnerId) {
                socket.volatile.emit("chat:typing", { receiverId: Number(partnerId) });
            }
        }, 250);
    };

    const getPartnerName = (partner) => {
        if (!partner) return "Người dùng";
        if (partner.userCompanyData && partner.userCompanyData.name)
            return partner.userCompanyData.name;
        return (partner.firstName || "") + " " + (partner.lastName || "");
    };

    const getPartnerAvatar = (partner) => {
        if (!partner) return "";
        if (partner.userCompanyData && partner.userCompanyData.thumbnail)
            return partner.userCompanyData.thumbnail;
        return partner.image;
    };

    if (!userData) return <></>;

    return (
        <main>
            <div className="container chat-page-container">
                <h4 style={{ marginBottom: "20px" }}>
                    <i
                        className="far fa-comments"
                        style={{ color: "#fb246a", marginRight: "8px" }}
                    ></i>
                    Tin nhắn
                </h4>
                <PushSettings userId={Number(userData.id)} />
                <div className="chat-wrapper">
                    {/* Danh sách hội thoại — tren mobile se an di khi da mo mot cuoc tro chuyen */}
                    <div
                        className={
                            "chat-sidebar" + (partnerId ? " chat-sidebar--hidden-mobile" : "")
                        }
                    >
                        {listConversation && listConversation.length > 0 ? (
                            listConversation.map((item, index) => (
                                <Link
                                    key={index}
                                    to={`${chatBasePath}/${item.partnerId}`}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "10px",
                                        padding: "12px",
                                        borderBottom: "1px solid #f5f5f5",
                                        background:
                                            +partnerId === +item.partnerId
                                                ? "#fff0f5"
                                                : "#fff",
                                        color: "inherit",
                                    }}
                                >
                                    <ChatAvatar
                                        name={getPartnerName(item.partnerData)}
                                        src={getPartnerAvatar(item.partnerData)}
                                        alt=""
                                        style={{
                                            width: "44px",
                                            height: "44px",
                                            borderRadius: "50%",
                                            objectFit: "cover",
                                        }}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <b style={{ fontSize: "14px" }}>
                                            {getPartnerName(item.partnerData)}
                                        </b>
                                        <div
                                            style={{
                                                fontSize: "12px",
                                                color: "#888",
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            {item.lastMessage.content}
                                        </div>
                                    </div>
                                    {item.unreadCount > 0 && (
                                        <span
                                            style={{
                                                background: "#fb246a",
                                                color: "#fff",
                                                borderRadius: "10px",
                                                fontSize: "11px",
                                                padding: "2px 7px",
                                            }}
                                        >
                                            {item.unreadCount}
                                        </span>
                                    )}
                                </Link>
                            ))
                        ) : (
                            <div
                                style={{
                                    padding: "20px",
                                    textAlign: "center",
                                    color: "#999",
                                    fontSize: "14px",
                                }}
                            >
                                Chưa có cuộc trò chuyện nào. Hãy nhắn tin cho
                                nhà tuyển dụng từ trang chi tiết việc làm!
                            </div>
                        )}
                    </div>

                    {/* Khung chat */}
                    <div className="chat-main">
                        {partnerId ? (
                            <>
                                <div
                                    style={{
                                        padding: "12px 15px",
                                        borderBottom: "1px solid #eee",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "10px",
                                    }}
                                >
                                    {/* Nut quay lai danh sach, chi hien tren mobile */}
                                    <Link
                                        to={chatBasePath}
                                        className="chat-back-btn"
                                        style={{ color: "#333", fontSize: "18px" }}
                                    >
                                        <i className="fas fa-arrow-left"></i>
                                    </Link>
                                    <ChatAvatar
                                        name={getPartnerName(partnerData)}
                                        src={getPartnerAvatar(partnerData)}
                                        alt=""
                                        style={{
                                            width: "36px",
                                            height: "36px",
                                            borderRadius: "50%",
                                            objectFit: "cover",
                                        }}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <b>{getPartnerName(partnerData)}</b>
                                        <div style={{ fontSize: "11px", color: "#999" }}>
                                            {partnerTyping ? (
                                                <span style={{ color: "#fb246a" }}>
                                                    đang soạn tin nhắn...
                                                </span>
                                            ) : partnerOnline === true ? (
                                                <span style={{ color: '#28a745' }}>Đang trực tuyến</span>
                                            ) : isRealtime ? (
                                                <span>
                                                    <i
                                                        className="fas fa-circle"
                                                        style={{ fontSize: "7px", color: "#28a745", marginRight: "4px" }}
                                                    ></i>
                                                    {partnerOnline === false ? (partnerLastSeen ? `Hoạt động lúc ${moment(partnerLastSeen).format('HH:mm DD/MM/YYYY')}` : 'Người nhận đang ngoại tuyến') : 'Đang kết nối trực tiếp'}
                                                </span>
                                            ) : (
                                                "Chế độ tải lại định kỳ"
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div
                                    ref={messageListRef}
                                    role="log"
                                    aria-label="Nội dung hội thoại"
                                    aria-live="polite"
                                    style={{
                                        flex: 1,
                                        overflowY: "auto",
                                        padding: "15px",
                                        background: "#fafafa",
                                    }}
                                >
                                    {syncError && <div role="alert" className="alert alert-warning">{syncError} <button type="button" onClick={() => fetchConversation(false)}>Thử đồng bộ lại</button></div>}
                                    {hasOlder && <div style={{ textAlign: 'center', marginBottom: 16 }}><button type="button" className="btn btn-light" disabled={loadingOlder} onClick={loadOlder}>{loadingOlder ? 'Đang tải tin nhắn cũ...' : 'Xem tin nhắn cũ'}</button></div>}
                                    {messages.map((item, index) => {
                                        const isMine =
                                            +item.senderId === +userData.id;
                                        return (
                                            <div
                                                key={item.id}
                                                style={{
                                                    display: "flex",
                                                    justifyContent: isMine
                                                        ? "flex-end"
                                                        : "flex-start",
                                                    marginBottom: "10px",
                                                }}
                                            >
                                                <div
                                                    className="chat-bubble"
                                                    style={{
                                                        padding: "9px 13px",
                                                        borderRadius: "14px",
                                                        background: isMine
                                                            ? "#fb246a"
                                                            : "#fff",
                                                        color: isMine
                                                            ? "#fff"
                                                            : "#333",
                                                        border: isMine
                                                            ? "none"
                                                            : "1px solid #eee",
                                                        fontSize: "14px",
                                                    }}
                                                >
                                                      <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.content}</div>
                                                    <div
                                                        style={{
                                                            fontSize: "10px",
                                                            opacity: 0.7,
                                                            marginTop: "3px",
                                                            textAlign: "right",
                                                        }}
                                                    >
                                                        {moment(
                                                            item.createdAt
                                                        ).format("HH:mm DD/MM")}
                                                    </div>
                                                    {isMine && +item.isRead === 1 && index === messages.length - 1 && (
                                                        <div
                                                            style={{
                                                                fontSize: "10px",
                                                                opacity: 0.7,
                                                                textAlign: "right",
                                                            }}
                                                        >
                                                            Đã xem
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <WaitingReply
                                        eligible={conversationMeta?.waitingReply?.candidateId === Number(userData.id)
                                            && conversationMeta?.waitingReply?.recruiterId === Number(partnerId)}
                                        messages={messages} userId={userData.id} partnerId={partnerId}
                                        name={getPartnerName(partnerData)} avatar={getPartnerAvatar(partnerData)}
                                    />
                                    <div ref={messagesEndRef} />
                                </div>
                                <div
                                    style={{
                                        display: "flex",
                                        gap: "10px",
                                        padding: "12px",
                                        borderTop: "1px solid #eee",
                                    }}
                                >
                                    {sendUncertain && <span role="status" style={{ fontSize: 12 }}>Chưa xác nhận. Bấm gửi lại để kiểm tra cùng tin nhắn.</span>}
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="Nhập tin nhắn..."
                                        value={content}
                                        maxLength={2000}
                                        disabled={isSending || sendUncertain}
                                        onChange={(e) =>
                                            handleTyping(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleSend();
                                        }}
                                    />
                                    <button
                                        className="btn btn-primary"
                                        aria-label={sendUncertain ? 'Gửi lại tin nhắn' : 'Gửi tin nhắn'}
                                        onClick={() => handleSend()}
                                        disabled={isSending || !content.trim()}
                                    >
                                        <i className="far fa-paper-plane" aria-hidden="true"></i> {isSending ? "Đang gửi…" : sendUncertain ? "Gửi lại" : "Gửi"}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "#999",
                                }}
                            >
                                Chọn một cuộc trò chuyện để bắt đầu
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
};

export default ChatPage;
