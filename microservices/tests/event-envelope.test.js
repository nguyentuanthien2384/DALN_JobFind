import { describe, expect, it } from 'vitest';
import { createEventEnvelope, eventProperties, readEventMessage } from '../shared/eventEnvelope.js';

const input = {
    eventId: 'event-1', eventType: 'application.stage_changed', aggregateId: 31,
    occurredAt: new Date('2026-09-04T01:02:03.456Z'), producer: 'application-service',
    correlationId: 'corr-1', data: { applicationId: '31', toStage: 'phong_van' }
};
const message = () => {
    const envelope = createEventEnvelope(input);
    return { content: Buffer.from(JSON.stringify(envelope.data)), properties: eventProperties(envelope), fields: { routingKey: input.eventType } };
};

describe('event envelope v1 transport contract', () => {
    it('round-trips all metadata without changing the legacy body', () => {
        const { payload, metadata } = readEventMessage(message());
        expect(payload).toEqual(input.data);
        expect(metadata).toEqual({
            eventId: input.eventId, eventType: input.eventType, eventVersion: 1,
            aggregateId: '31', occurredAt: '2026-09-04T01:02:03.456Z',
            producer: input.producer, correlationId: 'corr-1'
        });
        expect(message().properties.timestamp).toBe(Math.floor(input.occurredAt.getTime() / 1000));
    });

    it('accepts old outbox IDs but never invents an identity for a legacy event', () => {
        const msg = { content: Buffer.from('{}'), fields: { routingKey: 'job.created' } };
        expect(readEventMessage(msg)).toEqual({ payload: {}, metadata: undefined });
        msg.properties = { messageId: 'old-outbox-id' };
        expect(readEventMessage(msg).metadata.eventId).toBe('old-outbox-id');
    });

    it.each([
        ['eventId', 'bad id'], ['aggregateId', undefined], ['occurredAt', 'invalid'],
        ['producer', ''], ['data', []], ['correlationId', 'x'.repeat(256)]
    ])('rejects invalid %s', (key, value) => {
        expect(() => createEventEnvelope({ ...input, [key]: value })).toThrow();
    });

    it('rejects unsupported versions and routing mismatches', () => {
        const msg = message();
        msg.properties.headers['x-event-version'] = 2;
        expect(() => readEventMessage(msg)).toThrow('Unsupported event version');
        msg.properties.headers['x-event-version'] = 1;
        msg.fields.routingKey = 'job.created';
        expect(() => readEventMessage(msg)).toThrow('does not match');
    });
});
