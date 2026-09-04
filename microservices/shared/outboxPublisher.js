import amqplib from 'amqplib';
import { EXCHANGE } from './events.js';
import { requireEnvironment } from './securityConfig.js';
import { createConfirmedPublisher } from './confirmedPublisher.js';
import { createEventEnvelope, eventProperties } from './eventEnvelope.js';

// Kenh rieng cho outbox: connect/confirm co gioi han thoi gian. Retry do relay
// quyet dinh, khong de transaction PostgreSQL cho ket noi vo han.
const CONNECT_TIMEOUT_MS = 10_000;
let current = null;
let connecting = null;
let openingAttempt = null;

const closeQuietly = (resource) => {
    if (resource) Promise.resolve().then(() => resource.close()).catch(() => {});
};

const getPublisher = async () => {
    if (current && !current.closed) return current;
    if (connecting) return connecting;

    const attempt = { connection: null, channel: null, closed: false, publish: null };
    openingAttempt = attempt;
    const dispose = () => {
        if (current === attempt) current = null;
        if (attempt.closed) return;
        attempt.closed = true;
        closeQuietly(attempt.connection);
    };
    attempt.dispose = dispose;

    const work = (async () => {
        const conn = await amqplib.connect(requireEnvironment('RABBITMQ_URL'), { timeout: CONNECT_TIMEOUT_MS });
        attempt.connection = conn;
        conn.on('error', dispose);
        conn.on('close', () => {
            attempt.closed = true;
            if (current === attempt) current = null;
        });
        if (attempt.closed) {
            closeQuietly(conn);
            throw new Error('RabbitMQ publisher connection cancelled');
        }
        const channel = await conn.createConfirmChannel();
        attempt.channel = channel;
        attempt.publish = createConfirmedPublisher(channel);
        channel.on('close', dispose);
        if (attempt.closed) throw new Error('RabbitMQ publisher connection cancelled');
        await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
        if (attempt.closed) throw new Error('RabbitMQ publisher connection closed');
        current = attempt;
        return attempt;
    })();

    let timer;
    const opening = Promise.race([
        work,
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                dispose();
                reject(new Error('RabbitMQ publisher connection timeout'));
            }, CONNECT_TIMEOUT_MS);
        })
    ]).catch((error) => {
        dispose();
        throw error;
    }).finally(() => {
        clearTimeout(timer);
        if (connecting === opening) connecting = null;
        if (openingAttempt === attempt) openingAttempt = null;
    });
    connecting = opening;
    return opening;
};

export const publishOutboxEvent = async (routingKey, payload, { messageId, correlationId, aggregateId, occurredAt, producer } = {}) => {
    if (!messageId) throw new Error('Outbox publish requires a stable messageId');
    const event = createEventEnvelope({ eventId: messageId, eventType: routingKey, data: payload, correlationId, aggregateId, occurredAt, producer });
    const body = Buffer.from(JSON.stringify(event.data));
    const publisher = await getPublisher();
    await publisher.publish(EXCHANGE, routingKey, body, {
        persistent: true,
        contentType: 'application/json',
        ...eventProperties(event)
    });
};

export const closeOutboxPublisher = () => {
    current?.dispose();
    openingAttempt?.dispose();
};
