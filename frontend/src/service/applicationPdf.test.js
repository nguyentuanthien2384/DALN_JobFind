import { applicationPdf, MAX_APPLICATION_PDF_BYTES, APPLICATION_PDF_INVALID, APPLICATION_PDF_TOO_LARGE } from './applicationPdf';

const encode = (binary, mime = 'application/pdf') => `data:${mime};base64,${btoa(binary)}`;
const pdf = '%PDF-1.7\nCV fixture';

test.each(['application/pdf', 'application/octet-stream', 'application/x-pdf', ''])('accepts PDF bytes with %s MIME and preserves every byte', mime => {
    const binary = '\xef\xbb\xbf\r\n ' + pdf;
    const result = applicationPdf(encode(binary, mime));
    expect(result).toEqual({ file: encode(binary), size: binary.length });
    expect(atob(result.file.split(',')[1])).toBe(binary);
});

test('accepts standard PDFs, whitespace prefixes and the supported header boundary', () => {
    for (const prefix of ['', ' \t\r\n\f', ' '.repeat(1023)]) {
        expect(applicationPdf(encode(prefix + pdf)).file).toBe(encode(prefix + pdf));
    }
});

test.each([undefined, '', 'https://example.test/cv.pdf', 'data:application/pdf;base64,%%%=',
    encode('<html>not a PDF</html>'), encode('garbage' + pdf), encode(' '.repeat(1024) + pdf),
    'data:application/pdf;base64,JVBERi0xLjcKZml4dHVyZR=='])('rejects invalid or noncanonical PDF data: %p', value => {
    expect(() => applicationPdf(value)).toThrow(APPLICATION_PDF_INVALID);
});

test('accepts exactly 2 MiB and distinguishes larger files from invalid PDFs', () => {
    const binary = pdf.padEnd(MAX_APPLICATION_PDF_BYTES, ' ');
    expect(applicationPdf(encode(binary)).size).toBe(MAX_APPLICATION_PDF_BYTES);
    expect(() => applicationPdf(encode(binary + ' '))).toThrow(APPLICATION_PDF_TOO_LARGE);
    expect(() => applicationPdf(encode(binary + ' '.repeat(1024)))).toThrow(APPLICATION_PDF_TOO_LARGE);
});
