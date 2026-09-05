import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { requireEnvironment } from '../../../shared/securityConfig.js';
import { taskStateError } from './taskIdentity.js';

// A single document is both the paid-call claim and the saved result. Never
// expire/reclaim a started claim: a timeout cannot prove the model did not run.
export const createTaskStore = (collection) => ({
    async ensureIndexes() {
        await collection.createIndex({ state: 1, startedAt: 1 }, { name: 'ai_task_state_started' });
        const options = await collection.options();
        if (options.collation && options.collation.locale !== 'simple') throw new Error('AI task ledger requires case-sensitive collation');
    },
    async claim(identity) {
        const record = {
            _id: identity.key, fingerprint: identity.fingerprint,
            eventId: identity.eventId, routingKey: identity.routingKey,
            aggregateId: identity.aggregateId, correlationId: identity.correlationId,
            resultEventId: identity.resultEventId,
            state: 'started', owner: randomUUID(), startedAt: new Date()
        };
        try {
            await collection.insertOne(record);
            return { acquired: true, record };
        } catch (error) {
            if (error.code !== 11000) throw error;
            const existing = await collection.findOne({ _id: identity.key });
            // Do not swallow an unrelated unique-index violation.
            if (!existing) throw error;
            if (existing.fingerprint !== identity.fingerprint) {
                throw taskStateError('AI_TASK_ID_CONFLICT', 'AI task identity was reused with different input');
            }
            return { acquired: false, record: existing };
        }
    },
    async complete(record, output) {
        const result = await collection.updateOne(
            { _id: record._id, owner: record.owner, state: 'started' },
            { $set: { state: 'ready', output, completedAt: new Date() } }
        );
        if (result.matchedCount !== 1) throw taskStateError('AI_TASK_STATE_CONFLICT', 'AI task claim changed before result was saved');
    },
    async markPublished(record) {
        const result = await collection.updateOne(
            { _id: record._id, state: 'ready' },
            { $set: { state: 'published', publishedAt: new Date() }, $unset: { output: '', owner: '' } }
        );
        if (result.matchedCount === 1) return;
        const existing = await collection.findOne({ _id: record._id }, { projection: { state: 1 } });
        if (existing?.state !== 'published') throw taskStateError('AI_TASK_STATE_CONFLICT', 'AI task result was not marked published');
    }
});

let client;
let opening;
const getStore = () => {
    if (!opening) {
        const work = (async () => {
            const connection = new MongoClient(requireEnvironment('AI_MONGO_URL'), {
                serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000,
                retryWrites: false, readPreference: 'primary',
                writeConcern: { w: 'majority', j: true, wtimeoutMS: 10000 }
            });
            client = connection;
            try {
                await connection.connect();
                const store = createTaskStore(connection.db().collection('task_executions'));
                await store.ensureIndexes();
                return store;
            } catch (error) {
                await connection.close();
                if (client === connection) client = null;
                throw error;
            }
        })().catch((error) => { opening = null; throw error; });
        opening = work;
    }
    return opening;
};

export const ensureTaskStore = async () => { await getStore(); };
export const checkTaskStore = async () => {
    if (!client) return false;
    await client.db().command({ ping: 1 });
    return true;
};
export const taskStore = Object.fromEntries(['claim', 'complete', 'markPublished'].map((method) => [
    method, async (...args) => (await getStore())[method](...args)
]));
export const closeTaskStore = async () => {
    await opening?.catch(() => {});
    await client?.close();
    client = null;
    opening = null;
};
