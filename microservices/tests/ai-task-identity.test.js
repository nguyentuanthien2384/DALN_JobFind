import { describe, expect, it } from 'vitest';
import { fingerprint, taskIdentity } from '../ai-worker/src/libs/taskIdentity.js';

describe('AI execution identity', () => {
    it('uses immutable event identity, not job ID or content, for moderation', () => {
        const first = taskIdentity({ jobId: 7, name: 'a' }, 'ai.moderate_job', { eventId: 'event-1', aggregateId: '7', correlationId: 'corr' });
        expect(first).toMatchObject({ key: 'event:event-1', aggregateId: '7', correlationId: 'corr' });
        expect(first.resultEventId).toMatch(/^ai-result:[a-f0-9]{64}$/);
        expect(taskIdentity({ jobId: 7, name: 'a' }, 'ai.moderate_job', { eventId: 'event-2' }).key).not.toBe(first.key);
        const changed = taskIdentity({ jobId: 7, name: 'b' }, 'ai.moderate_job', { eventId: 'event-1' });
        expect(changed.key).toBe(first.key);
        expect(changed.fingerprint).not.toBe(first.fingerprint);
    });
    it.each(['ai.parse_resume', 'ai.match_cv', 'ai.cover_letter'])('can identify legacy %s by its stable taskId', (routingKey) => {
        const value = taskIdentity({ taskId: 'task-1', fileBase64: 'private' }, routingKey);
        expect(value.key).toBe(`task:${routingKey}:task-1`);
        expect(value.aggregateId).toBe('task-1');
        expect(JSON.stringify(value)).not.toContain('private');
    });
    it('never invents a deduplication key for legacy moderation', () => {
        expect(taskIdentity({ jobId: 7 }, 'ai.moderate_job').key).toBeNull();
    });
    it('normalizes object ordering without confusing distinct arrays/objects', () => {
        expect(fingerprint({ z: [1, { b: 2, a: 3 }], a: null })).toBe(fingerprint({ a: null, z: [1, { a: 3, b: 2 }] }));
        expect(fingerprint({ a: 1 })).not.toBe(fingerprint([['a', 1]]));
        expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
    });
    it('rejects malformed identities, payloads and aggregate mismatches', () => {
        for (const payload of [null, [], 'bad']) expect(() => taskIdentity(payload, 'ai.parse_resume')).toThrow('payload');
        for (const jobId of [0, -1, '01', '7/8', 1.5]) expect(() => taskIdentity({ jobId }, 'ai.moderate_job')).toThrow('jobId');
        expect(() => taskIdentity({}, 'ai.parse_resume')).toThrow('taskId');
        expect(() => taskIdentity({ jobId: 7 }, 'ai.moderate_job', { eventId: '' })).toThrow('eventId');
        expect(() => taskIdentity({ jobId: 7 }, 'ai.moderate_job', { aggregateId: '8' })).toThrow('mismatch');
        expect(() => taskIdentity({ jobId: 7 }, 'ai.moderate_job', { correlationId: 3 })).toThrow('correlationId');
    });
});
