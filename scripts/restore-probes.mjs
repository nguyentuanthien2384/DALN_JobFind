import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { digest, fingerprintRows } from './backup-integrity.mjs';

const require = createRequire('/app/package.json');
const mysql = require('mysql2/promise'), { MongoClient, BSON } = require('mongodb'), { Pool } = require('pg'), amqp = require('amqplib');
const phase = process.argv[2];
assert.ok(['ready', 'snapshot', 'logical', 'seed', 'hold', 'checkpoint', 'recovered', 'deliver', 'empty'].includes(phase));
assert.equal(process.env.MYSQL_HOST, 'mysql');
const sql = mysql.createPool({ host: 'mysql', user: 'root', password: process.env.MYSQL_PASSWORD, database: 'recovery',
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 2000 });
const pg = new Pool({ host: 'postgres', user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
    database: phase === 'logical' ? 'restore_logical' : process.env.POSTGRES_DATABASE, connectionTimeoutMillis: 2000 });
const mongo = new MongoClient('mongodb://mongo:27017', { serverSelectionTimeoutMS: 2000 });
const token = process.env.REHEARSAL_ID;
assert.match(token, /^[0-9a-f-]{36}$/);
const vhost = `restore-${token}`;
const brokerUser = process.env.BROKER_USER, brokerPassword = process.env.BROKER_PASSWORD;
let broker, channel;
const eventually = async (label, fn) => {
    const end = Date.now() + 90000;
    while (Date.now() < end) {
        try { if (await fn()) return; } catch { /* Never log private driver responses. */ }
        await delay(500);
    }
    throw new Error(`Timeout: ${label}`);
};
const management = async (pathname, method = 'GET', body) => {
    const response = await fetch(`http://rabbitmq:15672/api${pathname}`, { method, signal: AbortSignal.timeout(4000), headers: {
        authorization: 'Basic ' + Buffer.from(`${brokerUser}:${brokerPassword}`).toString('base64'), 'content-type': 'application/json'
    }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    assert.ok(response.ok, `Broker management ${response.status}`);
    const text = await response.text(); return text ? JSON.parse(text) : null;
};
const connectBroker = async () => {
    broker = await amqp.connect({ hostname: 'rabbitmq', username: brokerUser, password: brokerPassword, vhost });
    channel = await broker.createConfirmChannel();
};
const mysqlSnapshot = async () => {
    const [tables] = await sql.query("SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
    const result = {};
    for (const { name } of tables) {
        const quoted = '`' + name.replaceAll('`', '``') + '`';
        const [ddl] = await sql.query(`SHOW CREATE TABLE ${quoted}`);
        const [rows] = await sql.query(`SELECT * FROM ${quoted}`);
        result[name] = { ...fingerprintRows(rows), schemaSha256: digest(ddl[0]['Create Table']) };
    }
    return result;
};
const pgSnapshot = async () => {
    const result = { tables: {}, sequences: {} };
    result.sequenceDefinitions = (await pg.query("SELECT sequencename,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
    assert.ok(result.sequenceDefinitions.every(sequence => BigInt(sequence.increment_by) > 0n && !sequence.cycle),
        'This application recovery drill requires ascending non-cycling sequences');
    const tables = (await pg.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    for (const { tablename } of tables) {
        const quoted = '"' + tablename.replaceAll('"', '""') + '"';
        const rows = (await pg.query(`SELECT row_to_json(t)::text AS record FROM public.${quoted} t`)).rows.map(r => r.record);
        const columns = (await pg.query("SELECT column_name,data_type,udt_name,is_nullable,column_default,character_maximum_length,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [tablename])).rows;
        const indexes = (await pg.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname", [tablename])).rows;
        const constraints = (await pg.query("SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY conname", [`public.${quoted}`])).rows;
        result.tables[tablename] = { ...fingerprintRows(rows), schemaSha256: digest(JSON.stringify({ columns, indexes, constraints })) };
    }
    for (const { sequencename } of (await pg.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows) {
        const quoted = '"' + sequencename.replaceAll('"', '""') + '"';
        result.sequences[sequencename] = (await pg.query(`SELECT last_value::text,is_called FROM public.${quoted}`)).rows[0];
    }
    result.largeObjects = fingerprintRows((await pg.query("SELECT loid::text,pageno,encode(data,'hex') data FROM pg_largeobject ORDER BY loid,pageno")).rows);
    return result;
};
const mongoSnapshot = async () => {
    const names = (await mongo.db().admin().listDatabases()).databases.map(d => d.name);
    const result = {};
    for (const name of names.filter(n => !['local', 'config', 'admin'].includes(n) && (phase === 'logical' ? n.startsWith('restore_logical_') : !n.startsWith('restore_logical_'))).sort()) {
        const key = phase === 'logical' ? name.slice('restore_logical_'.length) : name;
        result[key] = {};
        for (const collection of (await mongo.db(name).listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
            assert.equal(collection.type, 'collection', 'Views require a separate recovery check');
            const coll = mongo.db(name).collection(collection.name);
            const documents = (await coll.find().toArray()).map(d => BSON.EJSON.stringify(d, { relaxed: false }));
            const indexes = (await coll.listIndexes().toArray()).sort((a, b) => a.name.localeCompare(b.name));
            result[key][collection.name] = { ...fingerprintRows(documents), schemaSha256: digest(JSON.stringify({ options: collection.options, indexes })) };
        }
    }
    return result;
};
const topology = async () => {
    const definitions = await management('/definitions');
    // Definitions include password hashes; only their checksum leaves this process.
    const fields = ['users', 'vhosts', 'permissions', 'topic_permissions', 'parameters', 'global_parameters', 'policies', 'queues', 'exchanges', 'bindings'];
    return Object.fromEntries(fields.map(key => [key, fingerprintRows(definitions[key] || [])]));
};
const data = async () => ({ mysql: await mysqlSnapshot(), postgres: await pgSnapshot(), mongo: await mongoSnapshot(), topology: await topology() });
const queueInventory = async () => {
    const queues = await management('/queues');
    assert.ok(queues.every(q => Number.isInteger(q.messages_ready) && Number.isInteger(q.messages_unacknowledged)), 'Broker queue stats not ready');
    return queues.map(q => ({ name: q.name, vhost: q.vhost, type: q.type, durable: q.durable,
        ready: q.messages_ready, unacked: q.messages_unacknowledged })).sort((a, b) => `${a.vhost}/${a.name}`.localeCompare(`${b.vhost}/${b.name}`));
};
const stats = async () => { let inventory; await eventually('queue statistics', async () => { inventory = await queueInventory(); return true; }); return inventory; };
const message = i => ({ id: `message-${i}`, marker: token, content: `Khôi phục dữ liệu ${i}`, bytes: 'AP+A' });
const writeReceipt = async id => {
    try { await sql.query('INSERT INTO restore_drill_receipts(id,marker) VALUES (?,?)', [id, token]); return true; }
    catch (e) { if (e.code === 'ER_DUP_ENTRY') return false; throw e; }
};
let result;
try {
    await eventually('MariaDB', () => sql.query('SELECT 1'));
    await eventually('PostgreSQL', () => pg.query('SELECT 1'));
    await eventually('MongoDB', () => mongo.connect());
    await eventually('RabbitMQ', () => management('/overview'));
    const nodes = await management('/nodes');
    assert.equal(nodes.length, 1, 'Only a standalone RabbitMQ node is supported');
    assert.equal(nodes[0].name, process.env.RABBITMQ_NODENAME, 'Restored broker node identity changed');
    if (phase === 'ready') result = { ready: true, brokerNodePreserved: true };
    if (phase === 'snapshot') result = { ...await data(), queues: await stats() };
    if (phase === 'logical') result = { postgres: await pgSnapshot(), mongo: await mongoSnapshot() };
    if (phase === 'seed') {
        await sql.query('CREATE TABLE restore_drill_markers(id INT PRIMARY KEY, marker VARCHAR(40), bytes BLOB) ENGINE=InnoDB');
        await sql.query('CREATE TABLE restore_drill_receipts(id VARCHAR(40) PRIMARY KEY, marker VARCHAR(40)) ENGINE=InnoDB');
        await sql.query('INSERT INTO restore_drill_markers VALUES(1,?,?)', [token, Buffer.from([0, 255, 128, 39, 10])]);
        await pg.query('CREATE TABLE restore_drill_markers(id SERIAL PRIMARY KEY, marker TEXT, data BYTEA)');
        await pg.query('INSERT INTO restore_drill_markers(marker,data) VALUES($1,$2)', [token, Buffer.from([0, 255, 128, 39, 10])]);
        await mongo.db('ai_worker_db').collection('restore_drill_markers').insertMany([
            { _id: 'started', state: 'started', marker: token }, { _id: 'ready', state: 'ready', marker: token }, { _id: 'published', state: 'published', marker: token }
        ], { writeConcern: { w: 'majority', j: true } });
        await management(`/vhosts/${vhost}`, 'PUT', {});
        await management(`/permissions/${vhost}/${encodeURIComponent(brokerUser)}`, 'PUT', { configure: '.*', read: '.*', write: '.*' });
        await connectBroker();
        await channel.assertQueue('work', { durable: true });
        await channel.assertQueue('work.dead-letter', { durable: true });
        for (let i = 0; i < 8; i++) channel.sendToQueue(i < 6 ? 'work' : 'work.dead-letter', Buffer.from(JSON.stringify(message(i))), {
            persistent: true, contentType: 'application/json', messageId: message(i).id, headers: { marker: token, attempt: 1 }
        });
        await channel.waitForConfirms(); result = { confirmed: 8 };
    }
    if (phase === 'hold') {
        await connectBroker();
        const delivery = await channel.get('work', { noAck: false });
        assert.ok(delivery); assert.equal(delivery.properties.messageId, 'message-0');
        await writeReceipt(delivery.properties.messageId);
        // Crash window: durable side effect committed, ACK intentionally withheld.
        await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
        result = { stopped: true };
    }
    if (phase === 'checkpoint') {
        let inventory;
        await eventually('one unacked message and committed receipt', async () => {
            inventory = await queueInventory(); const q = inventory.find(q => q.vhost === vhost && q.name === 'work');
            return q?.ready === 5 && q.unacked === 1 && Number((await sql.query('SELECT COUNT(*) n FROM restore_drill_receipts'))[0][0].n) === 1;
        });
        result = { data: await data(), queues: inventory,
            expectedQueuesAfterRecovery: inventory.map(q => ({ ...q, ready: q.ready + q.unacked, unacked: 0 })) };
    }
    if (phase === 'recovered') {
        let inventory;
        await eventually('all committed fixture messages recovered', async () => {
            inventory = await queueInventory();
            return inventory.find(q => q.vhost === vhost && q.name === 'work')?.ready === 6
                && inventory.find(q => q.vhost === vhost && q.name === 'work.dead-letter')?.ready === 2;
        });
        result = { data: await data(), queues: inventory };
    }
    if (phase === 'deliver') {
        await connectBroker(); let duplicates = 0; const received = [];
        for (const [queue, count] of [['work', 6], ['work.dead-letter', 2]]) {
            for (let i = 0; i < count; i++) {
                const delivery = await channel.get(queue, { noAck: false }); assert.ok(delivery);
                const body = JSON.parse(delivery.content.toString());
                const index = Number(body.id.split('-')[1]);
                assert.deepEqual(body, message(index));
                assert.equal(delivery.properties.messageId, body.id);
                assert.equal(delivery.properties.deliveryMode, 2);
                assert.deepEqual(delivery.properties.headers, { marker: token, attempt: 1 });
                assert.ok(!received.includes(body.id)); received.push(body.id);
                if (queue === 'work' && !await writeReceipt(body.id)) duplicates++;
                channel.ack(delivery);
            }
            assert.equal((await channel.checkQueue(queue)).messageCount, 0);
        }
        // A synchronous broker round-trip orders the preceding ACK frames.
        await channel.checkQueue('work');
        const [[{ n }]] = await sql.query('SELECT COUNT(*) n FROM restore_drill_receipts');
        result = { effects: Number(n), duplicates, payloadsAndHeadersVerified: received.length };
    }
    if (phase === 'empty') {
        await eventually('ACKs durable across restart', async () => (await queueInventory()).filter(q => q.vhost === vhost).every(q => q.ready === 0 && q.unacked === 0));
        result = { empty: true };
    }
    console.log('EVIDENCE: ' + JSON.stringify(result));
} catch {
    console.error(`Recovery probe failed in phase ${phase}; private database/broker output suppressed`);
    process.exitCode = 1;
} finally {
    await channel?.close().catch(() => {}); await broker?.close().catch(() => {});
    await sql.end(); await pg.end(); await mongo.close();
}
