import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { cvPayload } from './candidateWorkspace';

export const MAX_APPLICATION_PDF_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 20, MAX_TEXT = 60000;
const normalize = value => value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').trim();

// Plain text only. No HTML, remote URLs, AI calls, or saved browser state.
export const preparedCvBlocks = source => {
    const cv = cvPayload(source);
    if (!cv.fullName.trim()) throw new Error('Bổ sung họ và tên trong CV trước khi tạo bản ứng tuyển.');
    const blocks = [];
    const add = (text, kind = 'body') => { if (text.trim()) blocks.push({ text: normalize(text), kind }); };
    add(cv.fullName, 'name'); add(cv.title, 'subtitle');
    add([cv.email, cv.phone].filter(Boolean).join(' | ')); add(cv.address);
    const section = (title, rows) => {
        if (!rows.some(row => row.text.trim())) return;
        add(title, 'heading'); rows.forEach(row => add(row.text, row.kind));
    };
    section('GIỚI THIỆU', [{ text: cv.summary }]);
    section('KỸ NĂNG', cv.skills.map(text => ({ text: '- ' + text })));
    section('KINH NGHIỆM', cv.experiences.flatMap(row => [
        { text: [row.position, row.company].filter(Boolean).join(' | '), kind: 'strong' },
        { text: [row.from, row.to].filter(Boolean).join(' - '), kind: 'muted' }, { text: row.description }
    ]));
    section('HỌC VẤN', cv.educations.flatMap(row => [
        { text: row.school, kind: 'strong' }, { text: [row.major, row.degree, row.year].filter(Boolean).join(' | ') }
    ]));
    section('NGÔN NGỮ', cv.languages.map(text => ({ text: '- ' + text })));
    if (blocks.reduce((sum, block) => sum + block.text.length, 0) > MAX_TEXT) {
        throw new Error('CV quá dài để tạo bản ứng tuyển. Hãy rút gọn còn tối đa 60.000 ký tự hoặc chọn tệp PDF của bạn.');
    }
    return blocks;
};

const wrap = (text, font, size, width) => {
    const lines = [];
    for (const paragraph of text.split('\n')) {
        let line = '';
        for (let word of paragraph.split(/ +/).filter(Boolean)) {
            if (line && font.widthOfTextAtSize(line + ' ' + word, size) <= width) { line += ' ' + word; continue; }
            if (line) { lines.push(line); line = ''; }
            // Split a long URL/word by code point without clipping or dropping it.
            while (font.widthOfTextAtSize(word, size) > width) {
                const chars = Array.from(word); let low = 1, high = chars.length;
                while (low < high) {
                    const middle = Math.ceil((low + high) / 2);
                    if (font.widthOfTextAtSize(chars.slice(0, middle).join(''), size) <= width) low = middle;
                    else high = middle - 1;
                }
                lines.push(chars.slice(0, low).join('')); word = chars.slice(low).join('');
            }
            line = word;
        }
        lines.push(line);
    }
    return lines;
};

const loadFont = async name => {
    const response = await fetch(`${process.env.PUBLIC_URL || ''}/assetsAdmin/fonts/Roboto/Roboto-${name}.ttf`, { credentials: 'omit' });
    if (!response.ok) throw new Error('Chưa tải được phông chữ cho PDF. Hãy thử tạo bản xem lại lần nữa.');
    return response.arrayBuffer();
};

export const renderPreparedCv = async source => {
    const blocks = preparedCvBlocks(source);
    const title = normalize(source.title || 'CV ứng tuyển');
    const [regularBytes, boldBytes] = await Promise.all([loadFont('Regular'), loadFont('Bold')]);
    const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
    const regular = await doc.embedFont(regularBytes, { subset: true });
    const bold = await doc.embedFont(boldBytes, { subset: true });
    const boldCharacters = new Set(bold.getCharacterSet());
    const supported = new Set(regular.getCharacterSet().filter(code => boldCharacters.has(code)));
    for (const block of blocks) {
        if (Array.from(block.text).some(char => char !== '\n' && !supported.has(char.codePointAt(0)))) {
            throw new Error('CV có ký tự phông chữ chưa hỗ trợ. Hãy chỉnh lại ký tự đó hoặc dùng tệp PDF của bạn; nội dung sẽ không bị tự bỏ bớt.');
        }
    }
    const width = 595.28, height = 841.89, margin = 48;
    let page, y;
    const nextPage = () => {
        if (doc.getPageCount() >= MAX_PAGES) throw new Error('CV vượt quá 20 trang. Hãy rút gọn hoặc chọn tệp PDF của bạn.');
        page = doc.addPage([width, height]); y = height - margin;
    };
    nextPage();
    for (const block of blocks) {
        const isHeading = block.kind === 'heading';
        const font = ['name', 'heading', 'strong'].includes(block.kind) ? bold : regular;
        const size = block.kind === 'name' ? 23 : block.kind === 'subtitle' ? 13 : isHeading ? 11 : 10.5;
        const lineHeight = size * 1.45;
        if (isHeading) { if (y < margin + 70) nextPage(); y -= 14; }
        for (const line of wrap(block.text, font, size, width - margin * 2)) {
            if (y < margin + lineHeight) nextPage();
            page.drawText(line, { x: margin, y: y - size, size, font,
                color: isHeading ? rgb(.14, .39, .32) : block.kind === 'muted' ? rgb(.36, .4, .45) : rgb(.09, .14, .21) });
            y -= lineHeight;
        }
        y -= 5;
    }
    doc.getPages().forEach((entry, index) => entry.drawText(`${index + 1} / ${doc.getPageCount()}`, {
        x: width - margin - 35, y: 24, size: 9, font: regular, color: rgb(.4, .44, .49)
    }));
    doc.setTitle(title); doc.setCreator('Job Finder');
    const bytes = await doc.save();
    if (bytes.length > MAX_APPLICATION_PDF_BYTES) throw new Error('Bản PDF vượt quá 2 MiB. Hãy rút gọn CV hoặc chọn tệp PDF của bạn.');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { file: `data:application/pdf;base64,${btoa(binary)}`, blob: new Blob([bytes], { type: 'application/pdf' }), pages: doc.getPageCount() };
};
