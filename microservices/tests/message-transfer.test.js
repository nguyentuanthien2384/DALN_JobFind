import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mq = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('amqplib', () => ({ default: { connect: mq.connect } }));

const QUEUE = 'notification-service.events';
const broker = () => {
    const channel = Object.assign(new EventEmitter(), {
        assertExchange: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn(() => true),
        close: vi.fn()
    });
    const connection = Object.assign(new EventEmitter(), {
        createConfirmChannel: vi.fn().mockResolvedValue(channel),
        close: vi.fn()
    });
    let closed = false;
    connection.close.mockImplementation(async () => {
        if (closed) return;
        closed = true;
        channel.emit('close');
        connection.emit('close');
    });
    channel.close.mockImplementation(async () => channel.emit('close'));
    return { channel, connection };
};

let api;
let publisher;
let source;
let active;
let handler;
let callback;
let original;
const databaseError = () => Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' });

beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    publisher = broker();
    mq.connect.mockReset().mockResolvedValue(publisher.connection);
    active = true;
    source = { ack: vi.fn(), nack: vi.fn(), close: vi.fn(async () => { active = false; }) };
    handler = vi.fn().mockRejectedValue(databaseError());
    api = await import('../shared/messageTransfer.js');
    const { createDeliveryHandler } = await import('../shared/consumeDelivery.js');
    const { notificationRetry } = await import('../notification-service/src/libs/eventRetry.js');
    callback = createDeliveryHandler({ channel: source, queueName: QUEUE, handler, retry: notificationRetry, isActive: () => active });
    original = {
        content: Buffer.from('{ "candidateId": 2, "toStage": "phong_van" }'),
        fields: { exchange: 'jobportal.events', routingKey: 'application.stage_changed', deliveryTag: 7 },
        properties: {
            messageId: 'stable-event', correlationId: 'corr-1', type: 'application.stage_changed',
            appId: 'application-service', timestamp: 1788483723, contentType: 'application/json',
            headers: { 'x-event-version': 1, 'x-aggregate-id': '31', 'x-occurred-at': '2026-09-04T01:02:03.456Z' }
        }
    };
});
afterEach(async () => {
    api.closeTransferPublisher();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
});

const published = (index = 0) => publisher.channel.publish.mock.calls[index];
const redelivered = (call) => ({ content: call[2], properties: call[3], fields: { exchange: call[0], routingKey: call[1], deliveryTag: 8 } });
const failPermanently = () => handler.mockRejectedValue(new Error('bad payload'));

