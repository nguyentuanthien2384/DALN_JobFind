import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';

const mocks = vi.hoisted(() => ({
    pool: { query: vi.fn() },
    conn: { query: vi.fn() },
    withTransaction: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn() }
}));
vi.mock('../job-core-service/src/libs/db.js', () => ({ pool: mocks.pool, withTransaction: mocks.withTransaction }));
vi.mock('../shared/logger.js', () => ({ createLogger: () => mocks.logger }));

import {
    applicationIntro, candidateMessage, chatAssist, screenApplication, listJobScreenings, submittedPdfBase64
} from '../job-core-service/src/controllers/aiAssistController.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64');
const job = { name: 'Dev', descriptionHTML: '<p>Build</p>', companyName: 'Sao Khuê', companyId: 3 };
const submittedCv = { id: 21, jobId: 7, name: 'Dev', descriptionHTML: '<p>Node</p>', companyId: 3, file: Buffer.from(`data:application/pdf;base64,${PDF}`, 'latin1') };
const request = (body, role = 'CANDIDATE', extra = {}) => makeReq({ body, headers: { 'x-user-id': '9', 'x-user-role': role }, ...extra });
const call = async (handler, req) => { const res = makeRes(); await handler(req, res); return res; };
// INSERT INTO ai_tasks params: [id, type, status, userId, input, ...]; outbox payload is the 5th param of its insert.
const taskInsert = () => mocks.conn.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO ai_tasks'));
const outboxPayload = () => JSON.parse(mocks.conn.query.mock.calls.find(([sql]) => sql.includes('outbox'))[1][4]);

beforeEach(() => {
    mocks.pool.query.mockReset().mockResolvedValue([[job]]);
    mocks.conn.query.mockReset().mockImplementation(async (sql) => sql.includes('FROM cvs') ? [[submittedCv]]
        : sql.includes('SELECT') ? [[job]] : [{ affectedRows: 1 }]);
    mocks.withTransaction.mockReset().mockImplementation((work) => work(mocks.conn));
    mocks.logger.error.mockReset();
});

describe('candidate application intro', () => {
    it('queues the CV with a published job snapshot and keeps the PDF out of task metadata', async () => {
        const res = await call(applicationIntro, request({ jobId: 7, fileBase64: PDF, language: 'vi' }));
        expect(res.statusCode).toBe(202);
        expect(mocks.conn.query.mock.calls[0][0]).toContain("p.statusCode = 'PS1'");
        expect(JSON.parse(taskInsert()[1][4])).toEqual({ kind: 'application_intro', jobId: 7, language: 'vi' });
        expect(taskInsert()[1][1]).toBe('write_assist');
        expect(outboxPayload()).toMatchObject({ kind: 'application_intro', fileBase64: PDF, jobTitle: 'Dev', companyName: 'Sao Khuê' });
    });

    it.each([{ jobId: 7, fileBase64: 'bad' }, { jobId: 0, fileBase64: PDF }])('rejects invalid input before any write %#', async (body) => {
        expect((await call(applicationIntro, request(body))).statusCode).toBe(400);
        expect(mocks.withTransaction).not.toHaveBeenCalled();
    });

    it('does not queue an intro for an unpublished job', async () => {
        mocks.conn.query.mockResolvedValue([[]]);
        expect((await call(applicationIntro, request({ jobId: 7, fileBase64: PDF }))).statusCode).toBe(404);
        expect(taskInsert()).toBeUndefined();
    });
});

