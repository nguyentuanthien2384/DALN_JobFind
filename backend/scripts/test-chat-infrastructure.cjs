// Explicit opt-in endpoints, localhost only. Creates/drops only its own random
// database. Redis must also be disposable: adapter data has short test lifetime.
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Sequelize, DataTypes } = require('sequelize');
const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const mysqlUrl = process.env.CHAT_TEST_MYSQL_URL;
const redisUrl = process.env.CHAT_TEST_REDIS_URL;
for (const [name, value] of Object.entries({ CHAT_TEST_MYSQL_URL: mysqlUrl, CHAT_TEST_REDIS_URL: redisUrl })) {
    if (!value || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname)) throw new Error(`${name} must explicitly name a disposable localhost endpoint`);
}
const name = `chat_realtime_test_${randomBytes(8).toString('hex')}`;
const admin = new Sequelize(mysqlUrl, { logging: false });
const fixtureUrl = new URL(mysqlUrl); fixtureUrl.pathname = `/${name}`;
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_ISSUER = 'jobfind-auth'; process.env.JWT_AUDIENCE = 'jobfind-api'; process.env.JWT_ACCESS_TTL_SECONDS = '900';
process.env.URL_REACT = 'http://localhost:3000';
const children = [], clients = [];
let db, proxy;
const waitEvent = (socket, event) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, ready); reject(new Error(`Timeout ${event}`)); }, 8000);
    const ready = (value) => { clearTimeout(timer); resolve(value); }; socket.once(event, ready);
});
const startNode = () => new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'realtime/node.cjs'), [], { silent: true, env: { ...process.env,
        CHAT_FIXTURE_DATABASE_URL: fixtureUrl.href, SOCKET_REDIS_URL: redisUrl, SOCKET_LOG_EVENTS: 'false' } });
    children.push(child);
    const timer = setTimeout(() => reject(new Error('Node startup timeout')), 15000);
    child.once('message', (message) => { clearTimeout(timer); message.error ? reject(new Error(message.error)) : resolve(`http://127.0.0.1:${message.port}`); });
    child.once('error', reject);
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
});
const connect = async (url, id) => {
    const socket = io(url, { auth: { token: jwt.sign({ sub: String(id) }, process.env.JWT_SECRET,
        { algorithm: 'HS256', issuer: 'jobfind-auth', audience: 'jobfind-api', expiresIn: 900 }) },
        extraHeaders: { Origin: 'http://localhost:3000' }, autoConnect: false, reconnection: false });
    clients.push(socket); const ready = waitEvent(socket, 'connect'); socket.connect(); await ready; return socket;
};
(async () => {
    await admin.query(`CREATE DATABASE ${name}`);
    require('@babel/register')({ presets: [['@babel/preset-env', { targets: { node: 'current' } }]], babelrc: false, configFile: false });
    db = require('./realtime/fixture.cjs')(fixtureUrl.href);
    for (const model of [db.Company, db.User, db.Account]) await model.sync();
    const q = db.sequelize.getQueryInterface();
    await require('../src/migrations/migration-create-chatmessage').up(q, DataTypes);
    await q.bulkInsert('ChatMessages', [{ senderId: 7, receiverId: 8, content: 'legacy', isRead: 0, createdAt: new Date(), updatedAt: new Date() }]);
    const migration = require('../src/migrations/migrationzzzz-chat-reliability');
    await migration.up(q, DataTypes); await migration.up(q, DataTypes);
    await db.User.bulkCreate([{ id: 7, firstName: 'Admin' }, { id: 8, firstName: 'Candidate' }, { id: 9, firstName: 'Other' }]);
    await db.Account.bulkCreate([7, 8, 9].map((id) => ({ userId: id, roleCode: id === 7 ? 'ADMIN' : 'CANDIDATE', statusCode: 'S1' })));
    const chat = require('../src/services/chatService');
    const data = { senderId: 7, receiverId: 8, content: 'concurrent', clientMessageId: 'mysql-concurrent-00001' };
    const results = await Promise.all(Array.from({ length: 8 }, () => chat.handleSendMessage(data)));
    assert.equal(new Set(results.map((r) => r.data.id)).size, 1);
    assert.equal(await db.ChatMessage.count({ where: { clientMessageId: data.clientMessageId } }), 1);
    assert.equal((await chat.handleSendMessage({ ...data, content: 'conflict' })).code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await chat.handleSendMessage({ ...data, receiverId: 9 })).code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await chat.handleSendMessage({ senderId: 8, receiverId: 7, content: 'reverse', clientMessageId: data.clientMessageId })).errCode, 0);
    let list = await chat.getListConversation({ userId: 8 });
    assert.equal(list.data.length, 1); assert.equal(list.totalUnread, 2);
    const boundary = results[0].data.id;
    const later = await chat.handleSendMessage({ ...data, clientMessageId: 'mysql-later-00000001', content: 'newer' });
    await chat.markConversationRead({ userId: 8, partnerId: 7, throughMessageId: boundary });
    assert.equal((await db.ChatMessage.findByPk(later.data.id)).isRead, 0);
    list = await chat.getListConversation({ userId: 8 }); assert.equal(list.totalUnread, 1);
    assert.equal((await chat.markConversationRead({ userId: 8, partnerId: 9 })).code, 'CHAT_NOT_ALLOWED');
    console.log('PASS MySQL migration/re-run, legacy rows, concurrent unique insert, conflicting replay, SQL summary and read boundary');

    const [nodeA, nodeB] = await Promise.all([startNode(), startNode()]);
    const sender = await connect(nodeA, 7), receiver = await connect(nodeB, 8), otherTab = await connect(nodeB, 7);
    // A cross-node presence query is also a readiness check for adapter subscribers.
    assert.equal((await sender.timeout(6000).emitWithAck('chat:presence', { partnerId: 8 })).data.online, true);
    const packet = { v: 1, receiverId: 8, content: 'cross node', clientMessageId: 'redis-cross-node-00001' };
    const received = waitEvent(receiver, 'chat:new-message'), mirrored = waitEvent(otherTab, 'chat:new-message');
    const sent = await sender.timeout(6000).emitWithAck('chat:send', packet);
    assert.equal(sent.errCode, 0); assert.equal((await received).id, sent.data.id); assert.equal((await mirrored).id, sent.data.id);
    const response = await fetch(`${nodeB}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', authorization: `Bearer ${sender.auth.token}` }, body: JSON.stringify(packet) });
    assert.equal((await response.json()).data.id, sent.data.id);
    assert.equal(await db.ChatMessage.count({ where: { clientMessageId: packet.clientMessageId } }), 1);
    const ratePayload = { partnerId: 8 };
    // Local limiter state cannot enforce this combined limit; Redis must count
    // both nodes for user 7. Presence authorization is real on both paths.
    let limited = false;
    for (let i = 0; i < 121; i++) {
        const result = await (i % 2 ? sender : otherTab).timeout(6000).emitWithAck('chat:presence', ratePayload);
        if (result.code === 'RATE_LIMITED') { limited = true; break; }
    }
    assert.equal(limited, true);
    console.log('PASS two processes: Redis Streams fanout, sender multi-tab sync, REST dedupe on other node, distributed limiter');
    for (let i = 0; i < 9; i++) await connect(i % 2 ? nodeA : nodeB, 8);
    const overflow = io(nodeA, { auth: receiver.auth, extraHeaders: { Origin: 'http://localhost:3000' }, autoConnect: false, reconnection: false });
    clients.push(overflow);
    const rejected = waitEvent(overflow, 'connect_error'); overflow.connect();
    assert.equal((await rejected).data.code, 'CONNECTION_LIMITED');
    console.log('PASS atomic connection cap across both nodes');
    proxy = await require('./realtime/proxy.cjs')(nodeA);
    const recovering = await connect(proxy.url, 9);
    const recoveryPacket = { v: 1, receiverId: 9, content: 'before restart', clientMessageId: 'redis-recovery-000001' };
    let delivered = waitEvent(recovering, 'chat:new-message');
    await otherTab.timeout(6000).emitWithAck('chat:send', recoveryPacket); await delivered;
    const closedAtServer = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { children[0].off('message', listener); reject(new Error('disconnect not observed')); }, 8000);
        const listener = (message) => { if (message.disconnectedUser === 9) { clearTimeout(timer); children[0].off('message', listener); resolve(); } };
        children[0].on('message', listener);
    });
    recovering.io.engine.close(); await closedAtServer;
    const missed = await otherTab.timeout(6000).emitWithAck('chat:send', { ...recoveryPacket, content: 'during restart', clientMessageId: 'redis-recovery-000002' });
    assert.equal(missed.errCode, 0);
    const exited = new Promise((resolve) => children[0].once('exit', resolve));
    children[0].send('close'); await exited;
    proxy.switchTo(nodeB);
    delivered = waitEvent(recovering, 'chat:new-message');
    const reconnected = waitEvent(recovering, 'connect'); recovering.connect(); await reconnected;
    assert.equal(recovering.recovered, true); assert.equal((await delivered).id, missed.data.id);
    console.log('PASS recovery through proxy on another node after original node shuts down');
})().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
    clients.forEach((socket) => socket.disconnect());
    if (proxy) await proxy.close();
    await Promise.all(children.map((child) => new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        const timer = setTimeout(() => { child.kill(); resolve(); }, 8000);
        child.once('exit', () => { clearTimeout(timer); resolve(); }); child.send('close');
    })));
    if (db) await db.sequelize.close();
    if (!/^chat_realtime_test_[a-f0-9]{16}$/.test(name)) throw new Error('Invalid cleanup scope');
    await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.close();
});
