import { EXCHANGE } from './events.js';
import { createPublisherConnection } from './confirmedConnection.js';
import { createEventEnvelope, eventProperties } from './eventEnvelope.js';
import { serializeEventPayload } from './eventContract.js';

// Independent bounded connection; retries remain the outbox relay's responsibility.
const connection = createPublisherConnection(async (channel) => {
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
});

export const publishOutboxEvent = async (routingKey, payload, { messageId, correlationId, aggregateId, occurredAt, producer, payloadVersion = 1 } = {}) => {
    if (!messageId) throw new Error('Outbox publish requires a stable messageId');
    // v1 is a frozen default for existing outbox rows (which have no version
    // column). Never change this default to v2; persist versions before that rollout.
    // Only pre-contract AI executions/saved results may explicitly use null.
    if (payloadVersion === null && (producer !== 'ai-worker' || routingKey !== 'ai.result')) {
        throw new Error('Legacy payload replay is only supported for AI results');
    }
    const data = payloadVersion === null ? payload : serializeEventPayload(routingKey, payload, { version: payloadVersion, aggregateId }).payload;
    const event = createEventEnvelope({ eventId: messageId, eventType: routingKey, data, correlationId, aggregateId, occurredAt, producer,
        ...(payloadVersion !== null && { payloadVersion }) });
    const body = Buffer.from(JSON.stringify(event.data));
    await connection.publish(EXCHANGE, routingKey, body, {
        persistent: true,
        contentType: 'application/json',
        ...eventProperties(event)
    });
};

export const closeOutboxPublisher = () => connection.close();
