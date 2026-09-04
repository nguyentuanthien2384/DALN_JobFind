import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';

const mocks = vi.hoisted(() => {
    const client = { query: vi.fn(), release: vi.fn() };
    const pool = { query: vi.fn(), connect: vi.fn() };
    return { client, pool, publish: vi.fn() };
});
vi.mock('pg', () => ({ default: { Pool: class { constructor() { return mocks.pool; } } } }));
vi.mock('../shared/outboxPublisher.js', () => ({ publishOutboxEvent: mocks.publish }));

const before = {
    id: '31', company_id: 9, stage: 'moi_ung_tuyen', candidate_id: 2,
    candidate_email: 'snapshot@example.com', candidate_name: 'Lan', job_id: 7, job_title: 'Developer'
};
const request = (body) => makeReq({
    headers: { 'x-user-id': '5', 'x-user-role': 'COMPANY', 'x-company-id': '9' },
    params: { id: '31' }, body
});

beforeEach(() => {
    vi.resetModules();
    mocks.client.query.mockReset();
    mocks.client.release.mockReset();
    mocks.pool.connect.mockReset().mockResolvedValue(mocks.client);
    mocks.pool.query.mockReset().mockResolvedValue({});
    mocks.publish.mockReset().mockResolvedValue(undefined);
});

const commandDatabase = ({ failOutbox = false, application = before } = {}) => {
    let event;
    mocks.client.query.mockImplementation(async (sql, args) => {
        if (sql.startsWith('SELECT * FROM applications')) return { rows: application ? [application] : [] };
        if (sql.startsWith('UPDATE applications')) return { rows: [{ ...application, stage: args[0] }] };
        if (sql.startsWith('INSERT INTO outbox_events')) {
            if (failOutbox) throw new Error('outbox storage unavailable');
            event = { id: args[0], aggregate_id: args[1], event_type: args[2], payload: JSON.parse(args[3]), correlation_id: args[4], attempts: 0 };
        }
        return { rows: [] };
    });
    return () => event;
};

const relayDatabase = (event, { failMark = false } = {}) => {
    const state = { ready: true, published: false };
    mocks.client.query.mockClear();
    mocks.client.query.mockImplementation(async (sql) => {
        if (sql.includes('SELECT e.*')) return { rows: state.ready && !state.published ? [event] : [] };
        if (sql.includes('SET published_at')) {
            if (failMark) throw new Error('database lost after broker confirm');
            state.published = true;
        }
        if (sql.includes('next_attempt_at = NOW()')) {
            event.attempts += 1;
            state.ready = false;
        }
        return { rows: [] };
    });
    return state;
};

describe('Application outbox failure boundaries', () => {
    it('commits a decision while broker is offline, then retries the same snapshot and event ID', async () => {
        const eventOf = commandDatabase();
        mocks.publish.mockRejectedValue(new Error('broker unavailable'));
        const { sendDecisionNotification } = await import('../application-service/src/controllers/applicationController.js');
        const res = makeRes();
        await sendDecisionNotification(request({ decision: 'accepted', message: 'Congratulations' }), res);

        expect(res.body.emailQueued).toBe(true);
        expect(mocks.client.query).toHaveBeenLastCalledWith('COMMIT');
        expect(mocks.publish).not.toHaveBeenCalled();
        const event = eventOf();
        expect(event.payload).toMatchObject({ candidateEmail: 'snapshot@example.com', decision: 'accepted', toStage: 'nhan_viec' });

        const state = relayDatabase(event);
        const { runOutboxOnce } = await import('../application-service/src/libs/outbox.js');
        await expect(runOutboxOnce()).resolves.toBe(0);
        expect(state.published).toBe(false);
        expect(event.attempts).toBe(1);
        expect(mocks.client.query.mock.calls.some(([sql]) => sql.includes('SET published_at'))).toBe(false);

        state.ready = true;
        mocks.publish.mockResolvedValue(undefined);
        await expect(runOutboxOnce()).resolves.toBe(1);
        expect(state.published).toBe(true);
        expect(mocks.publish.mock.calls[0]).toEqual(mocks.publish.mock.calls[1]);
        expect(mocks.publish.mock.calls[1][2]).toMatchObject({ messageId: event.id, correlationId: 'corr-test' });
    });

    it.each([
        ['moveStage', { stage: 'phong_van' }],
        ['sendDecisionNotification', { decision: 'rejected' }]
    ])('rolls back status/history when the outbox insert fails in %s', async (handler, body) => {
        commandDatabase({ failOutbox: true });
        const controller = await import('../application-service/src/controllers/applicationController.js');
        const res = makeRes();
        await controller[handler](request(body), res);
        expect(res.statusCode).toBe(500);
        expect(mocks.client.query).toHaveBeenLastCalledWith('ROLLBACK');
        expect(mocks.client.query).not.toHaveBeenCalledWith('COMMIT');
        expect(mocks.client.release).toHaveBeenCalledOnce();
        expect(mocks.publish).not.toHaveBeenCalled();
    });

    it.each([
        [null, 404],
        [{ ...before, company_id: 100 }, 403],
        [{ ...before, stage: 'phong_van' }, 200]
    ])('does not enqueue for missing, foreign-company or unchanged stage', async (application, status) => {
        const eventOf = commandDatabase({ application });
        const { moveStage } = await import('../application-service/src/controllers/applicationController.js');
        const res = makeRes();
        await moveStage(request({ stage: 'phong_van' }), res);
        expect(res.statusCode).toBe(status);
        expect(eventOf()).toBeUndefined();
    });

    it('creates a fresh event for an explicit resend without changing the stage again', async () => {
        const eventOf = commandDatabase({ application: { ...before, stage: 'tu_choi' } });
        const { sendDecisionNotification } = await import('../application-service/src/controllers/applicationController.js');
        await sendDecisionNotification(request({ decision: 'rejected' }), makeRes());
        const first = eventOf();
        await sendDecisionNotification(request({ decision: 'rejected' }), makeRes());
        expect(eventOf().id).not.toBe(first.id);
        expect(eventOf().payload.fromStage).toBeNull();
        expect(mocks.client.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE applications'))).toBe(false);
    });

    it('holds published_at until confirmation and prevents overlapping local relay runs', async () => {
        const event = { id: 'e1', event_type: 'application.stage_changed', payload: { applicationId: '31' }, attempts: 0 };
        const state = relayDatabase(event);
        let confirm;
        mocks.publish.mockImplementation(() => new Promise((resolve) => { confirm = resolve; }));
        const { runOutboxOnce } = await import('../application-service/src/libs/outbox.js');
        const pending = runOutboxOnce();
        await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
        expect(state.published).toBe(false);
        expect(mocks.client.query).not.toHaveBeenCalledWith('COMMIT');
        await expect(runOutboxOnce()).resolves.toBe(0);
        confirm();
        await expect(pending).resolves.toBe(1);
    });

    it('rolls back a failed published marker and retries with the original message ID', async () => {
        const event = { id: 'stable-id', event_type: 'application.stage_changed', payload: { applicationId: '31' }, attempts: 0 };
        relayDatabase(event, { failMark: true });
        const { runOutboxOnce } = await import('../application-service/src/libs/outbox.js');
        await expect(runOutboxOnce()).rejects.toThrow('database lost');
        expect(mocks.client.query).toHaveBeenLastCalledWith('ROLLBACK');
        relayDatabase(event);
        await expect(runOutboxOnce()).resolves.toBe(1);
        expect(mocks.publish.mock.calls[0][2].messageId).toBe('stable-id');
        expect(mocks.publish.mock.calls[1][2].messageId).toBe('stable-id');
    });
});
