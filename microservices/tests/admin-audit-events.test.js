import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    AuditLog: { create: vi.fn(), updateOne: vi.fn(), findOne: vi.fn() },
    consume: vi.fn(), transferMessage: vi.fn()
}));
vi.mock('../admin-service/src/models/AuditLog.js', () => ({ AuditLog: mocks.AuditLog }));
vi.mock('../shared/rabbitmq.js', () => ({ consume: mocks.consume }));
vi.mock('../shared/messageTransfer.js', () => ({ transferMessage: mocks.transferMessage }));

import { recordEvent } from '../admin-service/src/controllers/auditController.js';
import { auditRetry, handleAuditEvent, startAuditConsumer } from '../admin-service/src/consumers/auditConsumer.js';
import { createDeliveryHandler } from '../shared/consumeDelivery.js';
import { decodeEventFixture } from './contractAssertions.js';
import { eventCatalog } from '../shared/contracts/eventCatalog.js';

const metadata = {
    eventId: 'event-1', eventType: 'job.created', eventVersion: 1, producer: 'job-core-service',
    aggregateId: '7', occurredAt: '2026-09-04T01:02:03.456Z', correlationId: 'corr-1'
};
const keyConflict = (overrides = {}) => Object.assign(new Error('duplicate'), {
    code: 11000, keyPattern: { eventId: 1 }, keyValue: { eventId: 'event-1' }, ...overrides
});
const existingQuery = (value) => {
    const query = { lean: vi.fn().mockResolvedValue(value) };
    for (const key of ['select', 'collation', 'read', 'readConcern', 'maxTimeMS']) query[key] = vi.fn(() => query);
    return query;
};

beforeEach(() => {
    for (const fn of Object.values(mocks.AuditLog)) fn.mockReset();
    mocks.consume.mockReset().mockResolvedValue(undefined);
    mocks.transferMessage.mockReset().mockResolvedValue(undefined);
    mocks.AuditLog.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0, upsertedCount: 1 });
    mocks.AuditLog.findOne.mockReturnValue(existingQuery({ _id: 'stored' }));
});