describe('recruiter email note', () => {
    it('scopes the job to the current company and stores the company on the task', async () => {
        const res = await call(candidateMessage, request({ jobId: 7, emailType: 'rejection', candidateName: 'Lan', recruiterNotes: ' Thiếu Node ', interviewed: true }, 'EMPLOYER'));
        expect(res.statusCode).toBe(202);
        expect(mocks.pool.query.mock.calls[0][0]).toContain('viewer.companyId = c.id');
        expect(mocks.conn.query.mock.calls[0][1]).toEqual([9, 7, 3]);
        expect(JSON.parse(taskInsert()[1][4])).toEqual({ kind: 'candidate_email', emailType: 'rejection', jobId: 7, companyId: 3 });
        expect(outboxPayload()).toMatchObject({ kind: 'candidate_email', emailType: 'rejection', recruiterNotes: 'Thiếu Node',
            interviewed: true, jobTitle: 'Dev', companyName: 'Sao Khuê', candidateName: 'Lan' });
    });

    it('does not send interview attendance for non-rejection notes', async () => {
        await call(candidateMessage, request({ jobId: 7, emailType: 'offer', interviewed: true }, 'COMPANY'));
        expect(outboxPayload()).not.toHaveProperty('interviewed');
    });

    it.each(['CANDIDATE', 'ADMIN'])('refuses %s callers without touching the database', async (role) => {
        expect((await call(candidateMessage, request({ jobId: 7, emailType: 'offer' }, role))).statusCode).toBe(403);
        expect(mocks.pool.query).not.toHaveBeenCalled();
    });

    it('returns 404 for a job outside the company', async () => {
        mocks.pool.query.mockResolvedValue([[]]);
        expect((await call(candidateMessage, request({ jobId: 7, emailType: 'offer' }, 'EMPLOYER'))).statusCode).toBe(404);
        expect(mocks.withTransaction).not.toHaveBeenCalled();
    });
});

describe('chat assistant', () => {
    const messages = [{ from: 'me', text: 'Chào anh' }, { from: 'partner', text: 'Thứ Hai bạn phỏng vấn được không?' }];

    it('does not store conversation text in the task record for candidates', async () => {
        const res = await call(chatAssist, request({ mode: 'suggest', messages }));
        expect(res.statusCode).toBe(202);
        expect(JSON.parse(taskInsert()[1][4])).toEqual({ kind: 'chat_reply' });
        expect(outboxPayload()).toMatchObject({ kind: 'chat_reply', senderRole: 'candidate', messages });
        expect(mocks.pool.query).not.toHaveBeenCalled();
    });

    it('binds a recruiter request to the current company and rechecks it in the transaction', async () => {
        mocks.pool.query.mockResolvedValue([[{ companyId: 3 }]]);
        mocks.conn.query.mockImplementation(async (sql) => sql.includes('SELECT') ? [[{ companyId: 3 }]] : [{ affectedRows: 1 }]);
        const res = await call(chatAssist, request({ mode: 'polish', draft: 'ok mai pv nhe' }, 'EMPLOYER'));
        expect(res.statusCode).toBe(202);
        expect(JSON.parse(taskInsert()[1][4])).toEqual({ kind: 'chat_polish', companyId: 3 });
        expect(outboxPayload()).toMatchObject({ kind: 'chat_polish', senderRole: 'recruiter', draft: 'ok mai pv nhe' });
    });

    it('refuses a recruiter whose company changed before the task was written', async () => {
        mocks.pool.query.mockResolvedValue([[{ companyId: 3 }]]);
        mocks.conn.query.mockImplementation(async (sql) => sql.includes('SELECT') ? [[{ companyId: 4 }]] : [{ affectedRows: 1 }]);
        expect((await call(chatAssist, request({ mode: 'polish', draft: 'ok' }, 'COMPANY'))).statusCode).toBe(403);
        expect(taskInsert()).toBeUndefined();
    });

    it('needs a partner message to suggest a reply', async () => {
        expect((await call(chatAssist, request({ mode: 'suggest', messages: [messages[0]] }))).statusCode).toBe(400);
        expect(mocks.withTransaction).not.toHaveBeenCalled();
    });

    it('refuses administrators', async () => {
        expect((await call(chatAssist, request({ mode: 'polish', draft: 'ok' }, 'ADMIN'))).statusCode).toBe(403);
    });
});

