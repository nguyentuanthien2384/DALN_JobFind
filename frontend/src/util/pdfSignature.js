// Keep the supported header prefix in sync with microservices/shared/aiPdf.js.
// This is an admission check; PDF.js still parses the complete document.
export const hasPdfSignature = bytes => {
    if (!bytes || bytes.length < 8) return false;
    const at = typeof bytes === 'string' ? index => bytes.charCodeAt(index) : index => bytes[index];
    let offset = at(0) === 0xef && at(1) === 0xbb && at(2) === 0xbf ? 3 : 0;
    while (offset < Math.min(bytes.length, 1024) && [9, 10, 12, 13, 32].includes(at(offset))) offset += 1;
    return offset < 1024 && [37, 80, 68, 70, 45].every((byte, index) => at(offset + index) === byte);
};
