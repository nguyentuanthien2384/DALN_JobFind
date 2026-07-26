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

const ChatPage = () => {
    const navigate = useNavigate();
    const { partnerId } = useParams();
    const [listConversation, setListConversation] = useState([]);
    const [messages, setMessages] = useState([]);
    const [partnerData, setPartnerData] = useState(null);
    const [content, setContent] = useState("");
    const messagesEndRef = useRef(null);
    const userData = JSON.parse(localStorage.getItem("userData"));

    useEffect(() => {
        if (!userData) {
            toast.error("Xin hãy đăng nhập để sử dụng tính năng nhắn tin");
            localStorage.setItem("lastUrl", window.location.href);
            navigate("/login");
            return;
        }
        fetchListConversation();
        const interval = setInterval(() => {
            fetchListConversation();
            if (partnerId) fetchConversation(false);
        }, 4000);
        return () => clearInterval(interval);
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
        let res = await getListChatConversationService({ userId: userData.id });
        if (res && res.errCode === 0) {
            setListConversation(res.data);
        }
    };

    const fetchConversation = async (scroll) => {
        let res = await getChatConversationService({
            userId: userData.id,
            partnerId: partnerId,
        });
        if (res && res.errCode === 0) {
            setMessages((prev) => {
                if (scroll || prev.length !== res.data.length) {
                    setTimeout(scrollToBottom, 100);
                }
                return res.data;
            });
            setPartnerData(res.partnerData);
        }
    };

    const handleSend = async () => {
        if (!content.trim() || !partnerId) return;
        let res = await sendChatMessageService({
            senderId: userData.id,
            receiverId: partnerId,
            content: content.trim(),
        });
        if (res && res.errCode === 0) {
            setContent("");
            fetchConversation(true);
            fetchListConversation();
        } else {
            toast.error(res && res.errMessage ? res.errMessage : "Có lỗi xảy ra");
        }
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
            <div
                className="container"
                style={{ paddingTop: "140px", paddingBottom: "60px" }}
            >
                <h4 style={{ marginBottom: "20px" }}>
                    <i
                        className="far fa-comments"
                        style={{ color: "#fb246a", marginRight: "8px" }}
                    ></i>
                    Tin nhắn
                </h4>
                <div
                    style={{
                        display: "flex",
                        border: "1px solid #eee",
                        borderRadius: "10px",
                        overflow: "hidden",
                        height: "550px",
                        background: "#fff",
                    }}
                >
                    {/* Danh sách hội thoại */}
                    <div
                        style={{
                            width: "320px",
                            borderRight: "1px solid #eee",
                            overflowY: "auto",
                        }}
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
                    <div
                        style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
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
                                    <b>{getPartnerName(partnerData)}</b>
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
                                                    style={{
                                                        maxWidth: "65%",
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
                                        onChange={(e) =>
                                            setContent(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleSend();
                                        }}
                                    />
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => handleSend()}
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
