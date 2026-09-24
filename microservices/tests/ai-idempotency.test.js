import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';

const mocks = vi.hoisted(() => ({ pool: { query: vi.fn() }, conn: { query: vi.fn() }, transaction: vi.fn(), enqueue: vi.fn() }));
vi.mock('../job-core-service/src/libs/db.js', () => ({ pool: mocks.pool, withTransaction: mocks.transaction }));
vi.mock('../job-core-service/src/libs/outbox.js', () => ({ enqueueOutboxEvent: mocks.enqueue }));
import { parseResume, generateCv, matchCv, coverLetter } from '../job-core-service/src/controllers/aiController.js';
import { ensureAiRequestTable } from '../job-core-service/src/libs/aiTaskRequest.js';

let keys;
let tasks;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64');
const OTHER_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<</Type /Page>>\nendobj\n%%EOF').toString('base64');
const cases = [
    ['parse', parseResume, { fileBase64: PDF, fileName: 'cv.pdf' }],
    ['generate', generateCv, { sourceText: 'private-facts', language: 'vi', jobId: 7 }],
    ['generate without target', generateCv, { sourceText: 'private-facts', language: 'en' }],
    ['match', matchCv, { resumeText: 'private-cv', jobId: 7 }],
    ['PDF match', matchCv, { fileBase64: PDF, jobId: 7 }],
    ['cover', coverLetter, { resumeText: 'private-cv', jobId: 7, language: 'en' }]
];
const send = async (handler, body, key = 'Retry-Key', user = '9') => {
    const res = makeRes();
    await handler(makeReq({ body, headers: { 'x-user-id': user, 'idempotency-key': key } }), res);
    return res;
};
const sendRecruiter = async (body, key = 'Recruiter-Key') => {
    const res = makeRes();
    await matchCv(makeReq({ body, headers: { 'x-user-id': '9', 'x-user-role': 'EMPLOYER', 'idempotency-key': key } }), res);
    return res;
};

