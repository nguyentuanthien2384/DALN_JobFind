import React from "react";
import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "react-toastify";
import moment from "moment";
import {
    getListChatConversationService,
    getChatConversationService,
    sendChatMessageService,
} from "../../service/userService";
import { getSocket } from "../../socket";

const ChatPage = () => {
    const navigate = useNavigate();
    const { partnerId } = useParams();
    const [listConversation, setListConversation] = useState([]);
    const [messages, setMessages] = useState([]);
    const [partnerData, setPartnerData] = useState(null);
    const [content, setContent] = useState("");
    const [isRealtime, setIsRealtime] = useState(false);
    const [partnerTyping, setPartnerTyping] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const messagesEndRef = useRef(null);
    const typingTimerRef = useRef(null);
    const typingEmitTimerRef = useRef(null);
    const userData = JSON.parse(localStorage.getItem("userData"));

    useEffect(() => {
        if (!userData) {
            toast.error("Xin hãy đăng nhập để sử dụng tính năng nhắn tin");
            localStorage.setItem("lastUrl", window.location.href);
            navigate("/login");
            return;
        }
        fetchListConversation();
        // Khi socket dang chay thi chi poll thua ra 20 giay/lan cho chac an;
        // neu socket hong hoan toan thi quay ve nhip 4 giay nhu truoc.
        const interval = setInterval(() => {
            fetchListConversation();
            if (partnerId) fetchConversation(false);
        }, isRealtime ? 20000 : 4000);
        return () => clearInterval(interval);
    }, [partnerId, isRealtime]);

    // ---- Socket.IO: nhan tin nhan tuc thi ----
    useEffect(() => {
        if (!userData) return;
        const socket = getSocket();
        if (!socket) return;

        const onConnect = () => setIsRealtime(true);
        const onDisconnect = () => setIsRealtime(false);

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
                    return [...prev, msg];
                });
                setPartnerTyping(false);
                if (+msg.receiverId === +userData.id) {
                    socket.emit("chat:read", { partnerId });
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

        const onMessagesRead = ({ byUserId }) => {
            if (!partnerId || +byUserId !== +partnerId) return;
            setMessages((prev) =>
                prev.map((message) =>
                    +message.senderId === +userData.id
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
    }, [partnerId]);

    useEffect(() => {
        if (partnerId && userData) {
            fetchConversation(true);
        }
    }, [partnerId]);

    const scrollToBottom = () => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    };

    const fetchListConversation = async () => {
        let res = await getListChatConversationService();
        if (res && res.errCode === 0) {
            setListConversation(res.data);
        }
    };

    const fetchConversation = async (scroll) => {
        let res = await getChatConversationService({ partnerId: partnerId });
        if (res && res.errCode === 0) {
            setMessages((prev) => {
                if (scroll || prev.length !== res.data.length) {
                    setTimeout(scrollToBottom, 100);
                }
                return res.data;
            });
            setPartnerData(res.partnerData);
            const socket = getSocket();
            if (socket && socket.connected) {
                socket.emit("chat:read", { partnerId });
            }
        }
    };

    const handleSend = async () => {
        if (!content.trim() || !partnerId || isSending) return;
        const text = content.trim();
        const socket = getSocket();

        // Uu tien gui qua socket cho nhanh; socket hong thi rot ve API REST.
        if (socket && socket.connected) {
            setContent("");
            setIsSending(true);
            socket.emit(
                "chat:send",
                { receiverId: partnerId, content: text },
                (res) => {
                    setIsSending(false);
                    if (!res || res.errCode !== 0) {
                        setContent(text); // tra lai chu de nguoi dung gui lai
                        toast.error(
                            res && res.errMessage ? res.errMessage : "Gửi tin nhắn thất bại"
                        );
                    }
                }
            );
            return;
        }

        setIsSending(true);
        let res = await sendChatMessageService({ receiverId: partnerId, content: text });
        setIsSending(false);
        if (res && res.errCode === 0) {
            setContent("");
            fetchConversation(true);
            fetchListConversation();
        } else {
            toast.error(res && res.errMessage ? res.errMessage : "Có lỗi xảy ra");
        }
    };

    const handleTyping = (value) => {
        setContent(value);
        clearTimeout(typingEmitTimerRef.current);
        typingEmitTimerRef.current = setTimeout(() => {
            const socket = getSocket();
            if (value.trim() && socket && socket.connected && partnerId) {
                socket.emit("chat:typing", { receiverId: partnerId });
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
                                    to={`/chat/${item.partnerId}`}
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
                                    <img
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
                                        to="/chat"
                                        className="chat-back-btn"
                                        style={{ color: "#333", fontSize: "18px" }}
                                    >
                                        <i className="fas fa-arrow-left"></i>
                                    </Link>
                                    <img
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
                                            ) : isRealtime ? (
                                                <span>
                                                    <i
                                                        className="fas fa-circle"
                                                        style={{ fontSize: "7px", color: "#28a745", marginRight: "4px" }}
                                                    ></i>
                                                    Đang kết nối trực tiếp
                                                </span>
                                            ) : (
                                                "Chế độ tải lại định kỳ"
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div
                                    style={{
                                        flex: 1,
                                        overflowY: "auto",
                                        padding: "15px",
                                        background: "#fafafa",
                                    }}
                                >
                                    {messages.map((item, index) => {
                                        const isMine =
                                            +item.senderId === +userData.id;
                                        return (
                                            <div
                                                key={index}
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
                                                    <div>{item.content}</div>
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
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="Nhập tin nhắn..."
                                        value={content}
                                        maxLength={2000}
                                        disabled={isSending}
                                        onChange={(e) =>
                                            handleTyping(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleSend();
                                        }}
                                    />
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => handleSend()}
                                        disabled={isSending || !content.trim()}
                                    >
                                        <i className="far fa-paper-plane"></i>
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
