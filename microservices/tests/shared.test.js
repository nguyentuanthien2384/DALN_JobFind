import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const mq = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('amqplib', () => ({ default: { connect: mq.connect } }));

afterEach(async () => {
    const { closeConnection } = await import('../shared/rabbitmq.js');
    await closeConnection();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('shared event catalogue', () => {
    it('keeps publisher and consumer routing names stable', async () => {
        const { EXCHANGE, EVENTS, QUEUES } = await import('../shared/events.js');
        expect(EXCHANGE).toBe('jobportal.events');
        expect(new Set(Object.values(EVENTS)).size).toBe(Object.keys(EVENTS).length);
        expect(QUEUES.SEARCH_INDEXER).toBe('search-service.indexer');
        expect(EVENTS.APPLICATION_DECISION_EMAIL_REQUESTED).toBe('application.decision_email_requested');
    });
});

describe('shared logger', () => {
    beforeEach(() => vi.resetModules());

    it('redacts nested credentials/PII and connection strings without breaking cyclic logs', async () => {
        const { redactLog } = await import('../shared/logger.js');
        const value = { password: '123', nested: { email: 'person@company.com', api_key: 'abc' },
            error: 'amqp://user:password@broker:5672 failed for person@company.com' };
        value.circular = value;
        const result = JSON.stringify(redactLog(value));
        expect(result).not.toMatch(/123|person@company.com|user:password|abc/);
        expect(result).toContain('[REDACTED]');
        expect(result).toContain('[TRUNCATED]');
    });

    it('writes structured info/error logs and merges metadata', async () => {
        vi.stubEnv('LOG_LEVEL', 'debug');
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { createLogger } = await import('../shared/logger.js');
        const logger = createLogger('svc');
        logger.info('ready', { requestId: 'r1' });
        logger.warn('slow', { elapsed: 9 });
        const info = JSON.parse(log.mock.calls[0][0]);
        const warning = JSON.parse(error.mock.calls[0][0]);
        expect(info).toMatchObject({ level: 'info', service: 'svc', message: 'ready', requestId: 'r1' });
        expect(info.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(warning).toMatchObject({ level: 'warn', elapsed: 9 });
    });

    it('filters messages below the configured threshold', async () => {
        vi.stubEnv('LOG_LEVEL', 'error');
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { createLogger } = await import('../shared/logger.js');
        const logger = createLogger('svc');
        logger.debug('hidden');
        logger.info('hidden');
        logger.warn('hidden');
        logger.error('visible');
        expect(log).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledOnce();
    });
});

describe('RabbitMQ wrapper', () => {
    let channel;
    let connection;
    let transferChannel;

    beforeEach(() => {
        vi.resetModules();
        mq.connect.mockReset();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        channel = Object.assign(new EventEmitter(), {
            assertExchange: vi.fn().mockResolvedValue(undefined),
            assertQueue: vi.fn().mockResolvedValue(undefined),
            prefetch: vi.fn().mockResolvedValue(undefined),
            bindQueue: vi.fn().mockResolvedValue(undefined),
            consume: vi.fn().mockResolvedValue(undefined),
            publish: vi.fn(),
            ack: vi.fn(),
            nack: vi.fn(),
            close: vi.fn().mockResolvedValue(undefined)
        });
        connection = Object.assign(new EventEmitter(), {
            createChannel: vi.fn().mockResolvedValue(channel),
            close: vi.fn().mockResolvedValue(undefined)
        });
        vi.spyOn(connection, 'on');
        transferChannel = Object.assign(new EventEmitter(), {
            assertExchange: vi.fn().mockResolvedValue(undefined),
            publish: vi.fn((exchange, key, body, options, confirm) => { confirm(null); return true; }),
            close: vi.fn(async () => transferChannel.emit('close'))
        });
        const transferConnection = Object.assign(new EventEmitter(), {
            createConfirmChannel: vi.fn().mockResolvedValue(transferChannel),
            close: vi.fn().mockResolvedValue(undefined)
        });
        mq.connect.mockImplementation(async (url, options) => options ? transferConnection : connection);
    });

    it('cancels consumers and waits for the in-flight ACK before closing the channel', async () => {
        let complete;
        const handler = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
        channel.consume.mockResolvedValue({ consumerTag: 'test-consumer' });
        channel.cancel = vi.fn().mockResolvedValue(undefined);
        const { consume, drainConsumers, isConsumerReady, closeConnection } = await import('../shared/rabbitmq.js');
        await consume('drain-test', ['test.created'], handler);
        expect(isConsumerReady()).toBe(true);
        const delivery = channel.consume.mock.calls[0][1]({
            content: Buffer.from('{}'), fields: { routingKey: 'test.created' }, properties: {}
        });
        await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
        const draining = drainConsumers();
        expect(isConsumerReady()).toBe(false);
        expect(channel.cancel).toHaveBeenCalledWith('test-consumer');
        expect(channel.ack).not.toHaveBeenCalled();
        expect(channel.close).not.toHaveBeenCalled();
        complete();
        await Promise.all([delivery, draining]);
        expect(channel.ack).toHaveBeenCalledOnce();
        await closeConnection();
        expect(channel.close).toHaveBeenCalledOnce();
    });

    it('shares one connection across concurrent callers and declares the exchange', async () => {
        const { getChannel } = await import('../shared/rabbitmq.js');
        const [a, b] = await Promise.all([getChannel(), getChannel()]);
        expect(a).toBe(channel);
        expect(b).toBe(channel);
        expect(mq.connect).toHaveBeenCalledOnce();
        expect(channel.assertExchange).toHaveBeenNthCalledWith(1, 'jobportal.events', 'topic', { durable: true });
        expect(channel.assertExchange).toHaveBeenNthCalledWith(2, 'jobportal.events.dead-letter', 'direct', { durable: true });
        expect(await getChannel()).toBe(channel);
    });

    it('publishes persistent JSON events with metadata', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1234);
        const { publish } = await import('../shared/rabbitmq.js');
        await publish('job.created', { id: 7 });
        const [exchange, key, body, options] = channel.publish.mock.calls[0];
        expect(exchange).toBe('jobportal.events');
        expect(key).toBe('job.created');
        expect(JSON.parse(body.toString())).toEqual({ id: 7 });
        expect(options).toEqual({ persistent: true, contentType: 'application/json', timestamp: 1234 });
    });

    it('binds every pattern, honors prefetch, and acks successful messages', async () => {
        const handler = vi.fn().mockResolvedValue(undefined);
        const { consume } = await import('../shared/rabbitmq.js');
        await consume('queue', ['job.*', 'ai.result'], handler, { prefetch: 9 });
        expect(channel.assertQueue).toHaveBeenNthCalledWith(1, 'queue.dead-letter', { durable: true });
        expect(channel.bindQueue).toHaveBeenNthCalledWith(1, 'queue.dead-letter', 'jobportal.events.dead-letter', 'queue');
        expect(channel.assertQueue).toHaveBeenCalledWith('queue', { durable: true });
        expect(channel.prefetch).toHaveBeenCalledWith(9);
        expect(channel.bindQueue).toHaveBeenCalledTimes(3);
        const callback = channel.consume.mock.calls[0][1];
        const msg = { content: Buffer.from('{"id":2}'), fields: { routingKey: 'job.created' } };
        await callback(msg);
        expect(handler).toHaveBeenCalledWith({ id: 2 }, 'job.created');
        expect(channel.ack).toHaveBeenCalledWith(msg);
        await callback(null);
        expect(channel.ack).toHaveBeenCalledOnce();
    });

    it('passes envelope metadata to the handler and preserves it through dead-lettering', async () => {
        const { createEventEnvelope, eventProperties } = await import('../shared/eventEnvelope.js');
        const event = createEventEnvelope({
            eventId: 'stable-1', eventType: 'job.created', aggregateId: 12,
            occurredAt: '2026-09-04T01:02:03Z', producer: 'job-core-service', correlationId: 'corr-1', data: { job: { id: 12 } }
        });
        const handler = vi.fn().mockRejectedValue(new Error('db unavailable'));
        const { consume } = await import('../shared/rabbitmq.js');
        await consume('queue', ['#'], handler);
        const msg = { content: Buffer.from(JSON.stringify(event.data)), fields: { routingKey: event.eventType }, properties: eventProperties(event) };
        await channel.consume.mock.calls[0][1](msg);
        const { data, ...metadata } = event;
        expect(handler).toHaveBeenCalledWith(data, event.eventType, metadata);
        expect(transferChannel.publish.mock.calls[0][3]).toMatchObject(eventProperties(event));
        handler.mockClear();
        msg.properties.headers['x-event-version'] = 2;
        await channel.consume.mock.calls[0][1](msg);
        expect(handler).not.toHaveBeenCalled();
        expect(transferChannel.publish.mock.calls[1][3].headers['x-error']).toContain('Unsupported event version');
    });

    it('dead-letters malformed messages and handler failures with diagnostics', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('boom'));
        const { consume } = await import('../shared/rabbitmq.js');
        await consume('queue', ['#'], handler);
        const callback = channel.consume.mock.calls[0][1];
        const malformed = { content: Buffer.from('{'), fields: { routingKey: 'bad.json' }, properties: { headers: { trace: 't' } } };
        const failed = { content: Buffer.from('{}'), fields: { routingKey: 'job.created' }, properties: { contentType: 'application/custom' } };
        await callback(malformed);
        await callback(failed);
        expect(transferChannel.publish).toHaveBeenNthCalledWith(
            1, 'jobportal.events.dead-letter', 'queue', malformed.content,
            expect.objectContaining({
                persistent: true,
                contentType: 'application/json',
                headers: expect.objectContaining({ trace: 't', 'x-original-routing-key': 'bad.json' })
            }), expect.any(Function)
        );
        expect(transferChannel.publish).toHaveBeenNthCalledWith(
            2, 'jobportal.events.dead-letter', 'queue', failed.content,
            expect.objectContaining({
                contentType: 'application/custom',
                headers: expect.objectContaining({ 'x-original-routing-key': 'job.created', 'x-error': 'boom' })
            }), expect.any(Function)
        );
        expect(channel.ack).toHaveBeenNthCalledWith(1, malformed);
        expect(channel.ack).toHaveBeenNthCalledWith(2, failed);
        expect(channel.nack).not.toHaveBeenCalled();
    });

    it('requeues the original only when publishing to the DLQ fails', async () => {
        vi.useFakeTimers();
        const handler = vi.fn();
        const { consume } = await import('../shared/rabbitmq.js');
        await consume('queue', ['#'], handler);
        transferChannel.publish.mockImplementationOnce(() => { throw new Error('channel closed'); });
        const callback = channel.consume.mock.calls[0][1];
        const malformed = { content: Buffer.from('{'), fields: { routingKey: 'bad.json' }, properties: {} };
        const pending = callback(malformed);
        await vi.advanceTimersByTimeAsync(2000);
        await pending;
        expect(channel.nack).toHaveBeenCalledWith(malformed, false, true);
        expect(channel.ack).not.toHaveBeenCalled();
    });

    it('retries connection and closes both resources safely', async () => {
        vi.useFakeTimers();
        mq.connect.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(connection);
        const { getChannel, closeConnection } = await import('../shared/rabbitmq.js');
        const pending = getChannel();
        await vi.advanceTimersByTimeAsync(2000);
        await expect(pending).resolves.toBe(channel);
        expect(mq.connect).toHaveBeenCalledTimes(2);
        await closeConnection();
        expect(channel.close).toHaveBeenCalledOnce();
        expect(connection.close).toHaveBeenCalledOnce();
    });

    it('reconnects and reattaches remembered consumers after a connection closes', async () => {
        vi.useFakeTimers();
        const secondChannel = Object.assign(new EventEmitter(), {
            ...channel,
            assertExchange: vi.fn().mockResolvedValue(undefined),
            assertQueue: vi.fn().mockResolvedValue(undefined),
            prefetch: vi.fn().mockResolvedValue(undefined),
            bindQueue: vi.fn().mockResolvedValue(undefined),
            consume: vi.fn().mockResolvedValue(undefined)
        });
        const secondConnection = {
            on: vi.fn(),
            createChannel: vi.fn().mockResolvedValue(secondChannel),
            close: vi.fn().mockResolvedValue(undefined)
        };
        mq.connect.mockResolvedValueOnce(connection).mockResolvedValueOnce(secondConnection);
        const { consume } = await import('../shared/rabbitmq.js');
        const handler = vi.fn();
        await consume('remembered', ['job.*'], handler, { prefetch: 3 });
        const errorHandler = connection.on.mock.calls.find(([name]) => name === 'error')[1];
        const closeHandler = connection.on.mock.calls.find(([name]) => name === 'close')[1];
        expect(() => errorHandler(new Error('socket'))).not.toThrow();
        closeHandler();
        await vi.advanceTimersByTimeAsync(3000);
        await vi.runAllTimersAsync();
        expect(mq.connect).toHaveBeenCalledTimes(2);
        expect(secondChannel.assertQueue).toHaveBeenCalledWith('remembered', { durable: true });
        expect(secondChannel.consume).toHaveBeenCalledOnce();
    });

    it('suppresses shutdown errors', async () => {
        channel.close.mockRejectedValue(new Error('already closed'));
        const { getChannel, closeConnection } = await import('../shared/rabbitmq.js');
        await getChannel();
        await expect(closeConnection()).resolves.toBeUndefined();
    });
});
