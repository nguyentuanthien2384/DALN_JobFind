import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeEventFixture } from './contractAssertions.js';
import { eventCatalog, eventExamples } from '../shared/contracts/eventCatalog.js';

const mocks = vi.hoisted(() => ({
    consume: vi.fn(),
    queueNotification: vi.fn(),
    saveNotification: vi.fn(), getUserEmail: vi.fn(), getCompanyFollowers: vi.fn(),
    sendEmail: vi.fn(), pushRealtime: vi.fn()
}));

vi.mock('../shared/rabbitmq.js', () => ({ consume: mocks.consume }));
vi.mock('../notification-service/src/libs/deliveryStore.js', () => ({ queueNotification: mocks.queueNotification }));
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
    mocks.queueNotification.mockResolvedValue({ duplicate: false, notificationId: 1 });
    mocks.saveNotification.mockResolvedValue({ id: 1, userId: 2 });
    mocks.getUserEmail.mockResolvedValue({ email: 'user@example.com' });
    mocks.getCompanyFollowers.mockResolvedValue([]);
    mocks.sendEmail.mockResolvedValue({ sent: true });
    mocks.pushRealtime.mockResolvedValue({ sent: true });
    const { resetStats } = await import('../notification-service/src/consumers/notificationConsumer.js');
    resetStats();
});