describe('screening submitted CVs', () => {
    it('reads the PDF on the server, records the screening and queues match_cv', async () => {
        const { file, ...withoutFile } = submittedCv;
        mocks.pool.query.mockResolvedValue([[withoutFile]]);
        const res = await call(screenApplication, request({ cvId: 21 }, 'EMPLOYER'));
        expect(res.statusCode).toBe(202);
        expect(file).toBeTruthy();
        const [preflightSql, preflightParams] = mocks.pool.query.mock.calls[0];
        expect(preflightSql).toContain('FROM cvs cv');
        expect(preflightSql).not.toContain('cv.file');
        expect(preflightParams).toEqual([9, 21]);
        expect(mocks.conn.query.mock.calls.find(([sql]) => sql.includes('FROM cvs'))[1]).toEqual([9, 21, 3]);
        const screening = mocks.conn.query.mock.calls.find(([sql]) => sql.includes('ai_application_screenings'));
        expect(screening[1].slice(1, 5)).toEqual([21, 7, 3, 9]);
        expect(screening[1][0]).toBe(taskInsert()[1][0]);
        expect(taskInsert()[1][1]).toBe('match_cv');
        expect(JSON.parse(taskInsert()[1][4])).toEqual({ jobId: 7, companyId: 3, cvId: 21 });
        expect(outboxPayload()).toMatchObject({ fileBase64: PDF, jobTitle: 'Dev', jobDescription: '<p>Node</p>' });
    });

    it('returns 404 and writes nothing for a CV outside the company', async () => {
        mocks.pool.query.mockResolvedValue([[]]);
        expect((await call(screenApplication, request({ cvId: 21 }, 'COMPANY'))).statusCode).toBe(404);
        expect(mocks.withTransaction).not.toHaveBeenCalled();
    });

    it('returns 422 and rolls back when the stored CV is not a valid PDF', async () => {
        mocks.pool.query.mockResolvedValue([[submittedCv]]);
        mocks.conn.query.mockImplementation(async (sql) => sql.includes('FROM cvs') ? [[{ ...submittedCv, file: Buffer.from('data:image/png;base64,AAAA') }]] : [{ affectedRows: 1 }]);
        expect((await call(screenApplication, request({ cvId: 21 }, 'EMPLOYER'))).statusCode).toBe(422);
        expect(taskInsert()).toBeUndefined();
    });

    it('decodes legacy data URLs and raw base64 but rejects other files', () => {
        expect(submittedPdfBase64(submittedCv.file)).toBe(PDF);
        expect(submittedPdfBase64(PDF)).toBe(PDF);
        expect(() => submittedPdfBase64(Buffer.from(`data:text/plain;base64,${PDF}`))).toThrow();
        expect(() => submittedPdfBase64(null)).toThrow();
    });

    it('lists only the latest result per CV for a company job', async () => {
        mocks.pool.query.mockReset()
            .mockResolvedValueOnce([[job]])
            .mockResolvedValueOnce([[
                { cvId: 21, taskId: 't2', status: 'done', result: JSON.stringify({ score: 82, verdict: 'phu_hop', summary: 'Tốt', internal: 'x' }), error: null, createdAt: 2, updatedAt: 2 },
                { cvId: 21, taskId: 't1', status: 'failed', result: null, error: 'old', createdAt: 1, updatedAt: 1 },
                { cvId: 22, taskId: 't3', status: 'pending', result: null, error: null, createdAt: 1, updatedAt: 1 }
            ]]);
        const res = await call(listJobScreenings, request(undefined, 'EMPLOYER', { params: { id: '7' } }));
        expect(res.headers['Cache-Control'] || res.setHeader.mock.calls[0][1]).toBe('private, no-store');
        expect(mocks.pool.query.mock.calls[1][1]).toEqual([3, 7]);
        expect(res.body.data).toEqual([
            expect.objectContaining({ cvId: 21, taskId: 't2', score: 82, verdict: 'phu_hop', summary: 'Tốt', error: null }),
            expect.objectContaining({ cvId: 22, status: 'pending' })
        ]);
        expect(res.body.data[0]).not.toHaveProperty('internal');
    });
});
