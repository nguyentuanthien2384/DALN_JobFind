import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../shared/events.js';
import { eventCatalog, eventExamples } from '../shared/contracts/eventCatalog.js';
import { assertEventPayload, serializeEventPayload } from '../shared/eventContract.js';
import { createEventEnvelope, eventProperties, readEventMessage } from '../shared/eventEnvelope.js';
import createStandaloneValidator from '../shared/contracts/eventValidator.cjs';
import { createTaskProcessor } from '../ai-worker/src/libs/taskProcessor.js';

const envelope = (key, data = eventExamples[key]) => createEventEnvelope({
    eventId: 'event-1', eventType: key, aggregateId: assertEventPayload(key, data),
    occurredAt: '2026-09-05T01:02:03.456Z', producer: eventCatalog[key].producers[0],
    correlationId: 'test-correlation', payloadVersion: 1, data
});
const message = (key, data) => {
    const event = envelope(key, data);
    return { fields: { exchange: 'jobportal.events', routingKey: key }, content: Buffer.from(JSON.stringify(event.data)), properties: eventProperties(event) };
};

describe('frozen payload v1 contracts', () => {
    it('covers all and only the current domain event names', () => {
        expect(Object.keys(eventCatalog).sort()).toEqual(Object.values(EVENTS).sort());
        expect(Object.keys(eventExamples).sort()).toEqual(Object.keys(eventCatalog).sort());
    });
    it.each(Object.keys(eventCatalog))('%s round-trips the payload and identity, tolerating additive fields', (key) => {
        const data = { ...eventExamples[key], futureField: { optional: true } };
        const before = JSON.stringify(data);
        const decoded = readEventMessage(message(key, data));
        expect(decoded.payload).toEqual(data);
        expect(JSON.stringify(data)).toBe(before);
        expect(decoded.metadata).toMatchObject({ eventId: 'event-1', payloadVersion: 1, eventVersion: 1 });
        expect(() => assertEventPayload(key, data, { aggregateId: 'wrong-aggregate' })).toThrow('EVENT_AGGREGATE_MISMATCH');
    });
    it.each([
        ['job.created', { job: { id: 1 } }],
        ['job.created', { ...eventExamples['job.created'], notificationPolicy: 'unknown' }],
        ['ai.moderate_job', { ...eventExamples['ai.moderate_job'], notificationPolicy: null }],
        ['notification.job_approved_requested', { ...eventExamples['notification.job_approved_requested'], decisionId: 'invalid' }],
        ['notification.job_approved_requested', { ...eventExamples['notification.job_approved_requested'], recipientId: 0 }],
        ['job.updated', { job: { id: '9007199254740992', name: 'X', statusCode: 'PS1' } }],
        ['job.deleted', { jobId: [1] }], ['company.updated', { companyId: { $ne: null } }],
        ['job.moderated', { jobId: 7, approved: 'false', statusCode: 'PS2' }],
        ['job.moderated', { jobId: 7, approved: true, statusCode: 'PS2' }],
        ['ai.moderate_job', { ...eventExamples['ai.moderate_job'], moderationRequestId: null }],
        ['ai.moderate_job', { ...eventExamples['ai.moderate_job'], taskId: 'unrelated-task' }],
        ...['ai.parse_resume', 'ai.match_cv', 'ai.cover_letter'].map((key) => [key, { ...eventExamples[key], jobId: {} }]),
        ['ai.parse_resume', { taskId: 'task-1', fileBase64: {} }],
        ['ai.parse_resume', { taskId: 'task-1', fileBase64: '   ' }],
        ['ai.match_cv', { taskId: 'task-1', resumeText: 'CV' }],
        ['ai.cover_letter', { ...eventExamples['ai.cover_letter'], language: {} }],
        ['ai.result', { ...eventExamples['ai.result'], result: { score: 101 } }],
        ['ai.result', { ...eventExamples['ai.result'], result: { score: '90' } }],
        ['ai.result', { taskId: 'task-1', type: 'cover_letter', ok: true, result: [] }],
        ['ai.result', { taskId: 'task-1', type: 'cover_letter', ok: false, error: 'failed', result: { letter: 'Contradiction' } }],
        ['ai.result', { taskId: 'task-1', type: 'parse_resume', ok: true, result: { fullName: 'Name', skills: [5] } }],
        ['ai.result', { jobId: 7, type: 'moderate_job', ok: true, result: { approved: true } }],
        ['application.stage_changed', { ...eventExamples['application.stage_changed'], toStage: 'interview' }],
        ['application.decision_email_requested', { ...eventExamples['application.decision_email_requested'], decision: 'rejected' }],
        ['application.submitted', { ...eventExamples['application.submitted'], appliedAt: 'invalid-date' }]
    ])('%s rejects malformed domain data without copying private values into errors', (key, data) => {
        expect(() => assertEventPayload(key, data)).toThrow('EVENT_PAYLOAD_INVALID');
        try { assertEventPayload(key, { ...data, privateCv: 'PRIVATE_SENTINEL' }); } catch (error) {
            expect(error.message).toBe('EVENT_PAYLOAD_INVALID');
            expect(JSON.stringify(error)).not.toContain('PRIVATE_SENTINEL');
        }
    });
    it('bounds serialized UTF-8 bytes, not merely string length', () => {
        const data = { taskId: 'task-1', type: 'cover_letter', ok: true, result: { letter: 'ắ'.repeat(400000) } };
        expect(() => assertEventPayload('ai.result', data)).toThrow('EVENT_PAYLOAD_TOO_LARGE');
    });
    it('serializes Date and undefined exactly as the wire, and safely rejects cycles', () => {
        const data = { ...eventExamples['application.submitted'], appliedAt: new Date('2026-09-05T00:00:00Z'), unused: undefined };
        const result = serializeEventPayload('application.submitted', data);
        expect(result.payload.appliedAt).toBe('2026-09-05T00:00:00.000Z');
        expect(result.payload).not.toHaveProperty('unused');
        expect(data.appliedAt).toBeInstanceOf(Date);
        const cycle = {}; cycle.self = cycle;
        expect(() => serializeEventPayload('job.created', cycle)).toThrow('EVENT_PAYLOAD_INVALID');
    });
    it.each([0, 2, '1', null, {}, []])('does not silently downgrade unsupported payload version %j', (version) => {
        const msg = message('job.deleted');
        msg.properties.headers['x-payload-version'] = version;
        expect(() => readEventMessage(msg)).toThrow('EVENT_PAYLOAD_VERSION_UNSUPPORTED');
    });
    it('rejects marked messages without envelope identity or with an unknown routing type', () => {
        const msg = message('job.deleted');
        delete msg.properties.headers['x-event-version'];
        expect(() => readEventMessage(msg)).toThrow('requires event envelope');
        const unknown = message('job.deleted');
        unknown.properties.type = unknown.fields.routingKey = 'new.unknown';
        expect(() => readEventMessage(unknown)).toThrow('EVENT_TYPE_UNSUPPORTED');
        unknown.properties.type = 'job.deleted';
        expect(() => readEventMessage(unknown)).toThrow('does not match');
    });
    it('never includes raw malformed JSON or an unknown envelope version in error text', () => {
        const msg = message('job.deleted');
        msg.properties.headers['x-event-version'] = 'PRIVATE_SENTINEL';
        expect(() => readEventMessage(msg)).toThrow(/^Unsupported event version$/);
        msg.content = Buffer.from('PRIVATE_SENTINEL invalid JSON');
        expect(() => readEventMessage(msg)).toThrow(/^EVENT_JSON_INVALID$/);
    });
    it('preserves old unmarked envelopes and legacy messages without inventing an ID', () => {
        const msg = message('job.deleted');
        delete msg.properties.headers['x-payload-version'];
        msg.content = Buffer.from('{"legacy":true}');
        expect(readEventMessage(msg)).toMatchObject({ payload: { legacy: true }, metadata: { eventId: 'event-1' } });
        expect(readEventMessage(msg).metadata).not.toHaveProperty('payloadVersion');
        msg.properties = {};
        expect(readEventMessage(msg)).toEqual({ payload: { legacy: true }, metadata: undefined });
    });
    it('shares byte-identical generated schemas and validator with the standalone backend', async () => {
        const stored = JSON.parse(await readFile(new URL('../contracts/events/catalog.v1.json', import.meta.url), 'utf8'));
        const backend = JSON.parse(await readFile(new URL('../../backend/src/contracts/events.v1.json', import.meta.url), 'utf8'));
        expect(stored.events).toEqual(eventCatalog);
        expect(backend).toEqual(stored);
        const code = await readFile(new URL('../shared/contracts/eventValidator.cjs', import.meta.url), 'utf8');
        expect((await readFile(new URL('../../backend/src/contracts/eventValidator.cjs', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')).toBe(code.replaceAll('\r\n', '\n'));
        const standalone = createStandaloneValidator(backend.events);
        for (const key of Object.keys(eventCatalog)) {
            expect(standalone.serializeEventPayload(key, eventExamples[key])).toEqual(serializeEventPayload(key, eventExamples[key]));
            const schema = JSON.parse(await readFile(new URL(`../contracts/events/${key}.payload.v1.schema.json`, import.meta.url), 'utf8'));
            const { title, examples, ...definition } = schema;
            expect(definition).toEqual(eventCatalog[key].schema);
            expect(examples).toEqual([eventExamples[key]]);
        }
    });
});

describe('typed AI execution result boundaries', () => {
    const fixture = (result) => {
        let record;
        const store = {
            claim: vi.fn(async (identity) => {
                if (record) return { acquired: false, record };
                record = { ...identity, state: 'started' };
                return { acquired: true, record };
            }),
            complete: vi.fn(async (_, output) => { record.state = 'ready'; record.output = output; }),
            markPublished: vi.fn(async () => { record.state = 'published'; })
        };
        const run = vi.fn().mockResolvedValue(result);
        const publishResult = vi.fn().mockResolvedValue(undefined);
        const process = createTaskProcessor({ handlers: { 'ai.match_cv': { type: 'match_cv', run } }, store, publishResult, isConfigured: () => true });
        const msg = readEventMessage(message('ai.match_cv'));
        const invoke = () => process(msg.payload, 'ai.match_cv', msg.metadata);
        return { store, run, publishResult, invoke };
    };
    it.each([{ score: 101 }, { score: '90' }, null, [], { unrelated: 'private model result' }])('persists invalid model output %j as one failed result, with no repeat call', async (result) => {
        const f = fixture(result);
        await f.invoke();
        await f.invoke();
        expect(f.run).toHaveBeenCalledOnce();
        const output = f.store.complete.mock.calls[0][1];
        expect(output).toMatchObject({ payloadVersion: 1, data: { ok: false, error: 'EVENT_PAYLOAD_INVALID' } });
        expect(output.data).not.toHaveProperty('result');
        expect(() => assertEventPayload('ai.result', output.data)).not.toThrow();
    });
    it('replays a saved typed success after publisher failure with unchanged identity and no paid retry', async () => {
        const f = fixture({ score: 90 });
        f.publishResult.mockRejectedValueOnce(new Error('confirm lost'));
        await expect(f.invoke()).rejects.toThrow('confirm lost');
        await f.invoke();
        expect(f.run).toHaveBeenCalledOnce();
        expect(f.publishResult.mock.calls[0][0]).toEqual(f.publishResult.mock.calls[1][0]);
        expect(f.publishResult.mock.calls[1][0]).toMatchObject({ payloadVersion: 1, data: { ok: true, result: { score: 90 } } });
    });
});
