import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => {
    const create = vi.fn();
    const finalMessage = vi.fn();
    const stream = vi.fn(() => ({ finalMessage }));
    class Anthropic {
        constructor(options) {
            this.options = options;
            this.beta = { messages: { create, stream } };
        }
    }
    return { create, finalMessage, stream, Anthropic };
});

vi.mock('@anthropic-ai/sdk', () => ({ default: sdk.Anthropic }));

describe('Claude adapter', () => {
    let api;

    beforeEach(async () => {
        sdk.create.mockReset();
        sdk.stream.mockClear();
        sdk.finalMessage.mockReset();
        api = await import('../ai-worker/src/libs/claude.js');
    });

    afterEach(() => vi.unstubAllEnvs());

    it('reports whether an API key is configured', () => {
        expect(api.client.options).toEqual({ maxRetries: 0 });
        vi.stubEnv('ANTHROPIC_API_KEY', 'key');
        expect(api.isConfigured()).toBe(true);
        vi.stubEnv('ANTHROPIC_API_KEY', '');
        expect(api.isConfigured()).toBe(false);
        vi.stubEnv('ANTHROPIC_API_KEY', '   ');
        expect(api.isConfigured()).toBe(false);
    });

    it('passes a gateway root and x-api-key credentials to the Anthropic SDK', () => {
        const gateway = api.createClaudeClient({
            ANTHROPIC_BASE_URL: 'https://1gw.gwai.cloud',
            ANTHROPIC_API_KEY: 'gateway-test-key'
        });
        expect(gateway.options).toEqual({
            maxRetries: 0,
            baseURL: 'https://1gw.gwai.cloud',
            apiKey: 'gateway-test-key',
            authToken: null
        });
    });

    it('requests schema-constrained JSON and extracts only text blocks', async () => {
        sdk.create.mockResolvedValue({
            stop_reason: 'end_turn',
            content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: ' {"ok":' }, { type: 'text', text: 'true} ' }]
        });
        const schema = { type: 'object' };
        await expect(api.askForJson({ system: 'sys', prompt: 'p', schema })).resolves.toEqual({ ok: true });
        expect(sdk.create).toHaveBeenCalledWith(expect.objectContaining({
            max_tokens: 8000,
            output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
            messages: [{ role: 'user', content: 'p' }]
        }));
    });

    it('allows a specific model for gateway text extraction', async () => {
        sdk.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }] });
        await api.askForJson({ system: 'sys', prompt: 'p', schema: { type: 'object' }, model: 'claude-sonnet-5' });
        expect(sdk.create).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-5' }));
    });

    it.each([
        [{ stop_reason: 'refusal', stop_details: { category: 'safety' }, content: [] }, /từ chối.*safety/],
        [{ stop_reason: 'max_tokens', content: [] }, /cắt giữa chừng/],
        [{ stop_reason: 'end_turn', content: [{ type: 'thinking' }] }, /nội dung rỗng/],
        [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not-json' }] }, /Không đọc được JSON/]
    ])('rejects malformed JSON responses: %#', async (response, message) => {
        sdk.create.mockResolvedValue(response);
        await expect(api.askForJson({ system: '', prompt: '', schema: {} })).rejects.toThrow(message);
    });

    it('rejects parseable JSON that omits or mistypes required fields', async () => {
        const schema = {
            type: 'object', properties: { approved: { type: 'boolean' } },
            required: ['approved'], additionalProperties: false
        };
        sdk.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] });
        await expect(api.askForJson({ system: '', prompt: '', schema })).rejects.toThrow(/không đúng cấu trúc/);
        sdk.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"approved":"yes"}' }] });
        await expect(api.askForJson({ system: '', prompt: '', schema })).rejects.toThrow(/không đúng cấu trúc/);
    });

    it('streams normal text with caller token/effort options', async () => {
        sdk.finalMessage.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: ' hello ' }] });
        await expect(api.askForText({ system: 's', prompt: 'p', effort: 'high', maxTokens: 99 })).resolves.toBe('hello');
        expect(sdk.stream).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 99, output_config: { effort: 'high' } }));
    });

    it('rejects refused or empty streamed text', async () => {
        sdk.finalMessage.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] });
        await expect(api.askForText({ system: '', prompt: '' })).rejects.toThrow(/từ chối/);
        sdk.finalMessage.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [] });
        await expect(api.askForText({ system: '', prompt: '' })).rejects.toThrow(/rỗng/);
        sdk.finalMessage.mockResolvedValueOnce({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial letter' }] });
        await expect(api.askForText({ system: '', prompt: '' })).rejects.toThrow(/cắt giữa chừng/);
    });

    it('sends PDF data as a document and parses JSON', async () => {
        sdk.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"name":"A"}' }] });
        await expect(api.askAboutPdf({ system: 's', prompt: 'p', base64Pdf: 'BASE64', schema: { type: 'object' } }))
            .resolves.toEqual({ name: 'A' });
        const content = sdk.create.mock.calls[0][0].messages[0].content;
        expect(content[0].source).toEqual({ type: 'base64', media_type: 'application/pdf', data: 'BASE64' });
        expect(content[1]).toEqual({ type: 'text', text: 'p' });
    });

    it('handles refused, empty, and invalid PDF model output', async () => {
        sdk.create.mockResolvedValueOnce({ stop_reason: 'refusal', stop_details: { category: 'x' }, content: [] });
        await expect(api.askAboutPdf({ system: '', prompt: '', base64Pdf: '', schema: {} })).rejects.toThrow(/CV.*x/);
        sdk.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [] });
        await expect(api.askAboutPdf({ system: '', prompt: '', base64Pdf: '', schema: {} })).rejects.toThrow(/rỗng/);
        sdk.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{' }] });
        await expect(api.askAboutPdf({ system: '', prompt: '', base64Pdf: '', schema: {} })).rejects.toThrow(/Không đọc được JSON/);
        sdk.create.mockResolvedValueOnce({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"name":"A"}' }] });
        await expect(api.askAboutPdf({ system: '', prompt: '', base64Pdf: '', schema: {} })).rejects.toThrow(/cắt giữa chừng/);
    });

    it('rejects incomplete but parseable PDF extraction output', async () => {
        sdk.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"fullName":"Lan"}' }] });
        const schema = {
            type: 'object', properties: { fullName: { type: 'string' }, skills: { type: 'array', items: { type: 'string' } } },
            required: ['fullName', 'skills'], additionalProperties: false
        };
        await expect(api.askAboutPdf({ system: '', prompt: '', base64Pdf: 'PDF', schema })).rejects.toThrow(/không đúng cấu trúc/);
    });

    it('compiles and checks every real structured job schema', async () => {
        const response = (value) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(value) }] });
        const { moderateJob } = await import('../ai-worker/src/jobs/moderation.js');
        const { matchCv } = await import('../ai-worker/src/jobs/smartMatching.js');
        const { parseResume } = await import('../ai-worker/src/jobs/resumeParser.js');
        sdk.create.mockResolvedValueOnce(response({ approved: true }));
        await expect(moderateJob({ name: 'Dev', descriptionHTML: 'Build' })).rejects.toThrow(/không đúng cấu trúc/);
        sdk.create.mockResolvedValueOnce(response({ approved: true, riskLevel: 'an_toan', violations: [], reason: 'OK' }));
        await expect(moderateJob({ name: 'Dev', descriptionHTML: 'Build' })).resolves.toHaveProperty('approved', true);
        sdk.create.mockResolvedValueOnce(response({ score: 80, verdict: 'phu_hop', matchedSkills: [], missingSkills: [], strengths: [], concerns: [], summary: 'OK' }));
        await expect(matchCv({ resumeText: 'CV', jobTitle: 'Dev', jobDescription: 'Build' })).resolves.toHaveProperty('score', 80);
        sdk.create.mockResolvedValueOnce(response({
            fullName: null, email: null, phone: null, address: null, title: null, summary: null,
            yearsOfExperience: null, skills: [], experiences: [], educations: [], languages: []
        }));
        await expect(parseResume({ fileBase64: Buffer.from('%PDF-1.4\n').toString('base64') })).resolves.toHaveProperty('skills');
    });
});
