import { EXCHANGE } from './events.js';
import { createPublisherConnection } from './confirmedConnection.js';

export const DEAD_LETTER_EXCHANGE = `${EXCHANGE}.dead-letter`;
const connection = createPublisherConnection(async (channel) => {
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
});

// Republish raw bytes, not reserialized JSON: malformed events must remain inspectable.
// Do not forward expiration/userId: expiration could delete a DLQ entry and userId
// is validated against the publisher's RabbitMQ account (not the original sender).
export const transferMessage = async ({ queueName, msg, routingKey, error, retryCount }) => {
    const retrying = retryCount !== undefined;
    const original = msg.properties || {};
    const properties = { persistent: true, contentType: original.contentType || 'application/json' };
    for (const key of ['contentEncoding', 'messageId', 'correlationId', 'type', 'appId', 'timestamp']) {
        if (original[key] !== undefined) properties[key] = original[key];
    }
    properties.timestamp ??= Math.floor(Date.now() / 1000);
    properties.headers = {
        ...original.headers,
        'x-original-routing-key': routingKey,
        'x-failed-queue': queueName,
        'x-error': String(error?.message || error || 'unknown').slice(0, 500),
        'x-failed-at': new Date().toISOString()
    };
    if (retrying) {
        properties.headers['x-retry-count'] = retryCount;
        properties.headers['x-retry-queue'] = queueName;
    }
    // Default exchange targets ONLY this queue, not every subscriber to the original event.
    await connection.publish(retrying ? '' : DEAD_LETTER_EXCHANGE, queueName, msg.content, properties);
};

export const closeTransferPublisher = () => connection.close();
