import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../ai-worker/src/libs/pdfText.js';

describe('local PDF text extraction for Claude gateways', () => {
    it('extracts real selectable text from a small synthetic resume', async () => {
        const pdf = await readFile(new URL('./fixtures/ai-synthetic-resume.pdf', import.meta.url));
        const text = await extractPdfText(pdf.toString('base64'));
        expect(text).toContain('TRAN MINH AN');
        expect(text).toContain('minhan@example.test');
        expect(text).toContain('React');
    });

    it('fails clearly on unreadable PDF bytes', async () => {
        await expect(extractPdfText(Buffer.from('not a PDF').toString('base64')))
            .rejects.toHaveProperty('code', 'AI_PDF_TEXT_UNAVAILABLE');
    });
});
