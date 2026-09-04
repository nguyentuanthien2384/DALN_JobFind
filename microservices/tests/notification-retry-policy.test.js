import { describe, expect, it } from 'vitest';
import { notificationRetry } from '../notification-service/src/libs/eventRetry.js';
import { validateRetryPolicy } from '../shared/consumeDelivery.js';

describe('notification retry allowlist', () => {
    it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'])('retries transient %s only with an inbox identity', (code) => {
        expect(notificationRetry.shouldRetry({ code }, { metadata: { eventId: 'e1' } })).toBe(true);
        expect(notificationRetry.shouldRetry({ code }, {})).toBe(false);
    });

    it.each(['ER_NO_SUCH_TABLE', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_FIELD_ERROR', 'ER_DUP_ENTRY', 'EINVAL', undefined])('does not retry permanent/unknown %s', (code) => {
        expect(notificationRetry.shouldRetry({ code }, { metadata: { eventId: 'e1' } })).toBe(false);
    });

    it('copies a bounded retry schedule and rejects unsafe configuration', () => {
        const retry = validateRetryPolicy(notificationRetry);
        expect(retry.delaysMs).toEqual([2000, 10000, 30000]);
        expect(retry.delaysMs).not.toBe(notificationRetry.delaysMs);
        for (const delaysMs of [[0], [60001], [NaN], Array(6).fill(1000)]) {
            expect(() => validateRetryPolicy({ delaysMs, shouldRetry: () => true })).toThrow('Invalid consumer retry policy');
        }
        expect(() => validateRetryPolicy({ delaysMs: [1000] })).toThrow('Invalid consumer retry policy');
        expect(validateRetryPolicy()).toBeUndefined();
    });
});
