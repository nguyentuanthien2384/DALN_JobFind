import axios from '../axios';

export const MAX_CHAT_PDF_SIZE = 5 * 1024 * 1024;
export const readChatPdf = file => new Promise((resolve, reject) => {
    if (!file || !/\.pdf$/i.test(file.name) || file.size <= 0 || file.size > MAX_CHAT_PDF_SIZE || file.name.length > 255) {
        reject(new Error('Chọn tệp PDF không quá 5 MB, tên tối đa 255 ký tự.')); return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được tệp PDF. Vui lòng chọn lại.'));
    reader.onload = () => {
        const fileBase64 = String(reader.result).split(',')[1];
        try {
            if (!fileBase64 || !atob(fileBase64.slice(0, 12)).startsWith('%PDF-')) throw new Error();
            resolve({ fileName: file.name, fileBase64 });
        } catch { reject(new Error('Tệp đã chọn không có định dạng PDF hợp lệ.')); }
    };
    reader.readAsDataURL(file);
});

export const uploadChatPdf = data => axios.post('/api/chat-attachments', data, { timeout: 30000 });
export const getChatPdf = (id, signal) => axios.get(`/api/chat-attachments/${encodeURIComponent(id)}`,
    { timeout: 30000, ...(signal ? { signal } : {}) });
export const getChatJobs = ({ partnerId, search = '', limit = 10, offset = 0 }) =>
    axios.get(`/api/chat-jobs?${new URLSearchParams({ partnerId, search, limit, offset })}`, { timeout: 10000 });

export const chatPdfBlob = data => {
    if (data?.mimeType !== 'application/pdf' || typeof data.fileBase64 !== 'string' || data.fileBase64.length > Math.ceil(MAX_CHAT_PDF_SIZE / 3) * 4) {
        throw new Error('Tài liệu trả về không hợp lệ.');
    }
    let binary;
    try { binary = atob(data.fileBase64); }
    catch { throw new Error('Tài liệu trả về không hợp lệ.'); }
    if (!binary.startsWith('%PDF-') || binary.length !== Number(data.size) || binary.length > MAX_CHAT_PDF_SIZE) {
        throw new Error('Tài liệu trả về không đầy đủ hoặc sai định dạng.');
    }
    return new Blob([Uint8Array.from(binary, value => value.charCodeAt(0))], { type: 'application/pdf' });
};

export const formatChatFileSize = size => {
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0) return '1 KB';
    return bytes >= 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

export const chatMessageSummary = message => message?.content || (message?.attachment
    ? `📄 ${message.attachment.name}` : message?.jobSnapshot ? `💼 ${message.jobSnapshot.name}` : 'Tin nhắn');
