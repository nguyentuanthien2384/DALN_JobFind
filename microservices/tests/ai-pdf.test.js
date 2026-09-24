import { describe, expect, it } from 'vitest';
import { isValidAiPdf, MAX_AI_PDF_BYTES } from '../shared/aiPdf.js';

describe('shared AI PDF admission', () => {
    it.each(['', ' \t\r\n', '\ufeff\n'])('accepts supported prefix %# consistently', prefix => {
        expect(isValidAiPdf(Buffer.from(`${prefix}%PDF-1.7\n`).toString('base64'))).toBe(true);
    });
    it.each([null, 'JVBERi0xLjQ===', Buffer.from('garbage%PDF-1.7\n').toString('base64'),
        Buffer.from(`${' '.repeat(1024)}%PDF-1.7\n`).toString('base64')])('rejects invalid admission %#', value => {
        expect(isValidAiPdf(value)).toBe(false);
    });
    it('enforces decoded byte size despite base64 padding', () => {
        const file = Buffer.alloc(MAX_AI_PDF_BYTES + 1, 32); file.write('%PDF-1.7\n');
        expect(isValidAiPdf(file.toString('base64'))).toBe(false);
        expect(isValidAiPdf(file.subarray(0, MAX_AI_PDF_BYTES).toString('base64'))).toBe(true);
    });
});
