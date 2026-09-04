import { consume } from '../../../shared/rabbitmq.js';
import { createLogger } from '../../../shared/logger.js';
import { recordEvent } from '../controllers/auditController.js';

const logger = createLogger('admin-service.audit');
const TRANSIENT_CODES = new Set([
    6, 7, 50, 64, 89, 91, 112, 189, 262, 9001, 10107, 11600, 11602, 13435, 13436,
    'AUDIT_EVENT_NOT_VISIBLE', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'
]);
const TRANSIENT_NAMES = new Set(['MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoServerSelectionError', 'MongooseServerSelectionError']);

export const auditRetry = Object.freeze({
    delaysMs: Object.freeze([2000, 10000, 30000]),
    shouldRetry: (error, { metadata }) => Boolean(metadata?.eventId && (
        error?.code === undefined ? TRANSIENT_NAMES.has(error?.name) : TRANSIENT_CODES.has(error.code)
    ))
});

export const handleAuditEvent = async (payload, routingKey, metadata) => {
    try {
        return await recordEvent(routingKey, payload, metadata);
    } catch (error) {
        logger.warn('ghi nhat ky that bai; chuyen cho retry/DLQ', {
            routingKey, eventId: metadata?.eventId, error: error.message
        });
        // Never let RabbitMQ ACK a failed write. This queue is independent of
        // Search/Notification: its retry cannot consume their copies of the event.
        throw error;
    }
};

export const startAuditConsumer = async () => {
    await consume('admin-service.audit', ['#'], handleAuditEvent, { prefetch: 50, retry: auditRetry });
};
