// Executed inside the pinned Gateway container. Business probes use GET only.
// Output contains counts and pass/fail evidence, never tokens or record contents.
export const activationProbe = String.raw`
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import {MongoClient} from 'mongodb';
import {createHash} from 'node:crypto';
const db=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,dateStrings:true});
const mongo=new MongoClient('mongodb://mongo:27017',{serverSelectionTimeoutMS:5000});
const results={checks:[],counts:{}}; const pass=name=>results.checks.push(name);
const get=async(path,token,status=200)=>{const r=await fetch('http://api-gateway:4000'+path,{headers:token?{authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(10000)});assert.equal(r.status,status,'HTTP '+path);const b=await r.json();if(status===200)assert.equal(b.errCode,0,'application response '+path);return {body:b,cache:r.headers.get('cache-control')};};
const token=id=>jwt.sign({sub:String(id)},process.env.JWT_SECRET,{algorithm:'HS256',issuer:process.env.JWT_ISSUER||'jobfind-auth',audience:process.env.JWT_AUDIENCE||'jobfind-api',expiresIn:120});
try {
 await mongo.connect();
 const [[pending]]=await db.query('SELECT COUNT(*) n FROM outbox_events WHERE publishedAt IS NULL');assert.equal(Number(pending.n),0);pass('MySQL outbox drained');
 const [accounts]=await db.query("SELECT u.id,a.roleCode,u.companyId,c.statusCode companyStatus,c.censorCode companyCensor FROM users u JOIN accounts a ON a.userId=u.id LEFT JOIN companies c ON c.id=u.companyId WHERE a.statusCode='S1' ORDER BY u.id");
 assert.ok(accounts.some(a=>a.roleCode==='CANDIDATE'));assert.ok(accounts.some(a=>a.roleCode==='ADMIN'));
 await get('/api/profile',null,401);await get('/api/jobs/manage',null,401);
 for(const a of accounts) {
   const t=token(a.id); const me=await get('/api/auth/me',t);assert.equal(Number(me.body.data.userId),Number(a.id));assert.equal(me.body.data.roleCode,a.roleCode);
   if(a.roleCode==='CANDIDATE') {
     const history=await get('/api/my-applications',t);assert.match(history.cache,/no-store/);
     const [own]=await db.query('SELECT id FROM cvs WHERE userId=?',[a.id]);
     const ownIds=new Set(own.map(v=>Number(v.id)));
     assert.ok(history.body.data.every(v=>ownIds.has(Number(v.legacy_cv_id))));
     assert.equal(history.body.count,own.length,'Historical applications must all be imported');
     const cvs=await get('/api/profile/cvs',t);assert.match(cvs.cache,/no-store/);assert.ok(Array.isArray(cvs.body.data));
     await get('/api/jobs/manage',t,403);
     for(const row of own) {
       const [[stored]]=await db.query('SELECT file FROM cvs WHERE id=?',[row.id]);
       const res=await get('/api/get-detail-cv-by-id?cvId='+row.id+'&roleCode=CANDIDATE',t);
       assert.equal(res.body.data.file,stored.file?Buffer.from(stored.file,'base64').toString('binary'):stored.file);
     }
     const [[foreign]]=await db.query('SELECT id FROM cvs WHERE userId<>? LIMIT 1',[a.id]);
     if(foreign)await get('/api/get-detail-cv-by-id?cvId='+foreign.id+'&roleCode=CANDIDATE',t,403);
   }
   if(['COMPANY','EMPLOYER'].includes(a.roleCode)&&a.companyStatus==='S1'&&a.companyCensor==='CS1') {
     const list=await get('/api/jobs/manage?limit=50&offset=0',t);assert.match(list.cache,/no-store/);
     const [[n]]=await db.query('SELECT COUNT(*) n FROM posts p JOIN users u ON u.id=p.userId WHERE u.companyId=?',[a.companyId]);assert.equal(list.body.count,Number(n.n));assert.ok(list.body.data.every(p=>Number(p.companyId)===Number(a.companyId)));
     for(const job of list.body.data.slice(0,2))await get('/api/jobs/'+job.id+'/review',t);
     const [[foreign]]=await db.query('SELECT p.id FROM posts p JOIN users u ON u.id=p.userId WHERE u.companyId<>? LIMIT 1',[a.companyId]);
     if(foreign){const r=await fetch('http://api-gateway:4000/api/jobs/'+foreign.id+'/review',{headers:{authorization:'Bearer '+t}});assert.ok([403,404].includes(r.status));}
   }
 }
 pass('current role resolution, private company workspace and cross-company denial');
 pass('historical application progress, candidate-owned CV bytes and cross-candidate denial');
 pass('prepared CV read API and no-store policy');
 const [visible]=await db.query("SELECT p.id FROM posts p JOIN detailposts d ON d.id=p.detailPostId JOIN users u ON u.id=p.userId JOIN companies c ON c.id=u.companyId WHERE p.statusCode='PS1' AND c.statusCode='S1' AND c.censorCode='CS1' ORDER BY p.id");
 const search=await get('/api/search/jobs?limit=100&offset=0');assert.equal(search.body.count,visible.length);assert.deepEqual(search.body.data.map(p=>Number(p.id)).sort((a,b)=>a-b),visible.map(p=>Number(p.id)));
 const empty=await get('/api/search/jobs?q=nonexistent-activation-fixture-9f0ced');assert.equal(empty.body.count,0);
 pass('search projection matches all visible SQL jobs and handles empty results');
 results.counts.visibleJobs=visible.length;results.counts.accountsChecked=accounts.length;
 const [cvRows]=await db.query('SELECT * FROM cvs ORDER BY id');results.counts.submittedCvs=cvRows.length;
 results.cvRowsSha256=createHash('sha256').update(JSON.stringify(cvRows)).digest('hex');
 results.counts.auditLogs=await mongo.db('admin_db').collection('auditlogs').countDocuments();
 const indexes=await mongo.db('admin_db').collection('auditlogs').indexes();assert.ok(indexes.some(i=>i.name==='createdAt_1'&&i.expireAfterSeconds===undefined));assert.ok(indexes.some(i=>i.name==='audit_event_id_unique'&&i.unique));
 pass('Admin preserves original audit index without adding TTL');
 console.log(JSON.stringify(results));
}finally{await db.end();await mongo.close();}
`;
