import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    consume: vi.fn(),
    saveNotification: vi.fn(), getUserEmail: vi.fn(), getCompanyFollowers: vi.fn(),
    sendEmail: vi.fn(), pushRealtime: vi.fn()
}));

vi.mock('../shared/rabbitmq.js', () => ({ consume: mocks.consume }));
vi.mock('../notification-service/src/libs/channels.js', () => ({
    saveNotification: mocks.saveNotification,
    getUserEmail: mocks.getUserEmail,
    getCompanyFollowers: mocks.getCompanyFollowers,
    sendEmail: mocks.sendEmail,
    pushRealtime: mocks.pushRealtime
}));

beforeEach(async () => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.consume.mockResolvedValue(undefined);
    mocks.saveNotification.mockResolvedValue({ id: 1, userId: 2 });
    mocks.getUserEmail.mockResolvedValue({ email: 'user@example.com' });
    mocks.getCompanyFollowers.mockResolvedValue([]);
    mocks.sendEmail.mockResolvedValue({ sent: true });
    mocks.pushRealtime.mockResolvedValue({ sent: true });
    const { resetStats } = await import('../notification-service/src/consumers/notificationConsumer.js');
    resetStats();
});

describe('notification event consumer', () => {
    it('registers every handler with bounded prefetch', async () => {
        const { startNotificationConsumer, handlers, handleNotificationEvent } = await import('../notification-service/src/consumers/notificationConsumer.js');
        await startNotificationConsumer();
        expect(mocks.consume).toHaveBeenCalledWith(
            'notification-service.events', Object.keys(handlers), handleNotificationEvent, { prefetch: 10 }
        );
    });

    it('delivers through database, realtime, and looked-up email channels', async () => {
        const { deliver, stats } = await import('../notification-service/src/consumers/notificationConsumer.js');
        const template = { typeCode: 'X', content: 'Content', link: '/x', email: { subject: 'S', html: 'H' } };
        await deliver({ userId: 2, template });
        expect(mocks.saveNotification).toHaveBeenCalledWith({ userId: 2, typeCode: 'X', content: 'Content', link: '/x' });
        expect(mocks.pushRealtime).toHaveBeenCalledWith({ userId: 2, notification: { id: 1, userId: 2 } });
        expect(mocks.sendEmail).toHaveBeenCalledWith({ to: 'user@example.com', subject: 'S', html: 'H' });
        expect(stats).toEqual({ saved: 1, emailed: 1, pushed: 1, failed: 0 });
    });

    it('uses event email directly and skips invalid delivery requests', async () => {
        const { deliver, stats } = await import('../notification-service/src/consumers/notificationConsumer.js');
        const template = { typeCode: 'X', content: 'C', email: { subject: 'S', html: 'H' } };
        await deliver({ userId: 2, template, recipientEmail: 'snapshot@example.com' });
        expect(mocks.getUserEmail).not.toHaveBeenCalled();
        expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'snapshot@example.com' }));
        await deliver({ userId: null, template });
        await deliver({ userId: 2, template: null });
        expect(stats.saved).toBe(1);
    });

    it('isolates channel failures and increments only relevant stats', async () => {
        const { deliver, stats } = await import('../notification-service/src/consumers/notificationConsumer.js');
        const template = { typeCode: 'X', content: 'C', email: { subject: 'S', html: 'H' } };
        mocks.saveNotification.mockRejectedValue(new Error('db'));
        mocks.getUserEmail.mockRejectedValue(new Error('lookup'));
        await expect(deliver({ userId: 2, template })).resolves.toBeUndefined();
        expect(mocks.pushRealtime).not.toHaveBeenCalled();
        expect(mocks.sendEmail).not.toHaveBeenCalled();
        expect(stats).toEqual({ saved: 0, emailed: 0, pushed: 0, failed: 2 });
    });

    it('does not count unsent realtime/email attempts as successes', async () => {
        const { deliver, stats } = await import('../notification-service/src/consumers/notificationConsumer.js');
        mocks.pushRealtime.mockResolvedValue({ error: 'socket' });
        mocks.sendEmail.mockResolvedValue({ error: 'smtp' });
        await deliver({ userId: 2, recipientEmail: 'a@b.com', template: { typeCode: 'X', content: 'C', email: { subject: 'S', html: 'H' } } });
        expect(stats).toEqual({ saved: 1, emailed: 0, pushed: 0, failed: 0 });
    });

    it('notifies meaningful stage changes and ignores the initial stage', async () => {
        const { handlers, stats } = await import('../notification-service/src/consumers/notificationConsumer.js');
        await handlers['application.stage_changed']({ candidateId: 2, toStage: 'moi_ung_tuyen', jobTitle: 'Dev' });
        expect(mocks.saveNotification).not.toHaveBeenCalled();
        await handlers['application.stage_changed']({ candidateId: 2, candidateEmail: 'interview@x.com', candidateName: 'Lan', toStage: 'phong_van', jobTitle: 'Dev' });
        expect(mocks.saveNotification.mock.calls[0][0]).toMatchObject({ userId: 2, typeCode: 'APPLICATION_STAGE' });
        expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'interview@x.com' }));
        expect(mocks.getUserEmail).not.toHaveBeenCalled();
        expect(stats.saved).toBe(1);
    });

    it('uses candidate snapshot email for decision events', async () => {
        const { handlers } = await import('../notification-service/src/consumers/notificationConsumer.js');
        await handlers['application.decision_email_requested']({ candidateId: 2, candidateEmail: 'snapshot@x.com', candidateName: 'Lan', decision: 'accepted', jobTitle: 'Dev' });
        expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'snapshot@x.com' }));
        expect(mocks.getUserEmail).not.toHaveBeenCalled();
    });

    it('validates recipient identity for application and moderation events', async () => {
        const { handlers } = await import('../notification-service/src/consumers/notificationConsumer.js');
        await handlers['application.submitted']({ cvId: 1 });
        await handlers['job.moderated']({ jobId: 1 });
        expect(mocks.saveNotification).not.toHaveBeenCalled();
        await handlers['application.submitted']({ cvId: 1, posterId: 3, candidateName: 'Lan', jobTitle: 'Dev' });
        await handlers['job.moderated']({ jobId: 1, posterId: 3, approved: false, reason: 'spam' });
        expect(mocks.saveNotification).toHaveBeenCalledTimes(2);
        expect(mocks.saveNotification.mock.calls[1][0].content).toContain('#1');
    });

    it('fans a new job out sequentially to all followers', async () => {
        mocks.getCompanyFollowers.mockResolvedValue([4, 5]);
        const { handlers, stats } = await import('../notification-service/src/consumers/notificationConsumer.js');
        await handlers['job.created']({ job: null });
        await handlers['job.created']({ job: { id: 1 } });
        expect(mocks.getCompanyFollowers).not.toHaveBeenCalled();
        await handlers['job.created']({ job: { id: 1, companyId: 9, name: 'Dev', companyName: 'ACME' } });
        expect(mocks.getCompanyFollowers).toHaveBeenCalledWith(9);
        expect(mocks.saveNotification.mock.calls.map((x) => x[0].userId)).toEqual([4, 5]);
        expect(stats.saved).toBe(2);
    });

    it('returns early when a company has no followers', async () => {
        const { handlers } = await import('../notification-service/src/consumers/notificationConsumer.js');
        await handlers['job.created']({ job: { id: 1, companyId: 9 } });
        expect(mocks.saveNotification).not.toHaveBeenCalled();
    });

    it('ignores unknown events and rethrows handler failures for RabbitMQ nack', async () => {
        const { handleNotificationEvent, stats } = await import('../notification-service/src/consumers/notificationConsumer.js');
        await expect(handleNotificationEvent({}, 'unknown')).resolves.toBeUndefined();
        mocks.getCompanyFollowers.mockRejectedValue(new Error('db'));
        await expect(handleNotificationEvent({ job: { companyId: 2 } }, 'job.created')).rejects.toThrow('db');
        expect(stats.failed).toBe(1);
    });
});
