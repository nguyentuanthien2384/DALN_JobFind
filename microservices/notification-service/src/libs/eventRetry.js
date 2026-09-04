const TRANSIENT_DATABASE_ERRORS = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN',
    'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_CON_COUNT_ERROR',
    'ER_TOO_MANY_USER_CONNECTIONS'
]);

// Safe only for events handled via the durable inbox. No SMTP call takes place
// inside that consumer transaction; invalid data/auth/schema errors are not transient.
export const notificationRetry = Object.freeze({
    delaysMs: Object.freeze([2000, 10000, 30000]),
    shouldRetry: (error, { metadata }) => Boolean(metadata?.eventId && TRANSIENT_DATABASE_ERRORS.has(error?.code))
});
