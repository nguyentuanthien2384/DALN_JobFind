export const MAX_AI_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_AI_PDF_BASE64_LENGTH = 4 * Math.ceil(MAX_AI_PDF_BYTES / 3);

// Match the browser and worker at the HTTP boundary. Some PDF generators add
// a UTF-8 BOM/whitespace before the header. This checks format/size only; actual
// document decoding still happens before the provider receives any content.
export const isValidAiPdf = (encoded) => {
    if (typeof encoded !== 'string' || encoded.length === 0 ||
        encoded.length > MAX_AI_PDF_BASE64_LENGTH || encoded.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length < 8 || bytes.length > MAX_AI_PDF_BYTES || bytes.toString('base64') !== encoded) return false;
    let headerAt = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0;
    while (headerAt < Math.min(bytes.length, 1024) && [9, 10, 12, 13, 32].includes(bytes[headerAt])) headerAt += 1;
    return headerAt < 1024 && bytes.subarray(headerAt, headerAt + 5).toString('ascii') === '%PDF-';
};
