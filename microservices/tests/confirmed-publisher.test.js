import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfirmedPublisher } from '../shared/confirmedPublisher.js';

let channel;
let publish;
beforeEach(() => {
    channel = new EventEmitter();
    channel.publish = vi.fn(() => true);
    channel.close = vi.fn(async () => { channel.emit('close'); });
    publish = createConfirmedPublisher(channel, { timeoutMs: 100 });
});
afterEach(() => {
    channel.emit('close');
    vi.useRealTimers();
});
const send = () => publish('events', 'application.stage_changed', Buffer.from('{}'), { messageId: 'stable-event-id' });

describe('publisher confirms', () => {
    it.each([true, false])('requires both confirm and drain under backpressure (confirm first: %s)', async (confirmFirst) => {
        channel.publish.mockReturnValue(false);
        const done = vi.fn();
        const result = send().then(done);
        const confirm = channel.publish.mock.calls[0][4];
        if (confirmFirst) confirm(null);
        else channel.emit('drain');
        await Promise.resolve();
        expect(done).not.toHaveBeenCalled();
        if (confirmFirst) channel.emit('drain');
        else confirm(null);
        await result;
        expect(done).toHaveBeenCalledOnce();
    });

    it('matches a returned message to its attempt even when concurrent events have the same messageId', async () => {
        const first = send();
        const second = send();
        const failed = expect(first).rejects.toThrow('unroutable');
        const firstOptions = channel.publish.mock.calls[0][3];
        expect(firstOptions).toMatchObject({ mandatory: true, messageId: 'stable-event-id' });
        channel.emit('return', { properties: firstOptions, fields: { replyText: 'NO_ROUTE' } });
        channel.publish.mock.calls[0][4](null);
        channel.publish.mock.calls[1][4](null);
        await failed;
        await expect(second).resolves.toBeUndefined();
    });

    it('rejects a broker NACK without reporting publish success', async () => {
        const result = send();
        const failed = expect(result).rejects.toThrow('nack');
        channel.publish.mock.calls[0][4](new Error('broker nack'));
        await failed;
    });

    it.each(['close', 'error'])('rejects pending messages when the channel emits %s', async (event) => {
        const result = send();
        const failed = expect(result).rejects.toThrow();
        channel.emit(event, new Error('connection lost'));
        await failed;
        await expect(send()).rejects.toThrow('closed');
    });

    it('times out and retires the channel instead of accumulating unconfirmed callbacks', async () => {
        vi.useFakeTimers();
        const failed = expect(send()).rejects.toThrow('confirm timeout');
        await vi.advanceTimersByTimeAsync(100);
        await failed;
        expect(channel.close).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('handles a synchronous write failure and rejects later sends on the failed channel', async () => {
        channel.publish.mockImplementation(() => { throw new Error('write failed'); });
        await expect(send()).rejects.toThrow('write failed');
        await expect(send()).rejects.toThrow('closed');
    });
});
