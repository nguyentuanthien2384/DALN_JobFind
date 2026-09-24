import { hasPdfSignature } from '../../util/pdfSignature';

export const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const DATA_PREFIX = 'data:application/pdf;base64,';
const INVALID = 'Tệp không phải PDF hợp lệ. Vui lòng chọn hoặc tải lại tài liệu.';
const TOO_LARGE = 'Tài liệu vượt quá giới hạn xem trước 20 MB.';
const abortError = () => new DOMException('Đã đóng trình xem.', 'AbortError');

export const pdfSourceUrl = source => {
    if (typeof source !== 'string' || source.length > 8192 || source.includes('\\') || Array.from(source).some(char => char.charCodeAt(0) <= 32)) return null;
    if (!/^https?:\/\//i.test(source) && !/^\/(?!\/)/.test(source)) return null;
    try {
        const url = new URL(source, window.location.origin);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        return url;
    } catch { return null; }
};

export const isPdfSource = source => {
    if (source instanceof Blob) return source.size > 0 && source.size <= MAX_PREVIEW_BYTES;
    if (typeof source !== 'string') return false;
    if (source.startsWith(DATA_PREFIX)) {
        const value = source.slice(DATA_PREFIX.length);
        if (value.length > Math.ceil(MAX_PREVIEW_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
        try { return hasPdfSignature(atob(value.slice(0, 1372))); } catch { return false; }
    }
    return Boolean(pdfSourceUrl(source));
};

export const pdfFileName = (value = 'Tài liệu.pdf') => {
    const name = Array.from(String(value || 'Tài liệu.pdf')).map(char => char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char).join('').slice(0, 180);
    return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
};

const readHeader = (blob, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(abortError()); };
    signal?.addEventListener('abort', abort, { once: true });
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(new Error('Không đọc được tài liệu. Vui lòng chọn lại.'));
    reader.onabort = () => reject(abortError());
    reader.onloadend = () => signal?.removeEventListener('abort', abort);
    reader.readAsArrayBuffer(blob.slice(0, 1029));
});
const checkedBlob = async (blob, signal) => {
    if (!blob.size || blob.size > MAX_PREVIEW_BYTES) throw new Error(blob.size ? TOO_LARGE : INVALID);
    const header = await readHeader(blob, signal);
    if (!hasPdfSignature(header)) throw new Error(INVALID);
    return blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
};

export const resolvePdfSource = async (source, { signal } = {}) => {
    if (signal?.aborted) throw abortError();
    if (source instanceof Blob) return checkedBlob(source, signal);
    if (typeof source !== 'string') throw new Error(INVALID);
    if (source.startsWith(DATA_PREFIX)) {
        const encoded = source.slice(DATA_PREFIX.length);
        if (encoded.length > Math.ceil(MAX_PREVIEW_BYTES / 3) * 4) throw new Error(TOO_LARGE);
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error(INVALID);
        let binary;
        try { binary = atob(encoded); } catch { throw new Error(INVALID); }
        if (btoa(binary) !== encoded || !hasPdfSignature(binary)) throw new Error(INVALID);
        return checkedBlob(new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], { type: 'application/pdf' }), signal);
    }
    const url = pdfSourceUrl(source);
    if (!url) throw new Error(INVALID);
    let response;
    try {
        // External document hosts never receive the application's cookies or bearer token.
        response = await fetch(url.href, { signal, credentials: url.origin === window.location.origin ? 'same-origin' : 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    } catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw abortError();
        throw new Error('Không tải được PDF. Kiểm tra kết nối; máy chủ lưu tài liệu cần cho phép xem trực tiếp.');
    }
    if (!response.ok) throw new Error([401, 403].includes(response.status) ? 'Bạn không có quyền mở tài liệu hoặc phiên đăng nhập đã hết hạn.' : 'Không tìm thấy hoặc không tải được tài liệu.');
    if (Number(response.headers.get('content-length')) > MAX_PREVIEW_BYTES) {
        await response.body?.cancel(); throw new Error(TOO_LARGE);
    }
    if (!response.body?.getReader) return checkedBlob(await response.blob(), signal);
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
        while (true) {
            if (signal?.aborted) throw abortError();
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_PREVIEW_BYTES) throw new Error(TOO_LARGE);
            chunks.push(value);
        }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    return checkedBlob(new Blob(chunks, { type: 'application/pdf' }), signal);
};
