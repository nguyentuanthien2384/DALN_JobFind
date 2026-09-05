import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';

const mocks = vi.hoisted(() => ({
    pool: { query: vi.fn() },
    conn: { query: vi.fn() },
    withTransaction: vi.fn(),
    publish: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn() }
}));
vi.mock('../job-core-service/src/libs/db.js', () => ({ pool: mocks.pool, withTransaction: mocks.withTransaction }));
vi.mock('../shared/outboxPublisher.js', () => ({ publishOutboxEvent: mocks.publish }));
vi.mock('../shared/logger.js', () => ({ createLogger: () => mocks.logger }));

import { parseResume, matchCv, coverLetter } from '../job-core-service/src/controllers/aiController.js';
import { enqueueAiTask, MAX_AI_REQUEST_BYTES } from '../job-core-service/src/libs/aiTaskRequest.js';

const cases = [
    ['parse_resume', parseResume, { fileBase64: 'private-base64', fileName: 'cv.pdf' }],
    ['match_cv', matchCv, { resumeText: 'private-resume', jobId: 1 }],
    ['cover_letter', coverLetter, { resumeText: 'private-resume', jobId: '1', language: 'vi' }]
];
const request = (body) => makeReq({ body, headers: { 'x-user-id': '9' } });

beforeEach(() => {
    mocks.pool.query.mockReset().mockResolvedValue([[{ name: 'Dev', descriptionHTML: '<p>Build</p>', companyName: 'Company' }]]);
    mocks.conn.query.mockReset().mockResolvedValue([{ affectedRows: 1 }]);
    mocks.withTransaction.mockReset().mockImplementation((work) => work(mocks.conn));
    mocks.publish.mockReset();
    mocks.logger.error.mockReset();
});

describe('candidate AI request durability', () => {
    it.each(cases)('%s saves task and full event on one connection without publishing from HTTP', async (type, handler, body) => {
        const res = makeRes();
        await handler(request(body), res);
        expect(res.statusCode).toBe(202);
        const [task, event] = mocks.conn.query.mock.calls;
        expect(task[0]).toContain('INSERT INTO ai_tasks');
        expect(task[1].slice(0, 4)).toEqual([res.body.taskId, type, 'pending', 9]);
        expect(task[1][4]).not.toContain('private-');
        expect(event[0]).toContain('INSERT INTO outbox_events');
        expect(event[1].slice(0, 4)).toEqual([res.body.taskId, 'ai_task', res.body.taskId, `ai.${type}`]);
        expect(JSON.parse(event[1][4])).toMatchObject({ taskId: res.body.taskId, ...(type === 'parse_resume' ? { fileBase64: body.fileBase64 } : { resumeText: body.resumeText }) });
        expect(mocks.withTransaction).toHaveBeenCalledOnce();
        expect(mocks.publish).not.toHaveBeenCalled();
    });

    it('does not report accepted until commit has been acknowledged', async () => {
        let releaseCommit;
        let reachedCommit;
        const waiting = new Promise((resolve) => { reachedCommit = resolve; });
        const committed = new Promise((resolve) => { releaseCommit = resolve; });
        mocks.withTransaction.mockImplementation(async (work) => {
            await work(mocks.conn);
            reachedCommit();
            await committed;
        });
        const res = makeRes();
        const pending = parseResume(request({ fileBase64: 'PDF' }), res);
        await waiting;
        expect(res.json).not.toHaveBeenCalled();
        releaseCommit();
        await pending;
        expect(res.statusCode).toBe(202);
    });

    it.each(cases)('%s handles an outbox insert failure without leaking private SQL or reporting 202', async (_type, handler, body) => {
        mocks.conn.query.mockResolvedValueOnce([{ affectedRows: 1 }])
            .mockRejectedValueOnce(Object.assign(new Error('private-resume in SQL parameters'), { code: 'ER_SIGNAL_EXCEPTION', sql: 'private-base64' }));
        const res = makeRes();
        await handler(request(body), res);
        expect(res.statusCode).toBe(500);
        expect(res.body).not.toHaveProperty('taskId');
        expect(JSON.stringify([res.body, mocks.logger.error.mock.calls])).not.toContain('private-');
        expect(mocks.publish).not.toHaveBeenCalled();
    });

    it.each(cases)('%s does not retry an uncertain commit or claim success', async (_type, handler, body) => {
        mocks.withTransaction.mockImplementation(async (work) => {
            await work(mocks.conn);
            throw Object.assign(new Error('commit response lost'), { code: 'ECONNRESET' });
        });
        const res = makeRes();
        await handler(request(body), res);
        expect(res.statusCode).toBe(500);
        expect(res.body).not.toHaveProperty('taskId');
        expect(mocks.withTransaction).toHaveBeenCalledOnce();
        expect(mocks.conn.query).toHaveBeenCalledTimes(2);
    });

    it.each([matchCv, coverLetter])('handles a failed job lookup as an HTTP error', async (handler) => {
        mocks.pool.query.mockRejectedValue(new Error('lookup failed with private SQL'));
        const res = makeRes();
        await handler(request({ resumeText: 'CV', jobId: 1 }), res);
        expect(res.statusCode).toBe(500);
        expect(mocks.withTransaction).not.toHaveBeenCalled();
    });

    it('preserves complete Unicode metadata instead of cutting JSON at 60000 characters', async () => {
        const fileName = 'ắ'.repeat(65000) + '.pdf';
        await parseResume(request({ fileBase64: 'PDF', fileName }), makeRes());
        expect(JSON.parse(mocks.conn.query.mock.calls[0][1][4])).toEqual({ fileName });
        expect(JSON.parse(mocks.conn.query.mock.calls[1][1][4]).fileName).toBe(fileName);
    });

    it('assigns independent IDs to independent HTTP submissions, including identical inputs', async () => {
        const first = makeRes();
        const second = makeRes();
        await parseResume(request({ fileBase64: 'PDF' }), first);
        await parseResume(request({ fileBase64: 'PDF' }), second);
        expect(first.body.taskId).not.toBe(second.body.taskId);
    });
});

