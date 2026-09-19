import React from 'react';
import ChatAvatar from './ChatAvatar';

// This is a view of confirmed conversation state, not a message sent by a
// recruiter. It never creates history rows, unread counts or push deliveries.
export default function WaitingReply({eligible, messages, userId, partnerId, name, avatar}) {
    const latest = messages[messages.length - 1];
    if (!eligible || !latest || Number(latest.senderId) !== Number(userId)
        || Number(latest.receiverId) !== Number(partnerId)) return null;

    return <div className="chat-waiting-reply" role="status" aria-label="Đang chờ nhà tuyển dụng trả lời" aria-atomic="true">
        <ChatAvatar src={avatar} name={name} alt="" style={{width:32,height:32,borderRadius:'50%',objectFit:'cover'}} />
        <div className="chat-waiting-reply__bubble">
            <div className="chat-waiting-reply__label"><i className="far fa-clock" aria-hidden="true" /> Phản hồi tự động</div>
            <p>Chào bạn! Hệ thống đã ghi nhận tin nhắn của bạn. Vui lòng chờ nhà tuyển dụng phản hồi.</p>
            <span className="chat-waiting-reply__hint">Bạn có thể gửi thêm thông tin trong lúc chờ.</span>
        </div>
    </div>;
}
