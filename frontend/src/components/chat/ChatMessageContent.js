import React, { useState } from 'react';
import { Modal } from 'antd';
import { formatChatFileSize } from '../../service/chatMediaService';
import './ChatMedia.css';

const dateLabel = value => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN');
};

export const ChatJobCard = ({ job, draft = false }) => {
    const [open, setOpen] = useState(false);
    const href = Number.isSafeInteger(Number(job.id)) && Number(job.id) > 0 ? `/detail-job/${Number(job.id)}` : null;
    return <div className="chat-job-card">
        <span className="chat-media-eyebrow"><i className="fas fa-briefcase" aria-hidden="true" /> TIN TUYỂN DỤNG</span>
        <h3>{job.name}</h3>
        {job.companyName && <p className="chat-job-company">{job.companyName}</p>}
        <dl className="chat-job-facts">{[['Địa điểm', job.location], ['Mức lương', job.salary], ['Kinh nghiệm', job.experience], ['Hình thức', job.workType]]
            .filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {job.descriptionText && <p className="chat-job-excerpt">{job.descriptionText.slice(0, 190)}{job.descriptionText.length > 190 ? '…' : ''}</p>}
        <div className="chat-media-actions">
            {job.descriptionText && <button type="button" className="chat-media-action" onClick={() => setOpen(true)}>Xem chi tiết {draft ? 'trước khi gửi' : 'bản đã gửi'}</button>}
            {href && <a href={href} target="_blank" rel="noopener noreferrer" className="chat-media-link">Xem tin mới nhất ↗</a>}
        </div>
        {dateLabel(job.sharedAt) && <small className="chat-media-caption">Nội dung tại thời điểm gửi · {dateLabel(job.sharedAt)}</small>}
        <Modal open={open} onCancel={() => setOpen(false)} footer={null} width={760} title={job.name}>
            <div className="chat-job-detail"><p>{job.companyName}</p>
                {!draft && <p className="chat-job-snapshot-note">Đây là nội dung được lưu khi chia sẻ{dateLabel(job.sharedAt) ? ` lúc ${dateLabel(job.sharedAt)}` : ''}.
                    {href && <> <a href={href} target="_blank" rel="noopener noreferrer">Mở tin tuyển dụng để xem cập nhật mới nhất.</a></>}</p>}
                <div className="chat-job-description">{job.descriptionText}</div>
            </div>
        </Modal>
    </div>;
};

export const ChatFileCard = ({ attachment, onPreview }) => <div className="chat-file-card">
    <div className="chat-file-icon" aria-hidden="true">PDF</div>
    <div className="chat-file-info"><strong>{attachment.name || 'Tài liệu PDF'}</strong>
        <span>PDF{attachment.size ? ` · ${formatChatFileSize(attachment.size)}` : ''}{attachment.pageCount ? ` · ${attachment.pageCount} trang` : ''}</span>
        <button type="button" className="chat-media-action" onClick={() => onPreview(attachment)}>Xem PDF</button></div>
</div>;

const ChatMessageContent = ({ message, onPreview }) => <div className="chat-message-content">
    {message.content && <div className="chat-message-text">{message.content}</div>}
    {message.attachment && <ChatFileCard attachment={message.attachment} onPreview={onPreview} />}
    {message.jobSnapshot && <ChatJobCard job={message.jobSnapshot} />}
</div>;

export default ChatMessageContent;