describe('bounded AI input before durable enqueue', () => {
    it.each([
        [parseResume, { fileBase64: {} }],
        [parseResume, { fileBase64: '  ' }],
        [parseResume, { fileBase64: 'PDF', fileName: [] }],
        [matchCv, { resumeText: ['CV'], jobId: 1 }],
        [matchCv, { resumeText: 'CV', jobId: true }],
        [matchCv, { resumeText: 'CV', jobId: [] }],
        [matchCv, { resumeText: 'CV', jobId: '1 OR 1=1' }],
        [matchCv, { resumeText: 'CV', jobId: Number.MAX_SAFE_INTEGER + 1 }],
        [coverLetter, { resumeText: 'CV', jobId: 1, language: {} }],
        [coverLetter, { resumeText: '\n', jobId: 1 }]
    ])('rejects invalid field types without database work', async (handler, body) => {
        const res = makeRes();
        await handler(request(body), res);
        expect(res.statusCode).toBe(400);
        expect(mocks.pool.query).not.toHaveBeenCalled();
        expect(mocks.withTransaction).not.toHaveBeenCalled();
    });

    it('accepts the exact 8 MiB JSON boundary and rejects one additional byte', async () => {
        const overhead = Buffer.byteLength(JSON.stringify({ fileBase64: '', taskId: 'x'.repeat(36) }));
        const payload = { fileBase64: 'x'.repeat(MAX_AI_REQUEST_BYTES - overhead) };
        const options = { type: 'parse_resume', userId: 9, input: {}, payload };
        await enqueueAiTask(options);
        expect(Buffer.byteLength(mocks.conn.query.mock.calls[1][1][4])).toBe(MAX_AI_REQUEST_BYTES);
        mocks.withTransaction.mockClear();
        await expect(enqueueAiTask({ ...options, payload: { fileBase64: `${payload.fileBase64}x` } }))
            .rejects.toHaveProperty('code', 'AI_REQUEST_TOO_LARGE');
        expect(mocks.withTransaction).not.toHaveBeenCalled();
    });

    it.each([
        [parseResume, { fileBase64: 'x'.repeat(MAX_AI_REQUEST_BYTES) }],
        [matchCv, { resumeText: 'ắ'.repeat(Math.ceil(MAX_AI_REQUEST_BYTES / 3)), jobId: 1 }],
        [coverLetter, { resumeText: '\u0000'.repeat(Math.ceil(MAX_AI_REQUEST_BYTES / 6)), jobId: 1 }]
    ])('returns 413 for oversized serialized payloads, counting Unicode and JSON escaping', async (handler, body) => {
        const res = makeRes();
        await handler(request(body), res);
        expect(res.statusCode).toBe(413);
        expect(mocks.withTransaction).not.toHaveBeenCalled();
    });
});