describe('confirmed DLQ transfer failure boundaries', () => {
    it('waits for both confirmation and socket drain before ACKing the source', async () => {
        failPermanently();
        publisher.channel.publish.mockReturnValue(false);
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(0);
        expect(source.ack).not.toHaveBeenCalled();
        expect(published().slice(0, 3)).toEqual(['jobportal.events.dead-letter', QUEUE, original.content]);
        published()[4](null);
        await vi.advanceTimersByTimeAsync(0);
        expect(source.ack).not.toHaveBeenCalled();
        publisher.channel.emit('drain');
        await pending;
        expect(source.ack).toHaveBeenCalledExactlyOnceWith(original);
        expect(source.nack).not.toHaveBeenCalled();
    });

    it('keeps raw body, identity, timestamps and diagnostics but drops expiry and account userId', async () => {
        original.content = Buffer.from('{invalid json');
        original.properties.expiration = '1';
        original.properties.userId = 'original-publisher-account';
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(0);
        expect(handler).not.toHaveBeenCalled();
        const options = published()[3];
        expect(published()[2]).toBe(original.content);
        expect(options).toMatchObject({
            messageId: 'stable-event', correlationId: 'corr-1', appId: 'application-service',
            timestamp: original.properties.timestamp, mandatory: true, persistent: true,
            headers: { ...original.properties.headers, 'x-failed-queue': QUEUE, 'x-original-routing-key': 'application.stage_changed', 'x-error': expect.any(String) }
        });
        expect(options).not.toHaveProperty('expiration');
        expect(options).not.toHaveProperty('userId');
        published()[4](null);
        await pending;
    });

    it.each(['return', 'nack', 'close', 'error', 'timeout'])('never ACKs on publisher %s and requeues with a cooldown', async (failure) => {
        failPermanently();
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(0);
        if (failure === 'return') {
            publisher.channel.emit('return', { properties: published()[3], fields: { replyText: 'NO_ROUTE' } });
            published()[4](null); // A returned message can still receive a broker ACK.
        } else if (failure === 'nack') published()[4](new Error('broker nack'));
        else if (failure === 'close') publisher.channel.emit('close');
        else if (failure === 'error') publisher.channel.emit('error', new Error('socket'));
        else await vi.advanceTimersByTimeAsync(10000);
        await vi.advanceTimersByTimeAsync(0);
        expect(source.ack).not.toHaveBeenCalled();
        expect(source.nack).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2000);
        await pending;
        expect(source.nack).toHaveBeenCalledExactlyOnceWith(original, false, true);
        expect(source.close).not.toHaveBeenCalled();
    });

    it('does not publish on a late connection after acquisition timed out', async () => {
        failPermanently();
        let connect;
        mq.connect.mockImplementationOnce(() => new Promise((resolve) => { connect = resolve; }));
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(12000);
        await pending;
        expect(source.ack).not.toHaveBeenCalled();
        connect(publisher.connection);
        await vi.advanceTimersByTimeAsync(0);
        expect(publisher.connection.close).toHaveBeenCalledOnce();
        expect(publisher.channel.publish).not.toHaveBeenCalled();
    });

    it('never settles a delivery on its old source after the source disconnects', async () => {
        failPermanently();
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(0);
        active = false;
        published()[4](null);
        await pending;
        expect(source.ack).not.toHaveBeenCalled();
        expect(source.nack).not.toHaveBeenCalled();
    });

    it.each([true, false])('an ACK error closes the source without treating success as a handler failure (transfer=%s)', async (transfer) => {
        if (transfer) failPermanently();
        else handler.mockResolvedValue(undefined);
        source.ack.mockImplementationOnce(() => { throw new Error('channel closed before ACK'); });
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(0);
        if (transfer) published()[4](null);
        await pending;
        expect(source.close).toHaveBeenCalledOnce();
        expect(source.nack).not.toHaveBeenCalled();
        expect(publisher.channel.publish).toHaveBeenCalledTimes(transfer ? 1 : 0);
    });

    it('contains a NACK failure without leaking a rejected callback promise', async () => {
        failPermanently();
        source.nack.mockImplementationOnce(() => { throw new Error('source closed'); });
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(0);
        published()[4](new Error('broker nack'));
        await vi.advanceTimersByTimeAsync(2000);
        await expect(pending).resolves.toBeUndefined();
        expect(source.close).toHaveBeenCalledOnce();
    });

    it('matches concurrent returns by publish attempt, even when event IDs are identical', async () => {
        failPermanently();
        const duplicate = { ...original, fields: { ...original.fields, deliveryTag: 9 } };
        const first = callback(original);
        const second = callback(duplicate);
        await vi.advanceTimersByTimeAsync(0);
        expect(mq.connect).toHaveBeenCalledOnce();
        expect(published(0)[3].messageId).toBe(published(1)[3].messageId);
        expect(published(0)[3].headers['x-publish-id']).not.toBe(published(1)[3].headers['x-publish-id']);
        publisher.channel.emit('return', { properties: published(0)[3], fields: { replyText: 'NO_ROUTE' } });
        published(0)[4](null);
        published(1)[4](null);
        await second;
        expect(source.ack).toHaveBeenCalledExactlyOnceWith(duplicate);
        await vi.advanceTimersByTimeAsync(2000);
        await first;
        expect(source.nack).toHaveBeenCalledExactlyOnceWith(original, false, true);
    });
});

