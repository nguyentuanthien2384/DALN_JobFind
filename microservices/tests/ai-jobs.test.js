import { beforeEach, describe, expect, it, vi } from 'vitest';

const ai = vi.hoisted(() => ({
    askForJson: vi.fn(),
    askForText: vi.fn(),
    askAboutPdf: vi.fn()
}));

vi.mock('../ai-worker/src/libs/claude.js', () => ai);

describe('AI worker jobs', () => {
    beforeEach(() => {
        ai.askForJson.mockReset();
        ai.askForText.mockReset();
        ai.askAboutPdf.mockReset();
    });

    it('builds a safe, bounded moderation prompt', async () => {
        ai.askForJson.mockResolvedValue({ approved: true });
        const { moderateJob } = await import('../ai-worker/src/jobs/moderation.js');
        const huge = `<p>Hello&nbsp; world</p>${'x'.repeat(16000)}`;
        await expect(moderateJob({ name: 'Dev', descriptionHTML: huge })).resolves.toEqual({ approved: true });
        const request = ai.askForJson.mock.calls[0][0];
        expect(request.prompt).toContain('Hello world');
        expect(request.prompt).not.toContain('<p>');
        expect(request.effort).toBe('low');
        expect(request.maxTokens).toBe(4000);
        expect(request.schema.required).toContain('approved');
        expect(request.prompt.length).toBeLessThan(15200);
    });

    it('builds a bounded high-effort matching request', async () => {
        ai.askForJson.mockResolvedValue({ score: 80 });
        const { matchCv } = await import('../ai-worker/src/jobs/smartMatching.js');
        await matchCv({ resumeText: 'r'.repeat(13000), jobTitle: 'Dev', jobDescription: '<b>Node</b>&nbsp;JS' });
        const request = ai.askForJson.mock.calls[0][0];
        expect(request.prompt).toContain('Node JS');
        expect(request.prompt).not.toContain('<b>');
        expect(request.effort).toBe('high');
        expect(request.maxTokens).toBe(8000);
        expect(request.prompt.match(/r/g).length).toBeLessThanOrEqual(12010);
    });

    it('passes PDF bytes, filename and extraction schema to Claude', async () => {
        ai.askAboutPdf.mockResolvedValue({ fullName: 'Lan' });
        const { parseResume } = await import('../ai-worker/src/jobs/resumeParser.js');
        await expect(parseResume({ fileBase64: 'PDF', fileName: 'cv.pdf' })).resolves.toEqual({ fullName: 'Lan' });
        expect(ai.askAboutPdf).toHaveBeenCalledWith(expect.objectContaining({
            base64Pdf: 'PDF', effort: 'low', maxTokens: 8000,
            prompt: expect.stringContaining('cv.pdf'),
            schema: expect.objectContaining({ additionalProperties: false })
        }));
    });

    it('generates Vietnamese/English letters, strips HTML and counts words', async () => {
        ai.askForText.mockResolvedValueOnce('one two three').mockResolvedValueOnce('xin chào');
        const { generateCoverLetter } = await import('../ai-worker/src/jobs/coverLetter.js');
        const en = await generateCoverLetter({ resumeText: 'CV', jobTitle: 'Dev', jobDescription: '<p>Build&nbsp;apps</p>', companyName: 'ACME' });
        expect(en).toEqual({ letter: 'one two three', language: 'en', wordCount: 3 });
        expect(ai.askForText.mock.calls[0][0].prompt).toContain('Write the letter in English.');
        expect(ai.askForText.mock.calls[0][0].prompt).toContain('Build apps');
        const viResult = await generateCoverLetter({ resumeText: 'CV', jobTitle: 'Dev', jobDescription: '', companyName: '', language: 'vi' });
        expect(viResult.language).toBe('vi');
        expect(ai.askForText.mock.calls[1][0].prompt).toContain('Vietnamese');
    });
});
