import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { emptyCv } from './candidateWorkspace';
import { preparedCvBlocks, renderPreparedCv, MAX_APPLICATION_PDF_BYTES } from './preparedCvPdf';

const cv = { ...emptyCv(), fullName: 'Nguyễn Thị Ánh', title: 'Kỹ sư phần mềm', email: 'anh@example.invalid', phone: '0900000000',
    address: 'Đà Nẵng', summary: 'Xây dựng dịch vụ đáng tin cậy.', skills: ['Node.js', 'Kiểm thử'], languages: ['Tiếng Việt'],
    experiences: [{ company: 'Công ty thử nghiệm', position: 'Kỹ sư', from: '2024', to: '2026', description: 'Thiết kế hệ thống.' }],
    educations: [{ school: 'Đại học thử nghiệm', major: 'Công nghệ thông tin', degree: 'Cử nhân', year: '2024' }] };
beforeEach(() => {
    global.fetch = jest.fn(async url => ({ ok: true, arrayBuffer: async () => new Uint8Array(fs.readFileSync(path.join(process.cwd(), 'public', url))).buffer }));
});
afterEach(() => { delete global.fetch; });

test('preserves every reviewed field as plain text and normalizes Vietnamese accents', () => {
    const blocks = preparedCvBlocks({ ...cv, fullName: cv.fullName.normalize('NFD'), summary: '<script>alert(1)</script>' });
    expect(blocks[0].text).toBe(cv.fullName);
    const text = blocks.map(block => block.text).join('\n');
    for (const value of [cv.email, cv.phone, cv.address, cv.title, cv.experiences[0].company, cv.experiences[0].description, cv.educations[0].school, 'Tiếng Việt', '<script>alert(1)</script>']) expect(text).toContain(value);
});
test('generates a real PDF with embedded fonts, a byte limit and no remote requests', async () => {
    const result = await renderPreparedCv(cv);
    const bytes = Uint8Array.from(atob(result.file.split(',')[1]), char => char.charCodeAt(0));
    expect(bytes.length).toBeLessThanOrEqual(MAX_APPLICATION_PDF_BYTES);
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1); expect(parsed.getTitle()).toBe(cv.title); expect(result.pages).toBe(1);
    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual(['/assetsAdmin/fonts/Roboto/Roboto-Regular.ttf', '/assetsAdmin/fonts/Roboto/Roboto-Bold.ttf']);
});
test('wraps long tokens and multi-page experience without silently truncating the content', async () => {
    const result = await renderPreparedCv({ ...cv, summary: 'Kinh nghiệm thực tế. '.repeat(300),
        experiences: [{ ...cv.experiences[0], description: 'A'.repeat(2000) + '\nDÒNG CUỐI CÙNG' }] });
    expect(result.pages).toBeGreaterThan(1); expect(result.pages).toBeLessThan(20);
    const bytes = Uint8Array.from(atob(result.file.split(',')[1]), char => char.charCodeAt(0));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(result.pages);
});
test('rejects unsupported characters rather than publishing missing glyphs', async () => {
    await expect(renderPreparedCv({ ...cv, summary: 'Unsupported 🦄' })).rejects.toThrow('ký tự');
});
test('rejects missing name, excessive text and invalid fields before loading fonts', async () => {
    await expect(renderPreparedCv({ ...cv, fullName: '' })).rejects.toThrow('họ và tên');
    await expect(renderPreparedCv({ ...cv, summary: 'x'.repeat(20000), experiences: Array.from({ length: 6 }, () => ({ description: 'x'.repeat(10000) })) })).rejects.toThrow('60.000');
    await expect(renderPreparedCv({ ...cv, email: {} })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
test('font failures and excessive page count never return a partial PDF', async () => {
    fetch.mockResolvedValueOnce({ ok: false }); await expect(renderPreparedCv(cv)).rejects.toThrow('phông chữ');
    await expect(renderPreparedCv({ ...cv, summary: ('x\n').repeat(1100) })).rejects.toThrow('20 trang');
});
