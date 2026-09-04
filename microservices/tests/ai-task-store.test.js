import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTaskStore, ensureTaskStore, closeTaskStore } from '../ai-worker/src/libs/taskStore.js';
import { taskIdentity } from '../ai-worker/src/libs/taskIdentity.js';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn(), db: vi.fn(), options: null }));
vi.mock('mongodb', () => ({ MongoClient: class {
    constructor(uri, options) { mocks.uri = uri; mocks.options = options; }
    connect = mocks.connect;
    close = mocks.close;
    db = mocks.db;
} }));
const collection = () => ({ insertOne: vi.fn(), findOne: vi.fn(), updateOne: vi.fn(), createIndex: vi.fn(), options: vi.fn().mockResolvedValue({}) });
const identity = taskIdentity({ jobId: 7, name: 'private title' }, 'ai.moderate_job', { eventId: 'event-1' });
afterEach(async () => { await closeTaskStore(); vi.unstubAllEnvs(); });

describe('AI durable task store', () => {
    it('adds only an operational index and requires case-sensitive identity', async () => {
        const c = collection();
        await createTaskStore(c).ensureIndexes();
        expect(c.createIndex).toHaveBeenCalledWith({ state: 1, startedAt: 1 }, { name: 'ai_task_state_started' });
        c.options.mockResolvedValue({ collation: { locale: 'en', strength: 2 } });
        await expect(createTaskStore(c).ensureIndexes()).rejects.toThrow('case-sensitive');
    });
    it('persists a unique claim but no raw input before permitting an AI call', async () => {
        const c = collection();
        const result = await createTaskStore(c).claim(identity);
        expect(result).toMatchObject({ acquired: true, record: { _id: 'event:event-1', state: 'started', fingerprint: identity.fingerprint } });
        expect(c.insertOne).toHaveBeenCalledWith(result.record);
        expect(JSON.stringify(result.record)).not.toContain('private title');
        expect(result.record.owner).toMatch(/^[a-f0-9-]{36}$/);
    });
    it('accepts genuine identity duplicates only, without changing their original state', async () => {
        const c = collection();
        const duplicate = { code: 11000 };
        c.insertOne.mockRejectedValue(duplicate);
        c.findOne.mockResolvedValue({ fingerprint: identity.fingerprint, state: 'published' });
        expect(await createTaskStore(c).claim(identity)).toMatchObject({ acquired: false, record: { state: 'published' } });
        c.findOne.mockResolvedValue({ fingerprint: 'different' });
        await expect(createTaskStore(c).claim(identity)).rejects.toHaveProperty('code', 'AI_TASK_ID_CONFLICT');
        c.findOne.mockResolvedValue(null);
        await expect(createTaskStore(c).claim(identity)).rejects.toBe(duplicate);
        expect(c.updateOne).not.toHaveBeenCalled();
    });
    it('does not hide storage/network errors', async () => {
        const c = collection();
        const error = new Error('write concern failed');
        c.insertOne.mockRejectedValue(error);
        await expect(createTaskStore(c).claim(identity)).rejects.toBe(error);
        expect(c.findOne).not.toHaveBeenCalled();
    });
    it('only the original started owner can freeze a result; expired time grants no takeover', async () => {
        const c = collection();
        c.updateOne.mockResolvedValueOnce({ matchedCount: 1 }).mockResolvedValueOnce({ matchedCount: 0 });
        const record = { _id: 'event:event-1', owner: 'owner' };
        await createTaskStore(c).complete(record, { data: { ok: true } });
        expect(c.updateOne.mock.calls[0][0]).toEqual({ _id: record._id, owner: 'owner', state: 'started' });
        expect(c.updateOne.mock.calls[0][1].$set).toMatchObject({ state: 'ready', output: { data: { ok: true } } });
        await expect(createTaskStore(c).complete(record, {})).rejects.toHaveProperty('code', 'AI_TASK_STATE_CONFLICT');
    });
    it('clears result content only after publication and tolerates a concurrent publication marker', async () => {
        const c = collection();
        const store = createTaskStore(c);
        c.updateOne.mockResolvedValueOnce({ matchedCount: 1 }).mockResolvedValue({ matchedCount: 0 });
        await store.markPublished({ _id: 'event:event-1' });
        expect(c.updateOne.mock.calls[0][1].$unset).toEqual({ output: '', owner: '' });
        c.findOne.mockResolvedValueOnce({ state: 'published' });
        await store.markPublished({ _id: 'event:event-1' });
        c.findOne.mockResolvedValueOnce({ state: 'started' });
        await expect(store.markPublished({ _id: 'event:event-1' })).rejects.toHaveProperty('code', 'AI_TASK_STATE_CONFLICT');
    });
    it('requires explicit dedicated connectivity and durable writes before startup', async () => {
        vi.stubEnv('AI_MONGO_URL', '');
        await expect(ensureTaskStore()).rejects.toThrow('AI_MONGO_URL');
        expect(mocks.connect).not.toHaveBeenCalled();
        vi.stubEnv('AI_MONGO_URL', 'mongodb://isolated-test/ai_worker_db');
        const c = collection();
        const getCollection = vi.fn().mockReturnValue(c);
        mocks.db.mockReturnValue({ collection: getCollection });
        await Promise.all([ensureTaskStore(), ensureTaskStore()]);
        expect(mocks.connect).toHaveBeenCalledOnce();
        expect(getCollection).toHaveBeenCalledWith('task_executions');
        expect(mocks.options).toMatchObject({ retryWrites: false, readPreference: 'primary', writeConcern: { w: 'majority', j: true, wtimeoutMS: 10000 } });
    });
    it('closes a failed startup connection and allows a later startup attempt', async () => {
        vi.stubEnv('AI_MONGO_URL', 'mongodb://isolated-test/ai_worker_db');
        mocks.connect.mockRejectedValueOnce(new Error('offline'));
        await expect(ensureTaskStore()).rejects.toThrow('offline');
        expect(mocks.close).toHaveBeenCalledOnce();
        mocks.db.mockReturnValue({ collection: () => collection() });
        await ensureTaskStore();
        expect(mocks.connect).toHaveBeenCalledTimes(2);
    });
});