beforeEach(() => {
    keys = new Map();
    tasks = new Map();
    mocks.enqueue.mockReset().mockResolvedValue(undefined);
    mocks.pool.query.mockReset().mockResolvedValue([[{ companyId: 3 }]]);
    mocks.transaction.mockReset().mockImplementation((work) => work(mocks.conn));
    mocks.conn.query.mockReset().mockImplementation(async (sql, args) => {
        if (sql.includes('INSERT INTO ai_request_keys')) {
            const [user, key, requestHash, type, taskId] = args;
            const scope = `${user}:${key}`;
            if (keys.has(scope)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
            keys.set(scope, { requestHash, type, taskId });
            return [{}];
        }
        if (sql.includes('FROM ai_request_keys')) return [[keys.get(`${args[0]}:${args[1]}`)].filter(Boolean)];
        if (sql.includes('INSERT INTO ai_tasks')) {
            const [id, type, status, userId, input] = args;
            tasks.set(id, { id, type, status, userId, input });
            return [{}];
        }
        if (sql.includes('FROM ai_tasks')) return [[tasks.get(args[0])].filter(Boolean)];
        if (sql.includes('SELECT d.name')) return [[{ name: 'Original', descriptionHTML: 'Original description', companyName: 'Company', companyId: 3 }]];
        throw new Error(`Unexpected SQL: ${sql}`);
    });
});

describe('AI HTTP idempotency', () => {
    it('rechecks recruiter company access on replay while retaining one task and one paid event', async () => {
        const body = { fileBase64: PDF, jobId: 7 };
        const first = await sendRecruiter(body);
        expect(first.statusCode).toBe(202);
        expect(JSON.parse(tasks.get(first.body.taskId).input)).toEqual({ jobId: 7, companyId: 3 });
        mocks.conn.query.mockClear();
        const replay = await sendRecruiter(body);
        expect(replay.body).toEqual(first.body);
        expect(mocks.pool.query).toHaveBeenCalledTimes(2);
        expect(mocks.enqueue).toHaveBeenCalledOnce();
        expect(tasks.size).toBe(1);
        expect(mocks.conn.query.mock.calls.some(([sql]) => sql.includes('SELECT d.name') || sql.includes('INSERT INTO ai_tasks'))).toBe(false);
    });

    it.each(['moved company', 'revoked approval', 'inactive account'])('denies recruiter replay after %s without revealing the old task or enqueuing another', async () => {
        const body = { fileBase64: PDF, jobId: 7 };
        await sendRecruiter(body);
        mocks.pool.query.mockResolvedValue([[]]);
        mocks.conn.query.mockClear();
        const replay = await sendRecruiter(body);
        expect(replay.statusCode).toBe(404);
        expect(replay.body).not.toHaveProperty('taskId');
        expect(mocks.conn.query).not.toHaveBeenCalled();
        expect(mocks.enqueue).toHaveBeenCalledOnce();
        expect(tasks.size).toBe(1);
        const [sql] = mocks.pool.query.mock.calls.at(-1);
        expect(sql).toContain('viewer.companyId = c.id');
        expect(sql).toContain("c.censorCode = 'CS1'");
        expect(sql).toContain("viewerAccount.statusCode = 'S1'");
    });

    it('cannot reuse a company-owned task key after both the actor and job move to another company', async () => {
        const body = { fileBase64: PDF, jobId: 7 };
        await sendRecruiter(body);
        mocks.pool.query.mockResolvedValue([[{ companyId: 4 }]]);
        const replay = await sendRecruiter(body);
        expect(replay.statusCode).toBe(409);
        expect(replay.body).not.toHaveProperty('taskId');
        expect(mocks.enqueue).toHaveBeenCalledOnce();
        expect(tasks.size).toBe(1);
    });

    it.each(cases)('%s returns the original task for a repeated intent without another snapshot/write', async (_name, handler, body) => {
        const first = await send(handler, body);
        expect(first.statusCode).toBe(202);
        mocks.conn.query.mockClear();
        const replay = await send(handler, Object.fromEntries(Object.entries(body).reverse()));
        expect(replay.body).toEqual(first.body);
        expect(mocks.enqueue).toHaveBeenCalledOnce();
        expect(tasks.size).toBe(1);
        expect(mocks.conn.query.mock.calls.some(([sql]) => sql.includes('SELECT d.name') || sql.includes('INSERT INTO ai_tasks'))).toBe(false);
        expect(mocks.conn.query.mock.calls.some(([sql]) => sql.includes('FOR UPDATE'))).toBe(false);
        expect(JSON.stringify([...keys.values()])).not.toContain('private-');
    });

    it.each(cases)('%s rejects a different body for the same key without exposing the previous task', async (_name, handler, body) => {
        await send(handler, body);
        const altered = body.fileBase64 ? { ...body, fileBase64: OTHER_PDF } : body.sourceText ? { ...body, sourceText: 'different' } : { ...body, resumeText: 'different' };
        const conflict = await send(handler, altered);
        expect(conflict.statusCode).toBe(409);
        expect(conflict.body).not.toHaveProperty('taskId');
        expect(mocks.enqueue).toHaveBeenCalledOnce();
    });

    it('scopes keys by the authenticated user and compares keys case-sensitively', async () => {
        const body = { fileBase64: PDF };
        const first = await send(parseResume, body, 'Key', '9');
        const anotherUser = await send(parseResume, body, 'Key', '10');
        const differentCase = await send(parseResume, body, 'key', '9');
        expect(new Set([first, anotherUser, differentCase].map((res) => res.body.taskId)).size).toBe(3);
        expect(tasks.size).toBe(3);
    });

    it('rejects switching endpoints while reusing the same user/key', async () => {
        const body = { resumeText: 'CV', jobId: 7 };
        await send(matchCv, body);
        expect((await send(coverLetter, body)).statusCode).toBe(409);
        expect(mocks.enqueue).toHaveBeenCalledOnce();
    });

    it('normalizes numeric job IDs and the default language, but not actual CV text', async () => {
        const first = await send(coverLetter, { jobId: 7, resumeText: 'CV' });
        const replay = await send(coverLetter, { language: 'en', jobId: '7', resumeText: 'CV', ignored: true });
        expect(replay.body).toEqual(first.body);
        expect((await send(coverLetter, { language: 'vi', jobId: 7, resumeText: 'CV' })).statusCode).toBe(409);
        expect((await send(coverLetter, { jobId: 7, resumeText: 'CV ' })).statusCode).toBe(409);
    });

    it.each(['pending', 'done', 'failed'])('reuses an existing %s task without resetting it', async (status) => {
        const first = await send(parseResume, { fileBase64: PDF });
        tasks.get(first.body.taskId).status = status;
        const replay = await send(parseResume, { fileBase64: PDF });
        expect(replay.body.taskId).toBe(first.body.taskId);
        expect(tasks.get(first.body.taskId).status).toBe(status);
        expect(mocks.enqueue).toHaveBeenCalledOnce();
    });

    it.each(['missing', 'wrong-user', 'wrong-type'])('fails closed for a %s mapped task', async (condition) => {
        const first = await send(parseResume, { fileBase64: PDF });
        const task = tasks.get(first.body.taskId);
        if (condition === 'missing') tasks.delete(task.id);
        if (condition === 'wrong-user') task.userId = 10;
        if (condition === 'wrong-type') task.type = 'match_cv';
        const replay = await send(parseResume, { fileBase64: PDF });
        expect(replay.statusCode).toBe(409);
        expect(replay.body).not.toHaveProperty('taskId');
        expect(mocks.enqueue).toHaveBeenCalledOnce();
    });

    it.each(['', ' leading', 'trailing ', 'a,b', 'ắ', 'x'.repeat(129), ['one', 'two'], null])('rejects invalid keys before database work', async (key) => {
        expect((await send(parseResume, { fileBase64: PDF }, key)).statusCode).toBe(400);
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
    it.each(['', '0', '-1', 'bad'])('requires a valid user for a keyed request', async (user) => {
        expect((await send(parseResume, { fileBase64: PDF }, 'key', user)).statusCode).toBe(401);
        expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it('accepts a 128-character key and keeps the key separate from the worker payload', async () => {
        expect((await send(parseResume, { fileBase64: PDF }, 'x'.repeat(128))).statusCode).toBe(202);
        expect(mocks.enqueue.mock.calls[0][1].payload).not.toHaveProperty('idempotencyKey');
    });
});

describe('AI request key schema', () => {
    it('creates a durable user/key primary key without altering business tables', async () => {
        const db = { query: vi.fn().mockResolvedValueOnce([{}]).mockResolvedValueOnce([[{ engine: 'InnoDB' }]]) };
        await ensureAiRequestTable(db);
        const sql = db.query.mock.calls[0][0];
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS ai_request_keys');
        expect(sql).toContain('PRIMARY KEY (userId, requestKey)');
        expect(sql).toContain('COLLATE ascii_bin');
        expect(sql).not.toMatch(/ALTER|DROP|DELETE/);
    });
    it.each([{ rows: [] }, { rows: [{ engine: 'MyISAM' }] }])('rejects a missing or nontransactional key table', async ({ rows }) => {
        const db = { query: vi.fn().mockResolvedValueOnce([{}]).mockResolvedValueOnce([rows]) };
        await expect(ensureAiRequestTable(db)).rejects.toThrow('InnoDB');
    });
});