describe('bounded, targeted retries for idempotent notification events', () => {
    it('preserves identity through three delayed retries, restores routing and finally transfers to DLQ', async () => {
        let msg = original;
        for (const [index, delay] of [2000, 10000, 30000].entries()) {
            const pending = callback(msg);
            await vi.advanceTimersByTimeAsync(delay - 1);
            expect(publisher.channel.publish).toHaveBeenCalledTimes(index);
            expect(source.ack).toHaveBeenCalledTimes(index);
            await vi.advanceTimersByTimeAsync(1);
            const call = published(index);
            expect(call.slice(0, 3)).toEqual(['', QUEUE, original.content]);
            expect(call[3]).toMatchObject({
                messageId: 'stable-event', type: 'application.stage_changed',
                headers: { 'x-retry-count': index + 1, 'x-retry-queue': QUEUE, 'x-original-routing-key': 'application.stage_changed' }
            });
            call[4](null);
            await pending;
            msg = redelivered(call);
        }
        const last = callback(msg);
        await vi.advanceTimersByTimeAsync(0);
        expect(published(3)[0]).toBe('jobportal.events.dead-letter');
        expect(published(3)[3].headers['x-retry-count']).toBe(3);
        published(3)[4](null);
        await last;
        expect(handler).toHaveBeenCalledTimes(4);
        expect(handler.mock.calls.every((call) => call[1] === 'application.stage_changed' && call[2].eventId === 'stable-event')).toBe(true);
        expect(source.ack).toHaveBeenCalledTimes(4);
    });

    it('carries the consumed retry count into a fresh handler instance after restart', async () => {
        original.fields = { exchange: '', routingKey: QUEUE };
        Object.assign(original.properties.headers, { 'x-retry-count': 3, 'x-retry-queue': QUEUE, 'x-original-routing-key': 'application.stage_changed' });
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(0);
        expect(published()[0]).toBe('jobportal.events.dead-letter');
        published()[4](null);
        await pending;
    });

    it('leaves the source unacknowledged if it disconnects during backoff', async () => {
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(1000);
        active = false;
        await vi.advanceTimersByTimeAsync(1000);
        await pending;
        expect(publisher.channel.publish).not.toHaveBeenCalled();
        expect(source.ack).not.toHaveBeenCalled();
        expect(source.nack).not.toHaveBeenCalled();
    });

    it.each(['legacy', 'no-policy', 'permanent', 'malformed', 'version'])('does not auto-retry %s messages', async (kind) => {
        if (kind === 'legacy') original.properties = {};
        if (kind === 'permanent') handler.mockRejectedValue(Object.assign(new Error('schema missing'), { code: 'ER_NO_SUCH_TABLE' }));
        if (kind === 'malformed') original.content = Buffer.from('{');
        if (kind === 'version') original.properties.headers['x-event-version'] = 2;
        if (kind === 'no-policy') {
            const { createDeliveryHandler } = await import('../shared/consumeDelivery.js');
            callback = createDeliveryHandler({ channel: source, queueName: QUEUE, handler, isActive: () => active });
        }
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(0);
        expect(published()[0]).toBe('jobportal.events.dead-letter');
        expect(published()[3].headers).not.toHaveProperty('x-retry-count');
        published()[4](null);
        await pending;
    });

    it.each([-1, '1', 1.5, 6])('quarantines invalid retry count %j before invoking the handler', async (count) => {
        original.properties.headers['x-retry-count'] = count;
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(0);
        expect(handler).not.toHaveBeenCalled();
        expect(published()[3].headers['x-error']).toBe('Invalid retry count');
        published()[4](null);
        await pending;
    });

    it('cannot use routing headers to bypass validation on a normal exchange delivery', async () => {
        original.fields.routingKey = 'wrong.event';
        Object.assign(original.properties.headers, { 'x-original-routing-key': 'application.stage_changed', 'x-retry-count': 1, 'x-retry-queue': QUEUE });
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(0);
        expect(handler).not.toHaveBeenCalled();
        expect(published()[3].headers['x-error']).toContain('does not match');
        published()[4](null);
        await pending;
    });

    it('retains the business routing key when a targeted retry has corrupt JSON', async () => {
        original.fields = { exchange: '', routingKey: QUEUE };
        Object.assign(original.properties.headers, { 'x-retry-count': 1, 'x-retry-queue': QUEUE, 'x-original-routing-key': 'application.stage_changed' });
        original.content = Buffer.from('{');
        const pending = callback(original);
        await vi.advanceTimersByTimeAsync(0);
        expect(published()[3].headers['x-original-routing-key']).toBe('application.stage_changed');
        expect(handler).not.toHaveBeenCalled();
        published()[4](null);
        await pending;
    });
});
