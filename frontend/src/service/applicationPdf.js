import { hasPdfSignature } from '../util/pdfSignature';

export const MAX_APPLICATION_PDF_BYTES = 2 * 1024 * 1024;
export const APPLICATION_PDF_TOO_LARGE = 'Tệp CV vượt quá 2 MiB. Vui lòng chọn tệp nhỏ hơn.';
export const APPLICATION_PDF_INVALID = 'Tệp không phải PDF hợp lệ. Vui lòng chọn lại CV ở định dạng PDF.';

// FileReader may report an empty or generic MIME type. Validate the bytes, then
// normalize only the data URL's MIME label; preserve the original PDF unchanged.
export const applicationPdf = value => {
    if (typeof value !== 'string') throw new Error(APPLICATION_PDF_INVALID);
    if (value.length > 4 * Math.ceil(MAX_APPLICATION_PDF_BYTES / 3) + 256) throw new Error(APPLICATION_PDF_TOO_LARGE);
    const match = /^data:[^;,]*;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) throw new Error(APPLICATION_PDF_INVALID);
    let binary;
    try { binary = atob(match[1]); } catch { throw new Error(APPLICATION_PDF_INVALID); }
    if (binary.length > MAX_APPLICATION_PDF_BYTES) throw new Error(APPLICATION_PDF_TOO_LARGE);
    if (btoa(binary) !== match[1] || !hasPdfSignature(binary)) throw new Error(APPLICATION_PDF_INVALID);
    return { file: `data:application/pdf;base64,${match[1]}`, size: binary.length };
};
