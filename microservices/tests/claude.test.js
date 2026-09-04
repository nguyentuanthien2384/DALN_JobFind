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

    it.each([
        [{ stop_reason: 'refusal', stop_details: { category: 'safety' }, content: [] }, /từ chối.*safety/],
        [{ stop_reason: 'max_tokens', content: [] }, /cắt giữa chừng/],
        [{ stop_reason: 'end_turn', content: [{ type: 'thinking' }] }, /nội dung rỗng/],
        [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not-json' }] }, /Không đọc được JSON/]
    ])('rejects malformed JSON responses: %#', async (response, message) => {
        sdk.create.mockResolvedValue(response);
        await expect(api.askForJson({ system: '', prompt: '', schema: {} })).rejects.toThrow(message);
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
    });
});
