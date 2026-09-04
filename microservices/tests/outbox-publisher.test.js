import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mq = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('amqplib', () => ({ default: { connect: mq.connect } }));

const broker = () => {
    const channel = new EventEmitter();
    channel.assertExchange = vi.fn().mockResolvedValue(undefined);
    channel.publish = vi.fn((exchange, key, body, options, confirm) => {
        confirm(null);
        return true;
    });
    channel.close = vi.fn(async () => { channel.emit('close'); });
    const connection = new EventEmitter();
    connection.createConfirmChannel = vi.fn().mockResolvedValue(channel);
    let closed = false;
    connection.close = vi.fn(async () => {
        if (closed) return;
        closed = true;
        channel.emit('close');
        connection.emit('close');
    });
    return { connection, channel };
};

let api;
let first;
beforeEach(async () => {
    vi.resetModules();
    first = broker();
    mq.connect.mockReset().mockResolvedValue(first.connection);
    api = await import('../shared/outboxPublisher.js');
});
afterEach(async () => {
    api.closeOutboxPublisher();
    await Promise.resolve();
    await Promise.resolve();
    vi.useRealTimers();
});
const send = (id = 'event-1') => api.publishOutboxEvent('job.created', { job: { id: 12 } }, { messageId: id });

describe('outbox RabbitMQ connection', () => {
    it('shares initialization and preserves payload plus stable event metadata', async () => {
        await Promise.all([send(), send('event-2')]);
        expect(mq.connect).toHaveBeenCalledOnce();
        expect(first.connection.createConfirmChannel).toHaveBeenCalledOnce();
        expect(first.channel.assertExchange).toHaveBeenCalledWith('jobportal.events', 'topic', { durable: true });
        const [exchange, key, body, properties] = first.channel.publish.mock.calls[0];
        expect([exchange, key]).toEqual(['jobportal.events', 'job.created']);
        expect(JSON.parse(body.toString())).toEqual({ job: { id: 12 } });
        expect(properties).toMatchObject({ messageId: 'event-1', mandatory: true, persistent: true });
    });

    it('does not publish until exchange initialization finishes', async () => {
        let declared;
        first.channel.assertExchange.mockImplementation(() => new Promise((resolve) => { declared = resolve; }));
        const result = Promise.all([send(), send('event-2')]);
        await vi.waitFor(() => expect(first.channel.assertExchange).toHaveBeenCalledOnce());
        expect(first.channel.publish).not.toHaveBeenCalled();
        declared();
        await result;
    });

    it('reopens after initialization fails', async () => {
        first.channel.assertExchange.mockRejectedValueOnce(new Error('exchange unavailable'));
        await expect(send()).rejects.toThrow('exchange unavailable');
        const second = broker();
        mq.connect.mockResolvedValueOnce(second.connection);
        await send();
        expect(first.connection.close).toHaveBeenCalled();
        expect(second.channel.publish).toHaveBeenCalledOnce();
    });

    it('does not send from a connection that completed after the acquisition timeout', async () => {
        vi.useFakeTimers();
        let connected;
        mq.connect.mockImplementationOnce(() => new Promise((resolve) => { connected = resolve; }));
        const failed = expect(send()).rejects.toThrow('connection timeout');
        await vi.advanceTimersByTimeAsync(10_000);
        await failed;
        connected(first.connection);
        await vi.advanceTimersByTimeAsync(0);
        expect(first.connection.close).toHaveBeenCalled();
        expect(first.channel.publish).not.toHaveBeenCalled();
        const second = broker();
        mq.connect.mockResolvedValueOnce(second.connection);
        await send();
        expect(second.channel.publish).toHaveBeenCalledOnce();
    });

    it('retires a timed-out confirm channel and retries on a new connection', async () => {
        vi.useFakeTimers();
        first.channel.publish.mockReturnValue(true).mockImplementation(() => true);
        const failed = expect(send()).rejects.toThrow('confirm timeout');
        await vi.advanceTimersByTimeAsync(10_000);
        await failed;
        const second = broker();
        mq.connect.mockResolvedValueOnce(second.connection);
        await send();
        expect(second.channel.publish.mock.calls[0][3].messageId).toBe('event-1');
    });
});
