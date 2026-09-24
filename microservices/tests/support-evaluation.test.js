import { describe, expect, it } from 'vitest';
import { assessSupportTurn, readSupportStream } from '../scripts/lib/supportEvaluation.mjs';

const response = text => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
const event = (name, payload) => `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
const answer = { text: 'Xin chào', status: 'complete', mode: 'claude' };
const assess = (parsed, overrides = {}) => assessSupportTurn({ responseStatus: 200, parsed, answer, scenario: {}, ...overrides });

describe('live support evaluation evidence', () => {
    it('does not pass a truncated stream because answer text mentions a done event', async () => {
        const text = 'event: done';
        const parsed = await readSupportStream(response(event('token', { text })));
        expect(assess(parsed, { answer: { ...answer, text } }).automaticChecks.completedStream).toBe(false);
    });
    it('distinguishes a local fallback from a successful live model answer', async () => {
        const parsed = await readSupportStream(response(event('token', { text: answer.text }) + event('done', {})));
        expect(assess(parsed).automaticPass).toBe(true);
        expect(assess(parsed, { answer: { ...answer, mode: 'knowledge' } }).automaticPass).toBe(false);
        expect(assess(parsed, { answer: { ...answer, mode: 'account' }, scenario: { expectedLocalRead: true } }).automaticPass).toBe(true);
    });
    it('rejects skipped tools, invented job links, wrong follow-up and unreviewed sources', async () => {
        const text = 'Xem /detail-job/999';
        const parsed = await readSupportStream(response(event('token', { text }) + event('tool', { name: 'get_job_details', job: { id: 42 } }) + event('done', {})));
        const result = assess(parsed, { answer: { ...answer, text, sources: [{ id: 'evil', href: 'https://unreviewed.test' }] }, scenario: { requiredTool: 'search_jobs', followUpJobId: 43 } });
        expect(result.automaticChecks).toMatchObject({ requiredToolCalled: false, linksReferToVerifiedJobs: false, expectedFollowUpJob: false, sourcesAreReviewed: false });
    });
    it('checks persisted text and failed stream events instead of HTTP 200 alone', async () => {
        const parsed = await readSupportStream(response(event('token', { text: 'Một phần' }) + event('error', {}) + event('done', {})));
        expect(assess(parsed).automaticChecks).toMatchObject({ httpSuccess: true, completedStream: false, storedTextMatchesStream: false });
    });
    it('handles UTF-8 characters and SSE delimiters split across chunks', async () => {
        const bytes = new TextEncoder().encode((event('token', { text: answer.text }) + event('done', {})).replaceAll('\n', '\r\n'));
        const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
        const parsed = await readSupportStream(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }), { startedAt: 100, now: () => 125 });
        expect(parsed.text).toBe(answer.text); expect(parsed.firstTextMs).toBe(25);
        expect(assess(parsed).automaticPass).toBe(true);
    });
});
