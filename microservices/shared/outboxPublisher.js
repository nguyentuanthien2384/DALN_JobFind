import { EXCHANGE } from './events.js';
import { createPublisherConnection } from './confirmedConnection.js';
import { createEventEnvelope, eventProperties } from './eventEnvelope.js';

// Independent bounded connection; retries remain the outbox relay's responsibility.
const connection = createPublisherConnection(async (channel) => {
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
});

export const publishOutboxEvent = async (routingKey, payload, { messageId, correlationId, aggregateId, occurredAt, producer } = {}) => {
    if (!messageId) throw new Error('Outbox publish requires a stable messageId');
    const event = createEventEnvelope({ eventId: messageId, eventType: routingKey, data: payload, correlationId, aggregateId, occurredAt, producer });
    const body = Buffer.from(JSON.stringify(event.data));
    await connection.publish(EXCHANGE, routingKey, body, {
        persistent: true,
        contentType: 'application/json',
        ...eventProperties(event)
    });
};

export const closeOutboxPublisher = () => connection.close();