describe('notification event consumer', () => {
    const manualType = 'notification.manual_moderation_requested';
    it.each([['approve', 'POST_APPROVED'], ['reject', 'POST_REJECTED'], ['ban', 'POST_BANNED'], ['reopen', 'POST_REOPENED']])
    ('durably queues manual %s with safe historical text and no direct provider calls', async (action, typeCode) => {
        const { handleNotificationEvent } = await import('../notification-service/src/consumers/notificationConsumer.js');
        const payload = { ...eventExamples[manualType], action, jobTitle: '<script>private</script>', note: '<img onerror="bad">\nReason' };
        await handleNotificationEvent(payload, manualType, { eventId: 'manual-1', aggregateId: '7' });
        const queued = mocks.queueNotification.mock.calls[0][0];
        expect(queued).toMatchObject({ eventId: 'manual-1', userId: 5, template: { typeCode, link: '/admin/list-post/' } });
        expect(queued.template.email.html).not.toContain('<script>'); expect(queued.template.email.html).not.toContain('<img onerror');
        expect(queued.template.email.html).toContain('&lt;script&gt;'); expect(queued.template.email.text).toContain('Reason');
        expect(queued.template.email.text).toContain('trạng thái mới nhất');
        expect(mocks.sendEmail).not.toHaveBeenCalled(); expect(mocks.saveNotification).not.toHaveBeenCalled();
    });
    it('queues only the snapshotted follower, in-app only, without rereading followers or emailing', async () => {
        const { handleNotificationEvent } = await import('../notification-service/src/consumers/notificationConsumer.js');
        await handleNotificationEvent({ ...eventExamples[manualType], audience: 'follower', recipientId: 12, note: null }, manualType, { eventId: 'f1' });
        expect(mocks.queueNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 12, template: {
            typeCode: 'NEW_POST', content: expect.any(String), link: '/detail-job/7'
        } }));
        expect(mocks.getCompanyFollowers).not.toHaveBeenCalled(); expect(mocks.getUserEmail).not.toHaveBeenCalled();
    });
    it.each(['author', 'follower'])('bounds Unicode %s notification previews to the legacy column without splitting characters', async audience => {
        const { handleNotificationEvent } = await import('../notification-service/src/consumers/notificationConsumer.js');
        await handleNotificationEvent({ ...eventExamples[manualType], audience, jobTitle: '🧑'.repeat(255), companyName: '🏢'.repeat(255),
            note: audience === 'author' ? 'Reason' : null }, manualType, { eventId: 'long-1' });
        const { content } = mocks.queueNotification.mock.calls[0][0].template;
        expect(Array.from(content)).toHaveLength(255); expect(content.endsWith('…')).toBe(true);
        expect(content).not.toMatch(/[\uD800-\uDFFF]/u);
    });
    it.each([
        [{}, {}], [{ audience: 'follower', action: 'ban', note: null }, { eventId: 'x' }],
        [{ audience: 'follower', note: 'PRIVATE_NOTE' }, { eventId: 'x' }], [{ action: 'invalid' }, { eventId: 'x' }],
        [{ recipientId: null }, { eventId: 'x' }], [{}, { eventId: 'x', aggregateId: 'other' }]
    ])('rejects unsafe manual notification without a non-durable fallback: %j', async (patch, metadata) => {
        const { handleNotificationEvent } = await import('../notification-service/src/consumers/notificationConsumer.js');
        await expect(handleNotificationEvent({ ...eventExamples[manualType], ...patch }, manualType, metadata)).rejects.toThrow();
        expect(mocks.queueNotification).not.toHaveBeenCalled(); expect(mocks.sendEmail).not.toHaveBeenCalled();
        expect(mocks.saveNotification).not.toHaveBeenCalled();
    });
    it.each(Object.keys(eventCatalog).filter((key) => eventCatalog[key].consumers.includes('notification-service.events')))
    ('accepts the published %s contract into the durable delivery path', async (key) => {
        mocks.getCompanyFollowers.mockResolvedValue([9]);
        const { handleNotificationEvent } = await import('../notification-service/src/consumers/notificationConsumer.js');
        const { payload, metadata } = decodeEventFixture(key);
        await handleNotificationEvent(payload, key, metadata);
        expect(mocks.queueNotification).toHaveBeenCalledOnce();
        expect(mocks.queueNotification.mock.calls[0][0]).toMatchObject({ eventId: metadata.eventId });
        expect(mocks.sendEmail).not.toHaveBeenCalled();
        expect(mocks.pushRealtime).not.toHaveBeenCalled();
    });
    it('queues identified events durably without invoking external channels in the consumer', async () => {
        const { handleNotificationEvent, stats } = await import('../notification-service/src/consumers/notificationConsumer.js');
        const payload = { candidateId: 2, candidateEmail: 'snapshot@x.com', decision: 'accepted', jobTitle: 'Dev' };
        await handleNotificationEvent(payload, 'application.decision_email_requested', { eventId: 'e1' });
        mocks.queueNotification.mockResolvedValueOnce({ duplicate: true, notificationId: 1 });
        await handleNotificationEvent(payload, 'application.decision_email_requested', { eventId: 'e1' });
        expect(mocks.queueNotification).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'e1', userId: 2, recipientEmail: 'snapshot@x.com' }));
        expect(mocks.sendEmail).not.toHaveBeenCalled();
        expect(mocks.saveNotification).not.toHaveBeenCalled();
        expect(mocks.pushRealtime).not.toHaveBeenCalled();
        expect(stats.saved).toBe(1);
    });

    it('propagates inbox errors so RabbitMQ cannot ACK an unpersisted delivery', async () => {
        const { handleNotificationEvent } = await import('../notification-service/src/consumers/notificationConsumer.js');
        mocks.queueNotification.mockRejectedValue(new Error('inbox unavailable'));
        await expect(handleNotificationEvent({ candidateId: 2, toStage: 'phong_van' }, 'application.stage_changed', { eventId: 'e1' })).rejects.toThrow('inbox unavailable');
        expect(mocks.sendEmail).not.toHaveBeenCalled();
    });

    it('registers every handler with bounded prefetch', async () => {
        const { startNotificationConsumer, handlers, handleNotificationEvent } = await import('../notification-service/src/consumers/notificationConsumer.js');
        const { notificationRetry } = await import('../notification-service/src/libs/eventRetry.js');
        await startNotificationConsumer();
        expect(mocks.consume).toHaveBeenCalledWith(
            'notification-service.events', Object.keys(handlers), handleNotificationEvent, { prefetch: 10, retry: notificationRetry }
        );
    });

    it('delivers through database, realtime, and looked-up email channels', async () => {
        const { deliver, stats } = await import('../notification-service/src/consumers/notificationConsumer.js');
        const template = { typeCode: 'X', content: 'Content', link: '/x', email: { subject: 'S', html: 'H', text: 'T' } };
        await deliver({ userId: 2, template });
        expect(mocks.saveNotification).toHaveBeenCalledWith({ userId: 2, typeCode: 'X', content: 'Content', link: '/x' });
        expect(mocks.pushRealtime).toHaveBeenCalledWith({ userId: 2, notification: { id: 1, userId: 2 } });
        expect(mocks.sendEmail).toHaveBeenCalledWith({ to: 'user@example.com', subject: 'S', html: 'H', text: 'T' });
        expect(stats).toEqual({ saved: 1, emailed: 1, pushed: 1, failed: 0 });
    });

    it('uses event email directly and skips invalid delivery requests', async () => {
        const { deliver, stats } = await import('../notification-service/src/consumers/notificationConsumer.js');
        const template = { typeCode: 'X', content: 'C', email: { subject: 'S', html: 'H', text: 'T' } };
        await deliver({ userId: 2, template, recipientEmail: 'snapshot@example.com' });
        expect(mocks.getUserEmail).not.toHaveBeenCalled();
        expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'snapshot@example.com' }));
        await deliver({ userId: null, template });
        await deliver({ userId: 2, template: null });
        expect(stats.saved).toBe(1);
    });

    it('isolates channel failures and increments only relevant stats', async () => {
        const { deliver, stats } = await import('../notification-service/src/consumers/notificationConsumer.js');
        const template = { typeCode: 'X', content: 'C', email: { subject: 'S', html: 'H', text: 'T' } };
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
        await deliver({ userId: 2, recipientEmail: 'a@b.com', template: { typeCode: 'X', content: 'C', email: { subject: 'S', html: 'H', text: 'T' } } });
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

    it.each(['PS3', 'PS2', 'PS4', undefined])('does not notify followers of a marked legacy creation snapshot in %s even on replay', async statusCode => {
        const { handlers } = await import('../notification-service/src/consumers/notificationConsumer.js');
        for (let i = 0; i < 2; i += 1) await handlers['job.created']({ job: { id: 7, companyId: 3, statusCode } }, { producer: 'legacy-backend', eventId: 'creation-7' });
        expect(mocks.getCompanyFollowers).not.toHaveBeenCalled(); expect(mocks.saveNotification).not.toHaveBeenCalled();
        expect(mocks.queueNotification).not.toHaveBeenCalled();
    });

    it.each([{ producer: 'legacy-backend', statusCode: 'PS1' }, { producer: 'job-core-service', statusCode: 'PS3' }, { statusCode: 'PS3' }])('keeps existing approved legacy/Core/unmarked backlog notification behavior: %j', async ({ producer, statusCode }) => {
        mocks.getCompanyFollowers.mockResolvedValue([4]);
        const { handlers } = await import('../notification-service/src/consumers/notificationConsumer.js');
        await handlers['job.created']({ job: { id: 7, companyId: 3, statusCode } }, { producer, eventId: 'creation-7' });
        expect(mocks.getCompanyFollowers).toHaveBeenCalledWith(3); expect(mocks.queueNotification).toHaveBeenCalledTimes(1);
    });

    it('ignores unknown events and rethrows handler failures for RabbitMQ nack', async () => {
        const { handleNotificationEvent, stats } = await import('../notification-service/src/consumers/notificationConsumer.js');
        await expect(handleNotificationEvent({}, 'unknown')).resolves.toBeUndefined();
        mocks.getCompanyFollowers.mockRejectedValue(new Error('db'));
        await expect(handleNotificationEvent({ job: { companyId: 2 } }, 'job.created')).rejects.toThrow('db');
        expect(stats.failed).toBe(1);
    });
});
