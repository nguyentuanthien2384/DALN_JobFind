import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

const invalidPdf = () => Object.assign(new Error('Không đọc được chữ trong CV PDF'), { code: 'AI_PDF_TEXT_UNAVAILABLE' });

// The third-party Claude gateway does not consistently accept document blocks.
// Extract selectable text locally, then send that text through the same Claude
// schema call used by other AI tasks. Never log or persist the extracted text.
//
// ===== PDF.js (pdfjs-dist, thu vien PDF cua Mozilla) =====
// Doc lop chu (text layer) cua tung trang roi ghep lai. Chi doc duoc PDF co chu that;
// CV la anh quet thi khong co chu => bao loi ro rang (can OCR truoc), khong gui anh len AI.
// - isEvalSupported: false: khong cho PDF.js dung eval khi xu ly font - chan lo hong
//   chay JavaScript tuy y tu file PDF doc hai (CVE-2024-4367).
// - Gioi han 20 trang / 30.000 ky tu: chong file qua lon lam cham worker va ton token.
export async function extractPdfText(base64Pdf) {
    const loading = getDocument({
        data: new Uint8Array(Buffer.from(base64Pdf, 'base64')),
        useSystemFonts: true, isEvalSupported: false, disableFontFace: true,
        verbosity: VerbosityLevel.ERRORS
    });
    try {
        const pdf = await loading.promise;
        if (pdf.numPages < 1 || pdf.numPages > 20) throw invalidPdf();
        let text = '';
        for (let number = 1; number <= pdf.numPages; number += 1) {
            const page = await pdf.getPage(number);
            const content = await page.getTextContent();
            const line = content.items.map(item => item.str || '').join(' ').trim();
            if (text.length + line.length > 30000) throw invalidPdf();
            text += `${line}\n`;
        }
        if (!text.trim()) throw invalidPdf();
        return text.trim();
    } catch {
        throw invalidPdf();
    } finally {
        await loading.destroy().catch(() => {});
    }
}