describe('idempotent Admin audit persistence', () => {
    it.each(Object.keys(eventCatalog))('accepts the published %s contract without losing dedup identity', async (key) => {
        const { payload, metadata: identity } = decodeEventFixture(key);
        await handleAuditEvent(payload, key, identity);
        expect(mocks.AuditLog.updateOne.mock.calls[0][0]).toEqual({ kind: 'event', eventId: identity.eventId });
        expect(mocks.AuditLog.updateOne.mock.calls[0][1].$setOnInsert).toMatchObject({ name: key, aggregateId: identity.aggregateId });
        expect(mocks.AuditLog.create).not.toHaveBeenCalled();
    });
    it('atomically inserts metadata and redacted payload without a separate inbox', async () => {
        expect(await recordEvent('job.created', { jobId: 7, nested: { fileBase64: 'secret', password: 'secret' } }, metadata)).toEqual({ duplicate: false });
        expect(mocks.AuditLog.create).not.toHaveBeenCalled();
        expect(mocks.AuditLog.findOne).not.toHaveBeenCalled();
        expect(mocks.AuditLog.updateOne).toHaveBeenCalledWith(
            { kind: 'event', eventId: 'event-1' },
            { $setOnInsert: expect.objectContaining({
                kind: 'event', name: 'job.created', service: 'job-core-service', eventId: 'event-1',
                eventVersion: 1, aggregateId: '7', occurredAt: metadata.occurredAt, correlationId: 'corr-1',
                targetType: 'job', targetId: '7', createdAt: expect.any(Date),
                payload: { jobId: 7, nested: { fileBase64: '[đã lược bỏ]', password: '[đã lược bỏ]' } }
            }) },
            expect.objectContaining({ upsert: true, runValidators: true, collation: { locale: 'simple' }, writeConcern: { w: 'majority', j: true, wtimeout: 5000 } })
        );
    });

    it('preserves the first record on replay instead of updating its payload or retention date', async () => {
        mocks.AuditLog.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1, upsertedCount: 0 });
        expect(await recordEvent('job.created', { jobId: 7, changed: true }, metadata)).toEqual({ duplicate: true });
        const update = mocks.AuditLog.updateOne.mock.calls[0][1];
        expect(Object.keys(update)).toEqual(['$setOnInsert']);
    });

    it('does not accept a duplicate match that cannot be verified by a majority read', async () => {
        mocks.AuditLog.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1, upsertedCount: 0 });
        mocks.AuditLog.findOne.mockReturnValue(existingQuery(null));
        await expect(recordEvent('job.created', {}, metadata)).rejects.toMatchObject({ code: 'AUDIT_EVENT_NOT_VISIBLE' });
    });

    it('accepts an old outbox message ID without requiring envelope v1 fields', async () => {
        await recordEvent('job.created', { jobId: 7 }, { eventId: 'old-id' });
        expect(mocks.AuditLog.updateOne.mock.calls[0][1].$setOnInsert).toMatchObject({ eventId: 'old-id', service: 'job' });
    });

    it('acknowledges a concurrent unique-key race only after finding a durable matching record', async () => {
        mocks.AuditLog.updateOne.mockRejectedValueOnce(keyConflict());
        const query = existingQuery({ _id: 'stored' });
        mocks.AuditLog.findOne.mockReturnValue(query);
        expect(await recordEvent('job.created', {}, metadata)).toEqual({ duplicate: true });
        expect(mocks.AuditLog.findOne).toHaveBeenCalledWith({ kind: 'event', eventId: 'event-1' });
        expect(query.read).toHaveBeenCalledWith('primary');
        expect(query.readConcern).toHaveBeenCalledWith('majority');
    });

    it.each([
        { keyPattern: { other: 1 } }, { keyValue: { eventId: 'another-event' } },
        { keyPattern: { eventId: 1, name: 1 } }, { keyPattern: undefined }
    ])('does not swallow an unrelated E11000 error: %j', async (overrides) => {
        const error = keyConflict(overrides);
        mocks.AuditLog.updateOne.mockRejectedValueOnce(error);
        await expect(recordEvent('job.created', {}, metadata)).rejects.toBe(error);
        expect(mocks.AuditLog.findOne).not.toHaveBeenCalled();
    });

    it('propagates uncertain duplicate verification and majority-read errors', async () => {
        const error = keyConflict();
        mocks.AuditLog.updateOne.mockRejectedValue(error);
        mocks.AuditLog.findOne.mockReturnValueOnce(existingQuery(null));
        await expect(recordEvent('job.created', {}, metadata)).rejects.toMatchObject({ code: 'AUDIT_EVENT_NOT_VISIBLE' });
        const query = existingQuery(null);
        query.lean.mockRejectedValue(new Error('read unavailable'));
        mocks.AuditLog.findOne.mockReturnValue(query);
        await expect(recordEvent('job.created', {}, metadata)).rejects.toThrow('read unavailable');
    });

    it.each([{ acknowledged: false }, { acknowledged: true, matchedCount: 0, upsertedCount: 0 }])('does not treat an unconfirmed/no-op write result as success: %j', async (result) => {
        mocks.AuditLog.updateOne.mockResolvedValue(result);
        await expect(recordEvent('job.created', {}, metadata)).rejects.toThrow('not acknowledged');
    });

    it('rejects invalid payloads and identities before writing', async () => {
        for (const payload of [null, [], 'invalid']) await expect(recordEvent('job.created', payload, metadata)).rejects.toThrow('payload');
        for (const eventId of ['', null, 'bad id', 'x'.repeat(129)]) await expect(recordEvent('job.created', {}, { ...metadata, eventId })).rejects.toThrow('eventId');
        await expect(recordEvent('wrong.event', {}, metadata)).rejects.toThrow('does not match');
        expect(mocks.AuditLog.updateOne).not.toHaveBeenCalled();
        expect(mocks.AuditLog.create).not.toHaveBeenCalled();
    });
});

