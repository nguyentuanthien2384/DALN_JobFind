import amqplib from 'amqplib';
import { requireEnvironment } from './securityConfig.js';
import { createConfirmedPublisher } from './confirmedPublisher.js';

// Each owner gets a separate connection. A transfer timeout must not close a
// consumer channel carrying unacknowledged messages, or an unrelated outbox.
export const createPublisherConnection = (initialize = async () => {}) => {
    const timeoutMs = 10_000;
    let current = null;
    let connecting = null;
    let openingAttempt = null;
    const closeQuietly = (resource) => {
        if (resource) Promise.resolve().then(() => resource.close()).catch(() => {});
    };
    const getPublisher = async () => {
        if (current && !current.closed) return current;
        if (connecting) return connecting;
        const attempt = { connection: null, closed: false, publish: null };
        openingAttempt = attempt;
        const dispose = () => {
            if (current === attempt) current = null;
            if (attempt.closed) return;
            attempt.closed = true;
            closeQuietly(attempt.connection);
        };
        attempt.dispose = dispose;
        const work = (async () => {
            const conn = await amqplib.connect(requireEnvironment('RABBITMQ_URL'), { timeout: timeoutMs });
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
            attempt.publish = createConfirmedPublisher(channel);
            channel.on('close', dispose);
            if (attempt.closed) throw new Error('RabbitMQ publisher connection cancelled');
            await initialize(channel);
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
                }, timeoutMs);
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
    return {
        async publish(exchange, routingKey, body, properties) {
            const publisher = await getPublisher();
            await publisher.publish(exchange, routingKey, body, properties);
        },
        close() {
            current?.dispose();
            openingAttempt?.dispose();
        }
    };
};
