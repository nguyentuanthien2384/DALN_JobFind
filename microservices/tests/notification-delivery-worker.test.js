import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ claimDelivery: vi.fn(), finishDelivery: vi.fn(), sendEmail: vi.fn(), pushRealtime: vi.fn() }));
vi.mock('../notification-service/src/libs/deliveryStore.js', () => ({ claimDelivery: mocks.claimDelivery, finishDelivery: mocks.finishDelivery }));
vi.mock('../notification-service/src/libs/channels.js', () => ({
    sendEmail: mocks.sendEmail, pushRealtime: mocks.pushRealtime,
    EMAIL_SKIP_REASONS: { NOT_CONFIGURED: 'email_not_configured', NO_SAFE_DEMO_RECIPIENT: 'no_safe_demo_recipient' }
}));
import { deliveryOutcome, runDeliveryOnce, startDeliveryWorker } from '../notification-service/src/libs/deliveryWorker.js';

let row;
beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    row = { id: 1, eventId: 'e1', channel: 'email', attempts: 1, lockToken: 'token', payload: '{"to":"snapshot@x.com","messageId":"<stable@jobfind.local>"}' };
    mocks.claimDelivery.mockResolvedValueOnce(row).mockResolvedValue(null);
    mocks.finishDelivery.mockResolvedValue(true);
    mocks.sendEmail.mockResolvedValue({ sent: true });
    mocks.pushRealtime.mockResolvedValue({ sent: true });
});
afterEach(() => vi.useRealTimers());

describe('durable notification delivery worker', () => {
    it('sends the persisted email snapshot only once and updates success after storage confirms', async () => {
        const stats = { emailed: 0, pushed: 0, failed: 0 };
        expect(await runDeliveryOnce({ stats })).toBe(true);
        expect(await runDeliveryOnce({ stats })).toBe(false);
        expect(mocks.sendEmail).toHaveBeenCalledExactlyOnceWith({ to: 'snapshot@x.com', messageId: '<stable@jobfind.local>' });
        expect(mocks.finishDelivery).toHaveBeenCalledWith(row, { status: 'sent' });
        expect(stats).toEqual({ emailed: 1, pushed: 0, failed: 0 });
    });

    it('does not retry inside the worker after SMTP succeeds but storing its result fails', async () => {
        mocks.finishDelivery.mockRejectedValueOnce(new Error('database offline'));
        await expect(runDeliveryOnce()).rejects.toThrow('database offline');
        expect(mocks.sendEmail).toHaveBeenCalledOnce();
        expect(mocks.finishDelivery).toHaveBeenCalledOnce();
        // Lease remains processing; SQL recovery quarantines stale email as unknown.
    });

    it.each(['ETIMEDOUT', 'ESOCKET', 'ECONNECTION'])('quarantines %s even when Nodemailer labels it CONN', async (code) => {
        mocks.sendEmail.mockResolvedValueOnce({ error: 'connection interrupted after DATA', code, command: 'CONN' });
        await runDeliveryOnce();
        expect(mocks.finishDelivery).toHaveBeenCalledWith(row, { status: 'unknown', error: 'connection interrupted after DATA' });
    });

    it('bounds an unresponsive email attempt and ignores its eventual result', async () => {
        vi.useFakeTimers();
        let complete;
        mocks.sendEmail.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
        const pending = runDeliveryOnce();
        await vi.advanceTimersByTimeAsync(60000);
        await pending;
        expect(mocks.finishDelivery).toHaveBeenCalledWith(row, { status: 'unknown', error: 'delivery_deadline_exceeded' });
        complete({ sent: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.finishDelivery).toHaveBeenCalledOnce();
        expect(mocks.sendEmail).toHaveBeenCalledOnce();
    });

    it.each([
        [{ error: 'temporary rejection', code: 'EMESSAGE', command: 'DATA', responseCode: 451 }, 'pending'],
        [{ error: 'recipient rejected', code: 'EENVELOPE', responseCode: 550 }, 'failed'],
        [{ error: 'dns', code: 'EDNS' }, 'pending'],
        [{ skipped: true, reason: 'email_not_configured' }, 'pending'],
        [{ skipped: true, reason: 'invalid_recipient' }, 'skipped']
    ])('classifies a known outcome %j as %s', (result, status) => {
        expect(deliveryOutcome('email', result).status).toBe(status);
    });

    it('stops safe transient retries after ten attempts but keeps missing configuration pending', async () => {
        row.attempts = 10;
        mocks.sendEmail.mockResolvedValueOnce({ error: 'dns', code: 'EDNS' });
        await runDeliveryOnce();
        expect(mocks.finishDelivery.mock.calls[0][1].status).toBe('failed');
        mocks.claimDelivery.mockResolvedValueOnce(row);
        mocks.sendEmail.mockResolvedValueOnce({ skipped: true, reason: 'email_not_configured' });
        await runDeliveryOnce();
        expect(mocks.finishDelivery.mock.calls[1][1].status).toBe('pending');
        expect(mocks.finishDelivery.mock.calls[1][1].attempted).toBe(false);
    });

    it('retries realtime using the same notification ID and never invokes SMTP', async () => {
        row.channel = 'realtime';
        row.payload = JSON.stringify({ userId: 2, notification: { id: 42 } });
        mocks.pushRealtime.mockResolvedValueOnce({ error: 'socket unavailable' });
        await runDeliveryOnce();
        expect(mocks.pushRealtime).toHaveBeenCalledWith({ userId: 2, notification: { id: 42 } });
        expect(mocks.finishDelivery).toHaveBeenCalledWith(row, { status: 'pending', error: 'socket unavailable' });
        expect(mocks.sendEmail).not.toHaveBeenCalled();
    });

    it('marks corrupt stored data failed before performing external calls', async () => {
        row.payload = '{';
        await runDeliveryOnce();
        expect(mocks.finishDelivery.mock.calls[0][1].status).toBe('failed');
        expect(mocks.sendEmail).not.toHaveBeenCalled();
    });

    it('does not count a stale sender whose lock token no longer owns the row', async () => {
        const stats = { emailed: 0, pushed: 0, failed: 0 };
        mocks.finishDelivery.mockResolvedValueOnce(false);
        await runDeliveryOnce({ stats });
        expect(stats.emailed).toBe(0);
    });

    it('does not overlap local worker ticks and stops scheduling on shutdown', async () => {
        vi.useFakeTimers();
        let complete;
        mocks.sendEmail.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
        const stop = startDeliveryWorker();
        await vi.advanceTimersByTimeAsync(5000);
        expect(mocks.claimDelivery).toHaveBeenCalledOnce();
        stop();
        complete({ sent: true });
        await vi.advanceTimersByTimeAsync(5000);
        expect(mocks.claimDelivery).toHaveBeenCalledOnce();
    });
});
