import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';
import { interviewFixture } from './interviewFixture.js';
import { expectResponseContract } from './contractAssertions.js';

const mocks = vi.hoisted(() => ({ pool: { query: vi.fn() } }));
vi.mock('../application-service/src/libs/db.js', () => ({ pool: mocks.pool }));
import { calendarEntry, listInterviews, myInterviews } from '../application-service/src/controllers/interviewCalendarController.js';

const row = (overrides = {}) => ({
    id: '7', legacy_cv_id: 13, job_id: 9, job_title: 'Frontend Engineer', company_id: 3,
    candidate_id: 8, candidate_name: 'Lan', candidate_email: 'lan@example.com', stage: 'phong_van',
    invitation_id: '21', invitation_created_at: new Date('2030-01-01T10:00:00Z'), invalidated: false,
    decision_snapshot: { decision: 'interview', interview: interviewFixture, message: 'Hẹn gặp bạn' }, ...overrides
});
const companyRequest = (overrides = {}) => makeReq({ headers: { 'x-user-id': '4', 'x-user-role': 'EMPLOYER', 'x-company-id': '3' }, ...overrides });
beforeEach(() => { mocks.pool.query.mockReset(); });

describe('persisted interview calendar', () => {
    it('projects a safe calendar DTO in Vietnam time without private application fields', () => {
        const input = row({ cv_snapshot: { secret: true }, notes: [{ body: 'Internal assessment' }], rating: 2 });
        const result = calendarEntry(input, Date.parse('2030-01-01T10:00:00Z'));
        expect(result).toMatchObject({ id: '21', applicationId: '7', legacyCvId: 13, companyName: interviewFixture.companyName,
            startAt: '2099-10-15T02:30:00.000Z', endAt: '2099-10-15T03:30:00.000Z', status: 'scheduled' });
        expect(result).not.toHaveProperty('notes');
        expect(result).not.toHaveProperty('rating');
        expect(result).not.toHaveProperty('cv_snapshot');
        expectResponseContract('applicationInterviews', { statusCode: 200, body: { errCode: 0, data: [result], count: 1 } });
    });

    it('handles a midnight crossing and defaults missing duration to 60 minutes', () => {
        const { durationMinutes: _duration, confirmBy: _confirm, ...interview } = interviewFixture;
        const input = row({ decision_snapshot: { decision: 'interview', interview: { ...interview, interviewDate: '2030-01-01', interviewTime: '23:30' } } });
        const result = calendarEntry(input, Date.parse('2030-01-01T17:00:00Z'));
        expect(result).toMatchObject({ startAt: '2030-01-01T16:30:00.000Z', endAt: '2030-01-01T17:30:00.000Z', status: 'scheduled', message: null });
        expect(calendarEntry(input, Date.parse(result.endAt)).status).toBe('past');
    });

    it('does not imply confirmation and never revives an invitation after leaving and reentering the interview stage', () => {
        expect(calendarEntry(row({ stage: 'tu_choi' })).status).toBe('inactive');
        expect(calendarEntry(row({ stage: 'phong_van', invalidated: true })).status).toBe('inactive');
        expect(calendarEntry(row(), Date.parse('2100-01-01T00:00:00Z')).status).toBe('past');
        expect(calendarEntry(row({ invalidated: true }), Date.parse('2100-01-01T00:00:00Z')).status).toBe('inactive');
    });

    it('ignores invalid historical invitations and non-invitation events', () => {
        expect(calendarEntry(row({ decision_snapshot: null }))).toBeNull();
        expect(calendarEntry(row({ decision_snapshot: { decision: 'accepted', interview: interviewFixture } }))).toBeNull();
        expect(calendarEntry(row({ decision_snapshot: { decision: 'interview', interview: { ...interviewFixture, interviewDate: '2099-02-30' } } }))).toBeNull();
    });

    it('scopes an employer query, selects latest globally before date filtering and uses deterministic event order', async () => {
        mocks.pool.query.mockResolvedValue({ rows: [row()] });
        const res = makeRes();
        await listInterviews(companyRequest({ query: { from: '2099-10-01', to: '2099-10-31', jobId: '9' } }), res);
        const [sql, params] = mocks.pool.query.mock.calls[0];
        expect(params).toEqual([3, 9, '2099-10-01', '2099-10-31']);
        expect(sql).toContain('a.company_id = $1');
        expect(sql).toContain("e.decision_snapshot->>'decision' = 'interview'");
        expect(sql).toContain('ORDER BY e.created_at DESC, e.id DESC LIMIT 1');
        expect(sql.indexOf('LIMIT 1')).toBeLessThan(sql.indexOf("interviewDate' >="));
        expect(sql).toContain('(departed.created_at, departed.id) > (invitation.created_at, invitation.id)');
        expect(res.headers['Cache-Control']).toBe('private, no-store');
        expect(res.body.count).toBe(1);
        expectResponseContract('applicationInterviews', res);
    });

    it('reads the complete requested calendar without silently limiting results', async () => {
        mocks.pool.query.mockResolvedValue({ rows: Array.from({ length: 125 }, (_, index) => row({ id: String(index + 1), invitation_id: String(index + 1) })) });
        const res = makeRes();
        await listInterviews(companyRequest(), res);
        expect(res.body.data).toHaveLength(125);
        expect(res.body.count).toBe(125);
    });

    it('scopes the candidate route exclusively to trusted identity and returns no internal notes', async () => {
        mocks.pool.query.mockResolvedValue({ rows: [row()] });
        const res = makeRes();
        await myInterviews(makeReq({ headers: { 'x-user-id': '8', 'x-user-role': 'CANDIDATE', 'x-company-id': '99' }, query: { from: '2099-10-15' } }), res);
        const [sql, params] = mocks.pool.query.mock.calls[0];
        expect(params).toEqual([8, '2099-10-15']);
        expect(sql).toContain('a.candidate_id = $1');
        expect(sql).not.toContain('a.company_id = $1');
        expect(res.headers['Cache-Control']).toBe('private, no-store');
        expectResponseContract('myInterviews', res);
    });

    it('allows admins all companies but does not allow unscoped employer or anonymous candidate reads', async () => {
        mocks.pool.query.mockResolvedValue({ rows: [] });
        const admin = makeRes();
        await listInterviews(makeReq({ headers: { 'x-user-role': 'ADMIN', 'x-user-id': '1' } }), admin);
        expect(mocks.pool.query.mock.calls[0][1]).toEqual([]);
        expect(admin.body.data).toEqual([]);
        mocks.pool.query.mockClear();
        for (const headers of [{}, { 'x-user-role': 'EMPLOYER' }, { 'x-user-role': 'CANDIDATE', 'x-company-id': '3' }]) {
            const denied = makeRes();
            await listInterviews(makeReq({ headers }), denied);
            expect(denied.statusCode).toBe(403);
        }
        const anonymous = makeRes();
        await myInterviews(makeReq(), anonymous);
        expect(anonymous.statusCode).toBe(401);
        expect(mocks.pool.query).not.toHaveBeenCalled();
    });

    it.each([{ from: '2030-02-30' }, { to: '2030-10-01T12:00:00Z' }, { from: '2030-02-02', to: '2030-02-01' },
        { from: ['2030-02-01'] }, { jobId: '1 OR 1=1' }])('rejects invalid filters %j before querying', async (query) => {
        const res = makeRes();
        await listInterviews(companyRequest({ query }), res);
        expect(res.statusCode).toBe(400);
        expect(mocks.pool.query).not.toHaveBeenCalled();
    });

    it('does not allow a candidate job filter and maps DB failures without exposing internals', async () => {
        const req = makeReq({ headers: { 'x-user-id': '8' }, query: { jobId: '9' } });
        const bad = makeRes();
        await myInterviews(req, bad);
        expect(bad.statusCode).toBe(400);
        mocks.pool.query.mockRejectedValue(new Error('secret database error'));
        const failed = makeRes();
        await listInterviews(companyRequest(), failed);
        expect(failed.statusCode).toBe(500);
        expect(failed.body.errMessage).not.toContain('secret');
        expect(failed.headers['Cache-Control']).toBe('private, no-store');
    });
});
