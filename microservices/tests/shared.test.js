import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mq = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('amqplib', () => ({ default: { connect: mq.connect } }));

afterEach(() => {
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

    beforeEach(() => {
        vi.resetModules();
        mq.connect.mockReset();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        channel = {
            assertExchange: vi.fn().mockResolvedValue(undefined),
            assertQueue: vi.fn().mockResolvedValue(undefined),
            prefetch: vi.fn().mockResolvedValue(undefined),
            bindQueue: vi.fn().mockResolvedValue(undefined),
            consume: vi.fn().mockResolvedValue(undefined),
            publish: vi.fn(),
            ack: vi.fn(),
            nack: vi.fn(),
            close: vi.fn().mockResolvedValue(undefined)
        };
        connection = {
            on: vi.fn(),
            createChannel: vi.fn().mockResolvedValue(channel),
            close: vi.fn().mockResolvedValue(undefined)
        };
        mq.connect.mockResolvedValue(connection);
    });

    it('shares one connection across concurrent callers and declares the exchange', async () => {
        const { getChannel } = await import('../shared/rabbitmq.js');
        const [a, b] = await Promise.all([getChannel(), getChannel()]);
        expect(a).toBe(channel);
        expect(b).toBe(channel);
        expect(mq.connect).toHaveBeenCalledOnce();
        expect(channel.assertExchange).toHaveBeenCalledWith('jobportal.events', 'topic', { durable: true });
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
        expect(channel.assertQueue).toHaveBeenCalledWith('queue', { durable: true });
        expect(channel.prefetch).toHaveBeenCalledWith(9);
        expect(channel.bindQueue).toHaveBeenCalledTimes(2);
        const callback = channel.consume.mock.calls[0][1];
        const msg = { content: Buffer.from('{"id":2}'), fields: { routingKey: 'job.created' } };
        await callback(msg);
        expect(handler).toHaveBeenCalledWith({ id: 2 }, 'job.created');
        expect(channel.ack).toHaveBeenCalledWith(msg);
        await callback(null);
        expect(channel.ack).toHaveBeenCalledOnce();
    });

    it('dead-letters malformed messages and handler failures', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('boom'));
        const { consume } = await import('../shared/rabbitmq.js');
        await consume('queue', ['#'], handler);
        const callback = channel.consume.mock.calls[0][1];
        const malformed = { content: Buffer.from('{'), fields: { routingKey: 'x' } };
        const failed = { content: Buffer.from('{}'), fields: { routingKey: 'x' } };
        await callback(malformed);
        await callback(failed);
        expect(channel.nack).toHaveBeenNthCalledWith(1, malformed, false, false);
        expect(channel.nack).toHaveBeenNthCalledWith(2, failed, false, false);
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
        const secondChannel = {
            ...channel,
            assertExchange: vi.fn().mockResolvedValue(undefined),
            assertQueue: vi.fn().mockResolvedValue(undefined),
            prefetch: vi.fn().mockResolvedValue(undefined),
            bindQueue: vi.fn().mockResolvedValue(undefined),
            consume: vi.fn().mockResolvedValue(undefined)
        };
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