describe('Admin consumer failure handling', () => {
    it('subscribes to all events with bounded retries and forwards metadata', async () => {
        await startAuditConsumer();
        expect(mocks.consume).toHaveBeenCalledWith('admin-service.audit', ['#'], handleAuditEvent, { prefetch: 50, retry: auditRetry });
        await handleAuditEvent({ jobId: 7 }, 'job.created', metadata);
        expect(mocks.AuditLog.updateOne.mock.calls[0][0].eventId).toBe('event-1');
    });

    it('propagates both identified and legacy write failures instead of swallowing them', async () => {
        const error = new Error('MongoDB down');
        mocks.AuditLog.updateOne.mockRejectedValue(error);
        mocks.AuditLog.create.mockRejectedValue(error);
        await expect(handleAuditEvent({}, 'job.created', metadata)).rejects.toBe(error);
        await expect(handleAuditEvent({}, 'job.created')).rejects.toBe(error);
    });

    it('does not ACK a failed write until its DLQ transfer has been confirmed', async () => {
        mocks.AuditLog.updateOne.mockRejectedValue(Object.assign(new Error('invalid document'), { code: 121 }));
        let confirm;
        mocks.transferMessage.mockImplementation(() => new Promise((resolve) => { confirm = resolve; }));
        const channel = { ack: vi.fn(), nack: vi.fn(), close: vi.fn() };
        const callback = createDeliveryHandler({ channel, queueName: 'admin-service.audit', handler: handleAuditEvent, retry: auditRetry, isActive: () => true });
        const msg = { content: Buffer.from('{}'), fields: { routingKey: 'job.created' }, properties: { messageId: 'event-1' } };
        const pending = callback(msg);
        await vi.waitFor(() => expect(mocks.transferMessage).toHaveBeenCalledOnce());
        expect(channel.ack).not.toHaveBeenCalled();
        expect(mocks.transferMessage.mock.calls[0][0]).toMatchObject({ queueName: 'admin-service.audit', routingKey: 'job.created', retryCount: undefined });
        confirm();
        await pending;
        expect(channel.ack).toHaveBeenCalledWith(msg);
    });

    it('routes a transient identified audit failure back only to the Admin queue', async () => {
        vi.useFakeTimers();
        try {
            mocks.AuditLog.updateOne.mockRejectedValue(Object.assign(new Error('write concern timeout'), { code: 64 }));
            const channel = { ack: vi.fn(), nack: vi.fn(), close: vi.fn() };
            const callback = createDeliveryHandler({ channel, queueName: 'admin-service.audit', handler: handleAuditEvent, retry: auditRetry, isActive: () => true });
            const msg = { content: Buffer.from('{}'), fields: { routingKey: 'job.created' }, properties: { messageId: 'event-1' } };
            const pending = callback(msg);
            await vi.advanceTimersByTimeAsync(1999);
            expect(channel.ack).not.toHaveBeenCalled();
            expect(mocks.transferMessage).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            await pending;
            expect(mocks.transferMessage).toHaveBeenCalledWith(expect.objectContaining({ queueName: 'admin-service.audit', msg, routingKey: 'job.created', retryCount: 1 }));
            expect(channel.ack).toHaveBeenCalledWith(msg);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([{ name: 'MongoNetworkError' }, { name: 'MongooseServerSelectionError' }, { code: 64 }, { code: 91 }, { code: 112 }, { code: 'AUDIT_EVENT_NOT_VISIBLE' }])('retries known transient Mongo failures only for identified events: %j', (error) => {
        expect(auditRetry.shouldRetry(error, { metadata })).toBe(true);
        expect(auditRetry.shouldRetry(error, {})).toBe(false);
    });

    it.each([{ code: 13 }, { code: 18 }, { name: 'MongoServerSelectionError', code: 18 }, { code: 121 }, { code: 11000 }, { name: 'ValidationError' }, new Error('unknown')])('does not retry permanent or unknown errors: %j', (error) => {
        expect(auditRetry.shouldRetry(error, { metadata })).toBe(false);
    });
});
