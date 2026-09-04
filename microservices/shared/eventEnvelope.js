const identifier = (value, name) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) {
        throw new Error(`Invalid event ${name}`);
    }
    return value;
};

// Envelope logic doc lap transport. AMQP mang metadata trong properties/headers
// de cac consumer cu van doc duoc body JSON nghiep vu trong luc nang cap.
export const createEventEnvelope = ({ eventId, eventType, aggregateId, occurredAt, producer, correlationId = null, data }) => {
    if (aggregateId === undefined || aggregateId === null) throw new Error('Missing event aggregateId');
    if (!occurredAt || !Number.isFinite(new Date(occurredAt).getTime())) throw new Error('Invalid event occurredAt');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid event data');
    if (correlationId !== null && (typeof correlationId !== 'string' || correlationId.length > 255)) {
        throw new Error('Invalid event correlationId');
    }
    return {
        eventId: identifier(eventId, 'eventId'),
        eventType: identifier(eventType, 'eventType'),
        eventVersion: 1,
        aggregateId: identifier(String(aggregateId), 'aggregateId'),
        occurredAt: new Date(occurredAt).toISOString(),
        producer: identifier(producer, 'producer'),
        correlationId,
        data
    };
};

export const eventProperties = (event) => ({
    messageId: event.eventId,
    type: event.eventType,
    appId: event.producer,
    timestamp: Math.floor(new Date(event.occurredAt).getTime() / 1000),
    ...(event.correlationId ? { correlationId: event.correlationId } : {}),
    headers: {
        'x-event-version': event.eventVersion,
        'x-aggregate-id': event.aggregateId,
        'x-occurred-at': event.occurredAt
    }
});

export const readEventMessage = (msg) => {
    const payload = JSON.parse(msg.content.toString());
    const properties = msg.properties || {};
    const version = properties.headers?.['x-event-version'];
    if (version === undefined) {
        // Khong tao ID moi luc consume: no se vo hieu hoa dedup khi redelivery.
        const metadata = properties.messageId ? {
            eventId: identifier(properties.messageId, 'messageId'),
            eventType: msg.fields.routingKey,
            correlationId: properties.correlationId || null
        } : undefined;
        return { payload, metadata };
    }
    if (version !== 1) throw new Error(`Unsupported event version: ${version}`);
    if (properties.type !== msg.fields.routingKey) throw new Error('Event type does not match routing key');
    const { data, ...metadata } = createEventEnvelope({
        eventId: properties.messageId,
        eventType: properties.type,
        producer: properties.appId,
        aggregateId: properties.headers['x-aggregate-id'],
        occurredAt: properties.headers['x-occurred-at'],
        correlationId: properties.correlationId || null,
        data: payload
    });
    return { payload: data, metadata };
};
