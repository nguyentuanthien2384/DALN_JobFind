import { readEventMessage } from './eventEnvelope.js';
import { transferMessage } from './messageTransfer.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message, error) => console.log(`[rabbitmq] ${message}`, error?.message || '');

export const validateRetryPolicy = (retry) => {
    if (!retry) return undefined;
    if (!Array.isArray(retry.delaysMs) || retry.delaysMs.length > 5 ||
        retry.delaysMs.some((ms) => !Number.isInteger(ms) || ms < 1000 || ms > 60000) ||
        typeof retry.shouldRetry !== 'function') throw new Error('Invalid consumer retry policy');
    return { delaysMs: [...retry.delaysMs], shouldRetry: retry.shouldRetry };
};

// Default-exchange retries retain the business routing key in a header, because
// the wire routing key is now the queue name. Never let a header override a
// normally published event's routing key (including envelope validation).
const deliveryRouting = (msg, queueName) => {
    const headers = msg.properties?.headers || {};
    let routingKey = msg.fields.routingKey;
    const count = headers['x-retry-count'] ?? 0;
    if (!Number.isInteger(count) || count < 0 || count > 5) throw new Error('Invalid retry count');
    if (msg.fields.exchange === '' && routingKey === queueName && headers['x-retry-queue'] === queueName) {
        const original = headers['x-original-routing-key'];
        if (typeof original !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(original) || count < 1) {
            throw new Error('Invalid retry routing metadata');
        }
        routingKey = original;
    }
    return { routingKey, count };
};

export const createDeliveryHandler = ({ channel, queueName, handler, retry, isActive }) => {
    // ACK failures are not handler failures. Do not send an already-processed
    // event to the DLQ; close its source channel so RabbitMQ can redeliver it.
    const settle = async (method, msg) => {
        if (!isActive()) return;
        try {
            if (method === 'ack') channel.ack(msg);
            else channel.nack(msg, false, true);
        } catch (error) {
            log(`khong ${method} duoc tin; cho broker giao lai`, error);
            try { await channel.close(); } catch { /* Already disconnected. */ }
        }
    };
    const transfer = async (msg, routingKey, error, retryCount) => {
        if (!isActive()) return;
        try {
            await transferMessage({ queueName, msg, routingKey, error, retryCount });
        } catch (publishError) {
            log('chua xac nhan duoc chuyen tin; giu ban goc de thu lai', publishError);
            // Bound infrastructure retry rate; never discard the only known copy.
            if (isActive()) await wait(2000);
            await settle('nack', msg);
            return;
        }
        await settle('ack', msg);
    };
    return async (msg) => {
        if (!msg || !isActive()) return;
        let context;
        let routingKey = msg.fields?.routingKey || 'unknown';
        try {
            const routing = deliveryRouting(msg, queueName);
            routingKey = routing.routingKey;
            context = {
                ...readEventMessage({ ...msg, fields: { ...msg.fields, routingKey } }),
                ...routing
            };
        } catch (error) {
            await transfer(msg, routingKey, error);
            return;
        }
        const { payload, metadata, count } = context;
        try {
            if (metadata) await handler(payload, routingKey, metadata);
            else await handler(payload, routingKey);
        } catch (error) {
            log(`xu ly ${routingKey} that bai`, error);
            let retryable = false;
            if (metadata?.eventId && retry && count < retry.delaysMs.length) {
                try { retryable = await retry.shouldRetry(error, context) === true; }
                catch (policyError) { log('khong danh gia duoc chinh sach retry', policyError); }
            }
            if (retryable) {
                // Original remains unacknowledged in RabbitMQ while waiting. No
                // classic TTL/DLX hop (which can lose messages) is introduced.
                await wait(retry.delaysMs[count]);
                await transfer(msg, routingKey, error, count + 1);
            } else {
                await transfer(msg, routingKey, error);
            }
            return;
        }
        await settle('ack', msg);
    };
};
