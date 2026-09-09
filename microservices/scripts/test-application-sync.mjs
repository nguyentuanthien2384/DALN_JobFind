import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import net from 'node:net';
import mysql from 'mysql2/promise';

// Real legacy HTTP/Sequelize writer -> shared outbox relay -> RabbitMQ -> real
// Application consumer/PostgreSQL. Only disposable loopback infrastructure.
assert.equal(process.argv.length,2);
let submissionPdf = 'data:application/pdf;base64,JVBERi0xLjQ=';
if (process.env.JOBFIND_APPLICATION_TEST_PDF) {
    const bytes = await readFile(process.env.JOBFIND_APPLICATION_TEST_PDF);
    assert.ok(bytes.length <= 2 * 1024 * 1024 && bytes.subarray(0, 5).toString() === '%PDF-', 'Expected a test PDF no larger than 2 MiB');
    submissionPdf = 'data:application/pdf;base64,' + bytes.toString('base64');
}
const token=randomUUID(), label='jobfind.application-sync-test', containers=[];
const execute=promisify(execFile);
const docker=async(...args)=>(await execute('docker',args,{windowsHide:true,timeout:90000,maxBuffer:1024*1024})).stdout.trim();
const legacyRequire=createRequire(new URL('../../backend/package.json',import.meta.url));
let sql, db, coreDb, appDb, rabbit, publisher, sync, server;
const eventually=async(work)=>{let last;for(let n=0;n<120;n++){try{const result=await work();if(result)return result;}catch(error){last=error;}await delay(500);}throw last||Error('Timed out');};
let passed=0;
const check=async(name,work)=>{await work();console.log('PASS: '+name);passed++;};
const start=async(name,image,port,env,args=[])=>{
    await docker('image','inspect',image,'--format','{{.Id}}');
    // Bind an explicit free loopback port: Docker may assign a different port
    // after restart when published as ::5672, invalidating the reconnect test.
    const reservation=await new Promise(resolve=>{const listener=net.createServer().listen(0,'127.0.0.1',()=>resolve(listener));});
    const hostPort=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    const container=await docker('run','--detach','--pull=never','--label',`${label}=${token}`,'--name',`jobfind-application-${name}-${token.slice(0,8)}`,
        '--publish',`127.0.0.1:${hostPort}:${port}`,...Object.entries(env).flatMap(([key,value])=>['--env',`${key}=${value}`]),image,...args);
    assert.match(container,/^[a-f0-9]{64}$/);containers.push(container);
    return {container,port:Number(await docker('inspect','--format',`{{(index (index .NetworkSettings.Ports "${port}/tcp") 0).HostPort}}`,container))};
};
try {
    const my=await start('mysql','mysql:8.0',3306,{MYSQL_ROOT_PASSWORD:token,MYSQL_ROOT_HOST:'%',MYSQL_DATABASE:'application_test'},['--lower-case-table-names=1']);
    const post=await start('postgres','postgres:16-alpine',5432,{POSTGRES_USER:'fixture',POSTGRES_PASSWORD:token,POSTGRES_DB:'application_test'});
    const broker=await start('rabbit','rabbitmq:4-management-alpine',5672,{RABBITMQ_DEFAULT_USER:'fixture',RABBITMQ_DEFAULT_PASS:token});
    sql=mysql.createPool({host:'127.0.0.1',port:my.port,user:'root',password:token,database:'application_test',connectTimeout:1000});
    await eventually(()=>sql.query('SELECT 1'));
    Object.assign(process.env,{NODE_ENV:'development',DB_HOST:'127.0.0.1',DB_PORT:String(my.port),DB_USER:'root',DB_PASSWORD:token,DB_NAME:'application_test',
        MYSQL_HOST:'127.0.0.1',MYSQL_PORT:String(my.port),MYSQL_USER:'root',MYSQL_PASSWORD:token,MYSQL_DATABASE:'application_test',
        POSTGRES_URL:`postgres://fixture:${token}@127.0.0.1:${post.port}/application_test`,RABBITMQ_URL:`amqp://fixture:${token}@127.0.0.1:${broker.port}`,
        INTERNAL_SECRET:token,LOG_LEVEL:'silent',EMAIL_APP:'',EMAIL_APP_PASSWORD:'',ANTHROPIC_API_KEY:''});
    legacyRequire('dotenv').config=()=>({parsed:{}});
    legacyRequire('@babel/register')({babelrc:false,configFile:false,cache:false,only:[file=>file.startsWith(fileURLToPath(new URL('../../backend/src/',import.meta.url)))],
        presets:[[legacyRequire.resolve('@babel/preset-env'),{targets:{node:'current'}}]]});
    db=legacyRequire('./src/models/index.js');
    const controller=legacyRequire('./src/controllers/cvController.js');
    coreDb=await import('../job-core-service/src/libs/db.js');
    const outbox=await import('../job-core-service/src/libs/outbox.js');
    appDb=await import('../application-service/src/libs/db.js');
    await eventually(()=>appDb.pool.query('SELECT 1'));
    assert.equal((await sql.query('SELECT DATABASE() AS name'))[0][0].name,'application_test');
    const ddl=[
        'CREATE TABLE users(id INT PRIMARY KEY,companyId INT,firstName VARCHAR(255),lastName VARCHAR(255),email VARCHAR(255))',
        'CREATE TABLE companies(id INT PRIMARY KEY,statusCode VARCHAR(10),censorCode VARCHAR(10))',
        'CREATE TABLE accounts(id INT PRIMARY KEY,userId INT,roleCode VARCHAR(32),statusCode VARCHAR(10),phonenumber VARCHAR(32))',
        'CREATE TABLE detailposts(id INT PRIMARY KEY,name VARCHAR(255))',
        'CREATE TABLE posts(id INT PRIMARY KEY,userId INT,detailPostId INT,statusCode VARCHAR(10),timeEnd VARCHAR(32))',
        'CREATE TABLE cvs(id INT AUTO_INCREMENT PRIMARY KEY,userId INT,postId INT,file LONGBLOB,description VARCHAR(255),isChecked TINYINT,createdAt DATETIME,updatedAt DATETIME,UNIQUE KEY cvs_userid_postid_unique(userId,postId))'
    ];
    for(const statement of ddl)await sql.query(statement+' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    await outbox.ensureOutboxTable();await appDb.initSchema();
    await (await import('../application-service/src/libs/outbox.js')).ensureOutboxTable();
    await sql.query("INSERT INTO users VALUES(1,NULL,'Original','Candidate','original@example.invalid'),(2,NULL,'Other','Candidate','other@example.invalid'),(7,3,'Job','Owner','owner@example.invalid')");
    await sql.query("INSERT INTO companies VALUES(3,'S1','CS1')");
    await sql.query("INSERT INTO accounts VALUES(1,1,'CANDIDATE','S1','000'),(2,2,'CANDIDATE','S1','111'),(7,7,'COMPANY','S1','222')");
    await sql.query("INSERT INTO detailposts VALUES(1,'Synthetic job')");
    for(let id=1;id<=8;id++)await sql.query("INSERT INTO posts VALUES(?,7,1,'PS1',?)",[id,String(Date.now()+3600000)]);
    await sql.query("INSERT INTO cvs VALUES(100,2,1,'historic-file','Historical letter',1,NOW(),NOW())");
    sync=await import('../application-service/src/controllers/syncController.js');
    const {myApplications,moveStage}=await import('../application-service/src/controllers/applicationController.js');
    const {contractRoute}=await import('../shared/requestContract.js');
    const {requireServicePermission,PERMISSIONS}=await import('../shared/accessControl.js');
    const app=express();app.use(express.json());
    // Isolated identity fixture, not a claim of testing the real login middleware.
    app.use((req,res,next)=>{const userId=Number(req.headers['x-fixture-user']||1);req.user={id:userId,roleCode:userId===7?'COMPANY':'CANDIDATE',companyId:userId===7?3:null,companyStatusCode:'S1',companyCensorCode:'CS1'};req.headers['x-user-id']=String(userId);
        req.headers['x-user-role']=userId===7?'COMPANY':'CANDIDATE';if(userId===7)req.headers['x-company-id']='3';
        if(req.headers['x-drop-response']==='1')res.json=()=>res.destroy();next();});
    app.post('/api/create-new-cv',controller.handleCreateNewCV);
    contractRoute(app,'myApplications',requireServicePermission(PERMISSIONS.APPLICATION_SELF_READ),myApplications);
    contractRoute(app,'applicationMove',requireServicePermission(PERMISSIONS.APPLICATION_MANAGE,{companyRequired:true}),moveStage);
    server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    const origin=`http://127.0.0.1:${server.address().port}`;
    const request=async(path,options={})=>{const res=await fetch(origin+path,{signal:AbortSignal.timeout(15000),...options});return {status:res.status,body:await res.json(),headers:res.headers};};
    const submit=(postId,extra={},headers={})=>request('/api/create-new-cv',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({userId:999,postId,file:submissionPdf,description:'Reviewed letter',...extra})});
    const one=async(query,args=[])=>(await sql.query(query,args))[0][0];
    let accepted;
    await check('legacy historical import and current submission keep different ID namespaces',async()=>{
        assert.equal((await sync.syncFromLegacy()).imported,1);
        accepted=await submit(1);assert.equal(accepted.body.errCode,0);assert.equal(accepted.body.cvId,101);
        const cv=await one('SELECT * FROM cvs WHERE id=101');assert.equal(cv.userId,1);
        const event=await one("SELECT * FROM outbox_events WHERE eventType='application.submitted'");
        assert.equal(event.publishedAt,null);assert.equal(JSON.parse(event.payload).candidateName,'Original Candidate');
        assert.equal((await sync.syncFromLegacy()).imported,0);
    });
    await check('snapshot and PDF stay frozen after source profile changes before delivery',async()=>{
        await sql.query("UPDATE users SET firstName='Changed',email='changed@example.invalid' WHERE id=1");
        await sql.query("UPDATE detailposts SET name='Changed title' WHERE id=1");
        const payload=JSON.parse((await one('SELECT payload FROM outbox_events LIMIT 1')).payload);
        assert.equal(payload.jobTitle,'Synthetic job');assert.equal(payload.candidateEmail,'original@example.invalid');
        assert.equal((await one('SELECT file FROM cvs WHERE id=101')).file.toString(),submissionPdf);
    });
    rabbit=await import('../shared/rabbitmq.js');publisher=await import('../shared/outboxPublisher.js');
    const consumer=await import('../application-service/src/consumers/submissionConsumer.js');
    await eventually(async()=>{await consumer.startSubmissionConsumer();return true;});
    await check('confirmed real relay -> broker -> consumer -> self-only application progress',async()=>{
        assert.equal(await outbox.runOutboxOnce(),1);
        await eventually(async()=>{const response=await request('/my-applications');return response.body.count===1;});
        const mine=await request('/my-applications');assert.equal(mine.headers.get('cache-control'),'private, no-store');
        assert.equal(mine.body.data[0].legacy_cv_id,101);assert.notEqual(Number(mine.body.data[0].id),101);
        const other=await request('/my-applications',{headers:{'x-fixture-user':'2'}});assert.equal(other.body.count,1);assert.equal(other.body.data[0].legacy_cv_id,100);
        const stored=(await appDb.pool.query('SELECT * FROM applications WHERE legacy_cv_id=101')).rows[0];
        assert.equal(stored.candidate_name,'Original Candidate');assert.equal(stored.cv_snapshot.email,'original@example.invalid');
    });
    await check('repeated/changed submission preserves first PDF and does not enqueue a second event',async()=>{
        const repeat=await submit(1,{file:'different',description:'different'});assert.equal(repeat.status,409);assert.equal(repeat.body.cvId,101);
        assert.equal((await one("SELECT COUNT(*) AS n FROM outbox_events WHERE eventType='application.submitted'")).n,1);
    });
    await check('duplicate delivery and historical resync preserve recruiter stage and submission snapshot',async()=>{
        const row=(await request('/my-applications')).body.data[0];
        const moved=await request(`/applications/${row.id}/stage`,{method:'PATCH',headers:{'content-type':'application/json','x-fixture-user':'7'},body:JSON.stringify({stage:'phong_van'})});assert.equal(moved.body.errCode,0);
        const event=await one('SELECT * FROM outbox_events LIMIT 1');
        await publisher.publishOutboxEvent(event.eventType,JSON.parse(event.payload),{messageId:event.id,aggregateId:event.aggregateId,occurredAt:event.createdAt,producer:'legacy-backend'});
        await sync.syncFromLegacy();await delay(500);
        assert.equal((await request('/my-applications')).body.data[0].stage,'phong_van');
        assert.equal((await appDb.pool.query('SELECT COUNT(*)::int AS n FROM applications WHERE legacy_cv_id=101')).rows[0].n,1);
    });
    await check('outbox write failure rolls back CV; missing unique index fails closed',async()=>{
        await sql.query("CREATE TRIGGER reject_submission BEFORE INSERT ON outbox_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic outbox failure'");
        assert.notEqual((await submit(2)).body.errCode,0);assert.equal((await one('SELECT COUNT(*) AS n FROM cvs WHERE postId=2')).n,0);
        await sql.query('DROP TRIGGER reject_submission');await sql.query('ALTER TABLE cvs DROP INDEX cvs_userid_postid_unique');
        assert.equal((await submit(2)).status,503);
        await sql.query('ALTER TABLE cvs ADD UNIQUE KEY insufficient_unique(userId,postId,description(10))');
        assert.equal((await submit(2)).status,503,'A three-column index with a prefix is not a user/job uniqueness guarantee');
        await sql.query('ALTER TABLE cvs DROP INDEX insufficient_unique, ADD UNIQUE KEY cvs_userid_postid_unique(userId,postId)');
    });
    await check('response loss after commit and concurrent retries create exactly one CV/event',async()=>{
        await assert.rejects(()=>submit(3,{}, {'x-drop-response':'1'}));
        assert.equal((await submit(3)).body.errCode,5);
        const concurrent=await Promise.all([submit(4),submit(4)]);assert.equal(concurrent.filter(row=>row.body.errCode===0).length,1);
        assert.equal((await one('SELECT COUNT(*) AS n FROM cvs WHERE postId=4')).n,1);
        assert.equal((await one("SELECT COUNT(*) AS n FROM outbox_events WHERE JSON_EXTRACT(payload,'$.jobId')=4")).n,1);
    });
    await check('broker outage does not lose accepted CVs; recovery delivers backlog once',async()=>{
        await docker('stop',broker.container);
        assert.equal((await submit(5)).body.errCode,0);
        assert.equal((await one('SELECT COUNT(*) AS n FROM outbox_events WHERE publishedAt IS NULL')).n,3);
        await docker('start',broker.container);
        await eventually(()=>rabbit.isConsumerReady());
        await eventually(async()=>{await outbox.runOutboxOnce();return (await one('SELECT COUNT(*) AS n FROM outbox_events WHERE publishedAt IS NULL')).n===0;});
        await eventually(async()=>(await request('/my-applications')).body.count===4);
    });
    await check('changed role, closed job and invalid input do not write a CV',async()=>{
        await sql.query("UPDATE accounts SET roleCode='COMPANY' WHERE userId=1");assert.equal((await submit(6)).status,403);
        await sql.query("UPDATE accounts SET roleCode='CANDIDATE' WHERE userId=1");await sql.query("UPDATE posts SET timeEnd='1' WHERE id=6");assert.equal((await submit(6)).body.errCode,4);
        assert.equal((await submit(7,{description:'x'.repeat(256)})).status,400);
        assert.equal((await one('SELECT COUNT(*) AS n FROM cvs WHERE postId>=6')).n,0);
    });
    await check('deadline is checked after waiting on the job owner lock',async()=>{
        await sql.query('UPDATE posts SET timeEnd=? WHERE id=8',[String(Date.now()+700)]);
        const connection=await sql.getConnection();
        try {
            await connection.beginTransaction();await connection.query('SELECT id FROM users WHERE id=7 FOR UPDATE');
            const pending=submit(8);await delay(1000);await connection.commit();
            assert.equal((await pending).body.errCode,4);
        } finally {await connection.rollback();connection.release();}
        assert.equal((await one('SELECT COUNT(*) AS n FROM cvs WHERE postId=8')).n,0);
    });
    console.log(`Application sync acceptance: ${passed} checks passed`);
} finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    await rabbit?.drainConsumers();await rabbit?.closeConnection();await publisher?.closeOutboxPublisher();
    await sync?.closeLegacySource();await db?.sequelize.close();await coreDb?.pool.end();await appDb?.pool.end();await sql?.end();
    for(const container of containers.reverse()){
        assert.equal(await docker('inspect','--format',`{{index .Config.Labels "${label}"}}`,container),token);
        await docker('rm','-f','-v',container);
    }
    console.log('Cleaned owned application fixtures');
}
