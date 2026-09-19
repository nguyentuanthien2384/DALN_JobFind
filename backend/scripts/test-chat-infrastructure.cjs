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
process.env.SOCKET_REDIS_PREFIX = name;
process.env.WEB_PUSH_ENABLED = 'false'; // Never inherit real device delivery settings.
if (process.env.CHAT_TEST_LOAD === 'true') process.env.SOCKET_HANDSHAKE_LIMIT_PER_MINUTE='2000';
const children = [], clients = [];
let db, proxy, redisProxy, nginxConfig, nginx;
const waitEvent = (socket, event) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, ready); reject(new Error(`Timeout ${event}`)); }, 8000);
    const ready = (value) => { clearTimeout(timer); resolve(value); }; socket.once(event, ready);
});
const startNode = () => new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'realtime/node.cjs'), [], { silent: true, env: { ...process.env,
        CHAT_FIXTURE_DATABASE_URL: fixtureUrl.href, SOCKET_REDIS_URL: redisProxy?.url || redisUrl, SOCKET_LOG_EVENTS: 'false' } });
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
    await admin.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    require('@babel/register')({ presets: [['@babel/preset-env', { targets: { node: 'current' } }]], babelrc: false, configFile: false });
    db = require('./realtime/fixture.cjs')(fixtureUrl.href);
    for (const model of [db.Company, db.User, db.Account]) await model.sync();
    const q = db.sequelize.getQueryInterface();
    await require('../src/migrations/migration-create-chatmessage').up(q, DataTypes);
    await q.bulkInsert('ChatMessages', [{ senderId: 7, receiverId: 8, content: 'legacy', isRead: 0, createdAt: new Date(), updatedAt: new Date() }]);
    const migration = require('../src/migrations/migrationzzzz-chat-reliability');
    await migration.up(q, DataTypes); await migration.up(q, DataTypes);
    await require('../src/migrations/migrationzzzzz-realtime-presence').up(q, DataTypes);
    const presence = require('../src/services/realtimePresenceService');
    await Promise.all([presence.touch(8, '2026-01-03T12:00:00Z'), presence.touch(8, '2026-01-01T12:00:00Z')]);
    assert.equal(await presence.lastSeen(8), '2026-01-03T12:00:00.000Z');
    assert.equal(await presence.lastSeen(999), null);
    console.log('PASS presence: persisted across readers, monotonic concurrent updates, unknown last-seen is null');
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

    // Exercise cursor predicates and sentinels in SQL, including an interleaved
    // unrelated conversation: global IDs are not contiguous per conversation.
    await db.ChatMessage.bulkCreate(Array.from({length: 315}, (_, i) => ({senderId:7,receiverId:i % 21 === 0 ? 9 : 8,content:`history ${i}`,isRead:0})));
    const expected = await db.ChatMessage.findAll({where:{[require('sequelize').Op.or]:[{senderId:7,receiverId:8},{senderId:8,receiverId:7}]},order:[['id','ASC']],raw:true});
    let cursor, recovered = [];
    do {
        const page = await chat.getConversation({userId:8,partnerId:7,afterId:cursor || 1,limit:37});
        recovered.push(...page.data); cursor = page.pageInfo.nextAfterId;
        if (!page.pageInfo.hasMore) break;
    } while (true);
    assert.deepEqual(recovered.map(m=>m.id),expected.filter(m=>m.id>1).map(m=>m.id));
    let before, history = [];
    do {
        const page = await chat.getConversation({userId:8,partnerId:7,beforeId:before,limit:53});
        history.unshift(...page.data); before=page.pageInfo.nextBeforeId;
        if (!page.pageInfo.hasMore) break;
    } while (true);
    assert.deepEqual(history.map(m=>m.id),expected.map(m=>m.id));
    assert.equal((await chat.getConversation({userId:8,partnerId:9,afterId:1})).errCode,5);
    console.log('PASS MySQL pagination: 300+ messages, both directions, no gaps/duplicates, authorization, interleaved conversation IDs');

    if(process.env.CHAT_TEST_PUSH === 'true')await require('./realtime/push.cjs')(db);
    if (process.env.CHAT_TEST_NGINX_BIN) {nginxConfig=await require('./realtime/nginx.cjs').prepare();process.env.URL_REACT+=','+nginxConfig.url;}
    if (process.env.CHAT_TEST_CHAOS === 'true') redisProxy = await require('./realtime/redis-fault-proxy.cjs')(redisUrl);
    if (process.env.CHAT_TEST_BROWSERS === 'true'||process.env.CHAT_TEST_CONVERSATION==='true') process.env.CHAT_BROWSER_ASSETS = await require('./realtime/browser.cjs').build();
    const [nodeA, nodeB] = await Promise.all([startNode(), startNode()]);
    if(process.env.CHAT_TEST_CONVERSATION==='true')await require('./realtime/conversation.cjs')({nodes:[nodeA,nodeB],db,tokenFor:id=>jwt.sign({sub:String(id)},process.env.JWT_SECRET,{algorithm:'HS256',issuer:'jobfind-auth',audience:'jobfind-api',expiresIn:900})});
    if (process.env.CHAT_TEST_BROWSERS === 'true') await require('./realtime/browser.cjs').run({url:nodeB,db,tokenFor:(id)=>jwt.sign({sub:String(id)},process.env.JWT_SECRET,{algorithm:'HS256',issuer:'jobfind-auth',audience:'jobfind-api',expiresIn:900})});
    if (nginxConfig) {
        nginx=await require('./realtime/nginx.cjs').start(nginxConfig,[nodeA,nodeB]);
        await require('./realtime/nginx.cjs').verify({config:nginxConfig,token:jwt.sign({sub:'7'},process.env.JWT_SECRET,{algorithm:'HS256',issuer:'jobfind-auth',audience:'jobfind-api',expiresIn:900})});
    }
    if (process.env.CHAT_TEST_TIMING === 'true') await require('./realtime/timing.cjs')({url:nodeB,tokenFor:(id)=>jwt.sign({sub:String(id)},process.env.JWT_SECRET,{algorithm:'HS256',issuer:'jobfind-auth',audience:'jobfind-api',expiresIn:900})});
    if (process.env.CHAT_TEST_LOAD === 'true') await require('./realtime/load.cjs')({nodes:[nodeA,nodeB],db,tokenFor:(id)=>jwt.sign({sub:String(id)},process.env.JWT_SECRET,{algorithm:'HS256',issuer:'jobfind-auth',audience:'jobfind-api',expiresIn:900})});
    const sender = await connect(nodeA, 7), receiver = await connect(nodeB, 8), otherTab = await connect(nodeB, 7);
    // A cross-node presence query is also a readiness check for adapter subscribers.
    assert.equal((await sender.timeout(6000).emitWithAck('chat:presence', { partnerId: 8 })).data.online, true);
    const secondReceiverTab = await connect(nodeA,8);
    receiver.disconnect();
    assert.equal((await otherTab.timeout(6000).emitWithAck('chat:presence',{partnerId:8})).data.online,true);
    secondReceiverTab.disconnect();
    let offline;
    for (let attempt=0;attempt<20;attempt++) {
        offline = await otherTab.timeout(6000).emitWithAck('chat:presence',{partnerId:8});
        if (!offline.data.online && Date.now()-new Date(offline.data.lastSeenAt).getTime()<10000) break;
        await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(offline.data.online,false);assert.ok(Date.now()-new Date(offline.data.lastSeenAt).getTime()<10000);
    const reopened = waitEvent(receiver,'connect');receiver.connect();await reopened;
    console.log('PASS presence: cross-node tab remains online; last tab disconnect stores recent last-seen');
    await db.Company.bulkCreate([{id:11,name:'A',statusCode:'S1',censorCode:'CS1'},{id:12,name:'B',statusCode:'S1',censorCode:'CS1'}]);
    await db.User.bulkCreate([{id:20,companyId:11},{id:21,companyId:11},{id:22,companyId:12}]);
    await db.Account.bulkCreate([20,21,22].map(userId=>({userId,roleCode:'EMPLOYER',statusCode:'S1'})));
    const companyA=await connect(nodeA,20),companyATab=await connect(nodeB,21),companyB=await connect(nodeB,22);
    const hints=[]; companyB.on('dashboard:changed',()=>hints.push('other-company'));receiver.on('dashboard:changed',()=>hints.push('candidate'));
    const deliveries=[waitEvent(sender,'dashboard:changed'),waitEvent(companyA,'dashboard:changed'),waitEvent(companyATab,'dashboard:changed')];
    children[0].send({action:'dashboard',type:'cv',scope:{companyId:11}});
    assert.ok((await Promise.all(deliveries)).every(event=>event.type==='cv'));
    await new Promise(resolve=>setTimeout(resolve,150));assert.deepEqual(hints,[]);
    companyA.disconnect();companyATab.disconnect();companyB.disconnect();
    console.log('PASS scoped dashboard: admins + two authorized company users across nodes; other company and candidate receive nothing');
    await db.Notification.sync();
    const notice=await db.Notification.create({userId:7,content:'test read sync',isChecked:0});
    const wrongNotice=await db.Notification.create({userId:8,content:'other owner',isChecked:0});
    let leakedRead=false;const unexpectedRead=()=>{leakedRead=true;};receiver.on('notification:read',unexpectedRead);
    const readHints=[waitEvent(sender,'notification:read'),waitEvent(otherTab,'notification:read')];
    const readResponse=await fetch(`${nodeA}/api/test-read-notification`,{method:'POST',headers:{'Content-Type':'application/json',authorization:`Bearer ${sender.auth.token}`},body:JSON.stringify({id:notice.id,userId:8})});
    assert.equal((await readResponse.json()).errCode,0);assert.ok((await Promise.all(readHints)).every(event=>event.v===1));
    await notice.reload();await wrongNotice.reload();assert.equal(+notice.isChecked,1);assert.equal(+wrongNotice.isChecked,0);
    await new Promise(resolve=>setTimeout(resolve,150));assert.equal(leakedRead,false);receiver.off('notification:read',unexpectedRead);
    console.log('PASS notification read: real authenticated HTTP/SQL commit, two tabs across Redis nodes receive invalidation, another account receives nothing');
    const packet = { v: 1, receiverId: 8, content: 'cross node', clientMessageId: 'redis-cross-node-00001' };
    const received = waitEvent(receiver, 'chat:new-message'), mirrored = waitEvent(otherTab, 'chat:new-message');
    const sent = await sender.timeout(6000).emitWithAck('chat:send', packet);
    assert.equal(sent.errCode, 0); assert.equal((await received).id, sent.data.id); assert.equal((await mirrored).id, sent.data.id);
    const response = await fetch(`${nodeB}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', authorization: `Bearer ${sender.auth.token}` }, body: JSON.stringify(packet) });
    assert.equal((await response.json()).data.id, sent.data.id);
    assert.equal(await db.ChatMessage.count({ where: { clientMessageId: packet.clientMessageId } }), 1);
    if (redisProxy) {
        redisProxy.pause();await new Promise(resolve=>setTimeout(resolve,700));
        const failedPacket={v:1,receiverId:8,content:'must not save during Redis outage',clientMessageId:'redis-outage-00000001'};
        const denied=await sender.timeout(5000).emitWithAck('chat:send',failedPacket);
        assert.equal(denied.ok,false);assert.equal(await db.ChatMessage.count({where:{clientMessageId:failedPacket.clientMessageId}}),0);
        redisProxy.resume();
        let resumed;
        for(let attempt=0;attempt<20;attempt++) {
            await new Promise(resolve=>setTimeout(resolve,250));
            resumed=await sender.timeout(5000).emitWithAck('chat:send',failedPacket);
            if(resumed.errCode===0)break;
        }
        assert.equal(resumed.errCode,0);assert.equal(await db.ChatMessage.count({where:{clientMessageId:failedPacket.clientMessageId}}),1);
        console.log('PASS Redis outage: no unauthorized local limiter fallback or DB write, event loop responsive, reconnect resumes with one insert');
    }
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
    children[0].send('close'); assert.equal(await exited, 0, 'original node must shut down cleanly');
    proxy.switchTo(nodeB);
    delivered = waitEvent(recovering, 'chat:new-message');
    const reconnected = waitEvent(recovering, 'connect'); recovering.connect(); await reconnected;
    assert.equal(recovering.recovered, true); assert.equal((await delivered).id, missed.data.id);
    console.log('PASS recovery through proxy on another node after original node shuts down');
})().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
    clients.forEach((socket) => socket.disconnect());
    if (proxy) await proxy.close();
    if (nginx) await nginx.close();
    await Promise.all(children.map((child) => new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        const timer = setTimeout(() => { child.kill(); resolve(); }, 8000);
        child.once('exit', (code) => { clearTimeout(timer); if (code !== 0) {console.error(`Fixture shutdown failed: ${code}`);process.exitCode=1;} resolve(); }); child.send('close');
    })));
    if (redisProxy) await redisProxy.close();
    if (db) await db.sequelize.close();
    if (!/^chat_realtime_test_[a-f0-9]{16}$/.test(name)) throw new Error('Invalid cleanup scope');
    await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.close();
});
