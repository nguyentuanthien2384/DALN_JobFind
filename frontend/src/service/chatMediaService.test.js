import axios from '../axios';
import {
    MAX_CHAT_PDF_SIZE, readChatPdf, uploadChatPdf, getChatPdf, getChatJobs,
    chatPdfBlob, formatChatFileSize, chatMessageSummary
} from './chatMediaService';

jest.mock('../axios', () => ({ get: jest.fn(), post: jest.fn() }));

const pdf = '%PDF-1.7\nhello';
const base64 = btoa(pdf);
const readBlob = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
});

beforeEach(() => jest.resetAllMocks());

test('accepts a real PDF by header and case-insensitive filename, then returns its exact bytes', async () => {
    const file = new File([pdf], 'my-CV.PDF', { type: 'application/octet-stream' });
    const result = await readChatPdf(file);
    expect(result).toEqual({ fileName: 'my-CV.PDF', fileBase64: base64 });
    expect(atob(result.fileBase64)).toBe(pdf);
});

test.each([
    [null, 'missing file'],
    [{ name: 'cv.docx', size: 10 }, 'wrong extension'],
    [{ name: 'cv.pdf', size: 0 }, 'empty file'],
    [{ name: 'cv.pdf', size: MAX_CHAT_PDF_SIZE + 1 }, 'oversized file'],
    [{ name: `${'x'.repeat(252)}.pdf`, size: 10 }, 'overlong filename']
])('rejects %s before reading bytes (%s)', async file => {
    const read = jest.spyOn(FileReader.prototype, 'readAsDataURL');
    await expect(readChatPdf(file)).rejects.toThrow('Chọn tệp PDF không quá 5 MB');
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
});

test('rejects a renamed non-PDF and explains a browser read error', async () => {
    await expect(readChatPdf(new File(['plain text'], 'cv.pdf')))
        .rejects.toThrow('Tệp đã chọn không có định dạng PDF hợp lệ.');
    const OriginalReader = global.FileReader;
    global.FileReader = class {
        readAsDataURL() { this.onerror(); }
    };
    try {
        await expect(readChatPdf({ name: 'cv.pdf', size: 8 }))
            .rejects.toThrow('Không đọc được tệp PDF. Vui lòng chọn lại.');
    } finally { global.FileReader = OriginalReader; }
});

test('converts only complete PDF data with matching size and MIME to a Blob', async () => {
    const blob = chatPdfBlob({ mimeType: 'application/pdf', fileBase64: base64, size: pdf.length });
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(pdf.length);
    expect(await readBlob(blob)).toBe(pdf);
});

test.each([
    [{ mimeType: 'text/plain', fileBase64: base64, size: pdf.length }, 'wrong MIME'],
    [{ mimeType: 'application/pdf', fileBase64: 123, size: pdf.length }, 'non-string base64'],
    [{ mimeType: 'application/pdf', fileBase64: btoa('not PDF'), size: 7 }, 'wrong header'],
    [{ mimeType: 'application/pdf', fileBase64: base64, size: pdf.length + 1 }, 'truncated bytes'],
    [{ mimeType: 'application/pdf', fileBase64: '%%%?', size: 3 }, 'malformed base64']
])('rejects %s (%s)', (data) => {
    expect(() => chatPdfBlob(data)).toThrow(/^Tài liệu trả về/);
});

test('bounds encoded data before decoding it', () => {
    const oversized = 'A'.repeat(Math.ceil(MAX_CHAT_PDF_SIZE / 3) * 4 + 1);
    const decode = jest.spyOn(global, 'atob');
    expect(() => chatPdfBlob({ mimeType: 'application/pdf', fileBase64: oversized, size: MAX_CHAT_PDF_SIZE }))
        .toThrow('Tài liệu trả về không hợp lệ.');
    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
});

test('encodes attachment IDs and keeps upload and search requests bounded', () => {
    const payload = { receiverId: 7, fileName: 'CV.pdf', fileBase64: base64 };
    uploadChatPdf(payload);
    expect(axios.post).toHaveBeenCalledWith('/api/chat-attachments', payload, { timeout: 30000 });
    getChatPdf('folder/a?b#c');
    expect(axios.get).toHaveBeenCalledWith('/api/chat-attachments/folder%2Fa%3Fb%23c',
        expect.objectContaining({ timeout: 30000 }));
    getChatJobs({ partnerId: 9, search: 'React & Node', offset: 20 });
    expect(axios.get).toHaveBeenLastCalledWith('/api/chat-jobs?partnerId=9&search=React+%26+Node&limit=10&offset=20',
        { timeout: 10000 });
});

test('formats finite sizes and summarizes the visible attachment or job', () => {
    expect(formatChatFileSize(0)).toBe('1 KB');
    expect(formatChatFileSize(1536)).toBe('2 KB');
    expect(formatChatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatChatFileSize('not-a-number')).toBe('1 KB');
    expect(formatChatFileSize(Infinity)).toBe('1 KB');
    expect(chatMessageSummary({ content: 'Hello', attachment: { name: 'CV.pdf' } })).toBe('Hello');
    expect(chatMessageSummary({ attachment: { name: 'CV.pdf' } })).toBe('📄 CV.pdf');
    expect(chatMessageSummary({ jobSnapshot: { name: 'React Engineer' } })).toBe('💼 React Engineer');
    expect(chatMessageSummary(null)).toBe('Tin nhắn');
});
