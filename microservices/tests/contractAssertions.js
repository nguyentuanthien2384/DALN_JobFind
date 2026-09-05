import { expect } from 'vitest';
import { createContractValidator } from '../shared/requestContract.js';
import { operationById } from '../shared/contracts/operations.js';
import { responseValidationSchema } from '../shared/contracts/responses.js';
import { eventCatalog, eventExamples } from '../shared/contracts/eventCatalog.js';
import { serializeEventPayload } from '../shared/eventContract.js';
import { createEventEnvelope, eventProperties, readEventMessage } from '../shared/eventEnvelope.js';

// Drive real consumer handlers through the same wire boundary as RabbitMQ.
export const decodeEventFixture = (key, data = eventExamples[key]) => {
    const { payload, aggregateId, json } = serializeEventPayload(key, data);
    const event = createEventEnvelope({ eventId: 'contract-event-1', eventType: key, aggregateId,
        occurredAt: '2026-09-05T00:00:00.000Z', producer: eventCatalog[key].producers[0], payloadVersion: 1, data: payload });
    return readEventMessage({ content: Buffer.from(json), properties: eventProperties(event), fields: { routingKey: key } });
};

const validators = new Map();
export const expectResponseContract = (id, res) => {
    const operation = operationById[id];
    if (!validators.has(id)) validators.set(id, createContractValidator().compile(responseValidationSchema(operation)));
    const validate = validators.get(id);
    // Test the actual JSON wire shape: Dates/ObjectIds are serialized by Express.
    const valid = validate(JSON.parse(JSON.stringify(res.body)));
    expect(res.statusCode).toBe(operation.status);
    expect(valid, `${id}: ${JSON.stringify(validate.errors)}`).toBe(true);
};
