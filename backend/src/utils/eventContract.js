import { randomUUID } from 'node:crypto';
import catalog from '../contracts/events.v1.json';
import createValidator from '../contracts/eventValidator.cjs';

export const { serializeEventPayload } = createValidator(catalog.events);
export const prepareDomainEvent = (eventType, data) => {
    const { json, aggregateId } = serializeEventPayload(eventType, data);
    const occurredAt = new Date().toISOString();
    return { body: Buffer.from(json), properties: {
        persistent: true, contentType: 'application/json', messageId: randomUUID(), type: eventType,
        appId: 'legacy-backend', timestamp: Math.floor(new Date(occurredAt).getTime() / 1000),
        headers: { 'x-event-version': 1, 'x-payload-version': 1, 'x-aggregate-id': aggregateId, 'x-occurred-at': occurredAt }
    } };
};
