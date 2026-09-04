import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mq = vi.hoisted(() => ({ connect: vi.fn(), closeTransferPublisher: vi.fn(), transferMessage: vi.fn() }));
vi.mock('amqplib', () => ({ default: { connect: mq.connect } }));
vi.mock('../shared/messageTransfer.js', () => ({
    DEAD_LETTER_EXCHANGE: 'jobportal.events.dead-letter',
    closeTransferPublisher: mq.closeTransferPublisher, transferMessage: mq.transferMessage
}));

const broker = () => {
    const channel = Object.assign(new EventEmitter(), Object.fromEntries(
        ['assertExchange', 'assertQueue', 'bindQueue', 'prefetch', 'consume', 'close', 'ack', 'nack'].map((key) => [key, vi.fn().mockResolvedValue(undefined)])
    ));
    const connection = Object.assign(new EventEmitter(), {
        createChannel: vi.fn().mockResolvedValue(channel), close: vi.fn()
    });
    let closed = false;
    channel.close.mockImplementation(async () => channel.emit('close'));
    connection.close.mockImplementation(async () => {
        if (closed) return;
        closed = true;
        channel.emit('close');
        connection.emit('close');
    });
    return { channel, connection };
};

let first;
let second;
let api;
beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    first = broker();
    second = broker();
    mq.connect.mockReset().mockResolvedValueOnce(first.connection).mockResolvedValue(second.connection);
    mq.closeTransferPublisher.mockReset();
    mq.transferMessage.mockReset().mockResolvedValue(undefined);
    api = await import('../shared/rabbitmq.js');
});
afterEach(async () => {
    await api.closeConnection();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
});

describe('consumer channel lifecycle with pending transfers', () => {
    it.each(['close', 'error'])('reconnects after channel %s even without a connection close notification', async (event) => {
        await api.consume('queue', ['job.*'], vi.fn(), { prefetch: 3 });
        first.channel.emit(event, new Error('channel unavailable'));
        await vi.advanceTimersByTimeAsync(3000);
        expect(second.channel.consume).toHaveBeenCalledOnce();
        expect(second.channel.prefetch).toHaveBeenCalledWith(3);
        expect(await api.getChannel()).toBe(second.channel);
    });

    it('does not let a late close from an old connection invalidate the new channel', async () => {
        await api.consume('queue', ['#'], vi.fn());
        first.connection.emit('close');
        await vi.advanceTimersByTimeAsync(3000);
        first.connection.emit('close');
        await vi.advanceTimersByTimeAsync(3000);
        expect(await api.getChannel()).toBe(second.channel);
        expect(mq.connect).toHaveBeenCalledTimes(2);
        expect(second.channel.consume).toHaveBeenCalledOnce();
    });

    it('reattaches a cancelled subscription', async () => {
        await api.consume('queue', ['#'], vi.fn());
        await first.channel.consume.mock.calls[0][1](null);
        await vi.advanceTimersByTimeAsync(3000);
        expect(second.channel.consume).toHaveBeenCalledOnce();
    });

    it('never reconnects or attaches again after intentional shutdown', async () => {
        await api.consume('queue', ['#'], vi.fn());
        await api.closeConnection();
        await vi.advanceTimersByTimeAsync(60000);
        expect(mq.connect).toHaveBeenCalledOnce();
        expect(mq.closeTransferPublisher).toHaveBeenCalledOnce();
        expect(first.connection.close).toHaveBeenCalledOnce();
    });

    it('does not expose a channel before exchange setup finishes', async () => {
        let ready;
        first.channel.assertExchange.mockImplementationOnce(() => new Promise((resolve) => { ready = resolve; }));
        const pending = api.getChannel();
        await vi.advanceTimersByTimeAsync(0);
        let resolved = false;
        const concurrent = api.getChannel().then((value) => { resolved = true; return value; });
        await vi.advanceTimersByTimeAsync(0);
        expect(resolved).toBe(false);
        ready();
        expect(await pending).toBe(first.channel);
        expect(await concurrent).toBe(first.channel);
        expect(first.connection.createChannel).toHaveBeenCalledOnce();
    });

    it('retries setup after a failed exchange declaration instead of caching the broken promise', async () => {
        first.channel.assertExchange.mockRejectedValueOnce(new Error('declaration failed'));
        await expect(api.consume('queue', ['#'], vi.fn())).rejects.toThrow('declaration failed');
        await vi.advanceTimersByTimeAsync(3000);
        expect(second.channel.consume).toHaveBeenCalledOnce();
        expect(await api.getChannel()).toBe(second.channel);
    });

    it('does not ACK a handler that finished after source reconnection', async () => {
        let complete;
        const handler = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
        await api.consume('queue', ['#'], handler);
        const pending = first.channel.consume.mock.calls[0][1]({ content: Buffer.from('{}'), fields: { routingKey: 'job.created' } });
        await vi.advanceTimersByTimeAsync(0);
        first.connection.emit('close');
        await vi.advanceTimersByTimeAsync(3000);
        complete();
        await pending;
        expect(first.channel.ack).not.toHaveBeenCalled();
        expect(second.channel.ack).not.toHaveBeenCalled();
        expect(mq.transferMessage).not.toHaveBeenCalled();
    });
});
