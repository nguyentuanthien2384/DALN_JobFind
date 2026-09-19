import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import express from 'express';
import { createStore } from '../support-chat-service/src/store.js';
import { registerSupportRoutes } from '../support-chat-service/src/http.js';
import { createResponder } from '../support-chat-service/src/providers.js';
import { createSupportServiceProxy } from '../api-gateway/src/middlewares/supportServiceProxy.js';

// Disposable MySQL + synthetic people only. No production credentials, AI, email or sockets.
const execute = promisify(execFile), token = randomUUID(), database = 'jobfind_support_test';
const root = fileURLToPath(new URL('../../', import.meta.url)), output = path.join(root, '.local/support-chat-browser');
const legacyRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const docker = async (...args) => (await execute('docker', args, { windowsHide: true, timeout: 45000, maxBuffer: 1024*1024 })).stdout.trim();
const servers = []; let container, pool, browser, browserPage, passed = 0;
const check = async (name, action) => { await action(); passed++; console.log(`PASS: ${name}`); };
const listen = async app => { const server = app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve)); servers.push(server); return `http://127.0.0.1:${server.address().port}`; };
try {
    await docker('image','inspect','mysql:8.0','--format','{{.Id}}');
    container = await docker('run','--detach','--rm','--pull=never','--name',`jobfind-support-test-${token.slice(0,8)}`,'--label',`jobfind.support-test=${token}`,'--publish','127.0.0.1::3306','--env',`MYSQL_ROOT_PASSWORD=${token}`,'--env','MYSQL_ROOT_HOST=%','--env',`MYSQL_DATABASE=${database}`,'mysql:8.0');
    assert.match(container,/^[a-f0-9]{64}$/);
    const port = Number(await docker('inspect','--format','{{(index (index .NetworkSettings.Ports "3306/tcp") 0).HostPort}}',container));
    pool = mysql.createPool({host:'127.0.0.1',port,user:'root',password:token,database,connectionLimit:8});
    for(let n=0;;n++) { try { await pool.query('SELECT 1'); break; } catch(error) { if(n>=100) throw error; await delay(500); } }
    const store=createStore(pool,1);await store.migrate();
    const owner='user:7';let state;
    const begin=(overrides={})=>store.begin(owner,{requestId:randomUUID(),text:'Tạo CV',...overrides});
    await check('durable write, replay, changed-payload conflict and cross-owner isolation',async()=>{
        state=await begin();await store.finish(owner,state,{text:'Hướng dẫn',status:'complete'});
        assert.equal((await createStore(pool).get(owner,state.id)).messages.at(-1).text,'Hướng dẫn');
        assert.equal((await begin({requestId:state.id})).replay,true);
        await assert.rejects(begin({requestId:state.id,text:'changed'}),e=>e.status===409);
        for(const action of ['get','remove']) await assert.rejects(store[action]('user:8',state.id),e=>e.status===404);
        assert.equal((await store.list('user:8')).length,0);
    });
    await check('atomic conversation lease and stale version rejection',async()=>{
        const input={conversationId:state.id,version:state.version,parentId:state.messages.at(-1).id};
        const attempts=await Promise.allSettled([begin(input),begin(input)]);
        assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
        const next=attempts.find(a=>a.status==='fulfilled').value;
        await store.finish(owner,next,{text:'next',status:'complete'});
        await assert.rejects(begin(input),e=>e.status===409);state=next;
    });
    await check('edit truncates descendants, canceled replies survive and expired leases recover',async()=>{
        state=await begin({conversationId:state.id,version:state.version,replaceFrom:state.messages[0].id,text:'Sửa câu hỏi'});
        assert.equal(state.messages.length,2);
        await assert.rejects(store.remove(owner,state.id),e=>e.status===409);
        await pool.query('UPDATE support_conversations SET lease_until=0 WHERE id=?',[state.id]);
        assert.equal((await store.get(owner,state.id)).messages.at(-1).status,'failed');
        await store.finish(owner,state,{text:'Dở dang',status:'cancelled'});
        assert.equal((await store.get(owner,state.id)).messages.at(-1).status,'cancelled');
    });
    let ticket;
    await check('handoff idempotency, one agent wins, tenant-safe deletion and retention',async()=>{
        ticket=await store.handoff(owner,state.id,7);
        assert.equal((await store.handoff(owner,state.id,7)).id,ticket.id);
        await assert.rejects(store.handoff('user:8',state.id,8),e=>e.status===404);
        const results=await Promise.allSettled([store.claim(ticket.id,21),store.claim(ticket.id,22)]);
        assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
        const agent=results.find(r=>r.status==='fulfilled').value.agentId;
        assert.equal((await store.claim(ticket.id,agent,true)).status,'resolved');
        await store.remove(owner,state.id);
        assert.equal((await store.queue()).length,0);
        const expired=await begin();await store.finish(owner,expired,{text:'old',status:'complete'});
        await pool.query('UPDATE support_conversations SET expires_at=1 WHERE id=?',[expired.id]);
        await store.cleanup();await assert.rejects(store.get(owner,expired.id),e=>e.status===404);
    });
    process.env.INTERNAL_SECRET=token;
    const delivered=[], requests=[];
    const tools={privateTool:async(name,user)=>({title:'Đơn ứng tuyển của tôi',lines:[`Đơn riêng của tài khoản ${user.id}`],href:'/candidate/cv-post'}),deliver:async ticket=>{delivered.push(ticket.id);}};
    const fallback=createResponder({providers:[],executePublicTool:async()=>({jobs:[]})});
    const responder=async({messages,signal,emit})=>{
        const question=messages.filter(m=>m.role==='user').at(-1).text;requests.push(question);
        if(question==='error')throw Error('Synthetic failure');
        if(question==='slow'){emit('token',{text:'Đang trả lời'});await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});}
        if(question==='partial-error'){emit('token',{text:'Nội dung chưa hoàn chỉnh'});return{text:'Nội dung chưa hoàn chỉnh',status:'failed'};}
        if(question==='Tìm việc React'){
            const cards=[{id:42,name:'Frontend React',company:'Synthetic Test',location:'Hà Nội'}];emit('tool',{name:'search_jobs',jobs:cards});emit('token',{text:'**Kết quả thử nghiệm**'});return{text:'**Kết quả thử nghiệm**',cards,status:'complete'};
        }
        return fallback({messages,signal,emit});
    };
    const service=express();registerSupportRoutes(service,{store,tools,respond:responder});const target=await listen(service);
    const gateway=express();gateway.use(express.json());gateway.use((req,_res,next)=>{req.user=req.headers.authorization==='Bearer test-admin'?{id:21,roleCode:'ADMIN'}:req.headers.authorization==='Bearer test-candidate'?{id:7,roleCode:'CANDIDATE'}:null;next();});
    gateway.use('/api/support',createSupportServiceProxy(target));
    const origin=await listen(gateway);
    const api=async(url,body,authorization='Bearer test-candidate',method=body?'POST':'GET')=>fetch(origin+'/api/support'+url,{method,headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},...(body?{body:JSON.stringify(body)}:{})});
    await check('real HTTP SSE fallback, guest capability, owner access and explicit handoff consent',async()=>{
        const question={requestId:randomUUID(),text:'Tạo CV và ứng tuyển'};
        const response=await api('/turn',question);const stream=await response.text();assert.match(stream,/event: sources/);assert.match(stream,/event: done/);assert.match(stream,/knowledge/);
        const stored=(await(await api('/conversations/'+question.requestId)).json()).data;
        assert.equal(stored.messages.at(-1).status,'complete');
        assert.equal((await api('/conversations/'+question.requestId,undefined,null)).status,404);
        assert.equal((await api('/conversations/'+question.requestId+'/handoff',{consent:false})).status,400);
        ticket=(await(await api('/conversations/'+question.requestId+'/handoff',{consent:true})).json()).data;
        assert.equal((await api('/handoffs')).status,403);
        const claim=(await(await api(`/handoffs/${ticket.id}/claim`,{},'Bearer test-admin')).json()).data;
        assert.equal(claim.agentId,21);assert.equal(claim.delivered,true);
        await api(`/handoffs/${ticket.id}/claim`,{},'Bearer test-admin');assert.equal(delivered.length,1);
    });
    if(process.argv.includes('--browser')) {
        const {build}=legacyRequire('esbuild'),{chromium}=legacyRequire('@playwright/test');
        await fs.mkdir(output,{recursive:true});
        gateway.get('/app.js',(_req,res)=>res.sendFile(path.join(output,'app.js')));gateway.get('/app.css',(_req,res)=>res.sendFile(path.join(output,'app.css')));
        gateway.get('*',(_req,res)=>res.type('html').send('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>'));
        await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route}from'react-router-dom';import SupportChat from './src/components/support/SupportChat';import SupportInbox from './src/components/support/SupportInbox';import SupportHelp from './src/components/support/SupportHelp';import SessionContext from './src/auth/SessionContext';const token=localStorage.getItem('token_user');const user=token==='test-admin'?{id:21,roleCode:'ADMIN'}:token==='test-candidate'?{id:7,roleCode:'CANDIDATE'}:null;createRoot(document.getElementById('root')).render(<BrowserRouter><SessionContext.Provider value={user}><Routes><Route path='/admin/support' element={<SupportInbox/>}/><Route path='/support/help' element={<SupportHelp/>}/><Route path='*' element={<SupportChat/>}/></Routes></SessionContext.Provider></BrowserRouter>);`,resolveDir:path.join(root,'frontend'),loader:'jsx'},bundle:true,outfile:path.join(output,'app.js'),loader:{'.js':'jsx'},define:{'process.env.NODE_ENV':'"production"','process.env.REACT_APP_BACKEND_URL':JSON.stringify(origin)}});
        browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];browserPage=page;
        page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);
        const button=name=>page.getByRole('button',{name,exact:true});const send=async text=>{await page.getByRole('textbox',{name:'Đặt câu hỏi hỗ trợ'}).fill(text);await button('Gửi tin nhắn').click();};
        await check('browser guest send, job cards, regenerate, edit and source links',async()=>{
            await button('Mở chatbot hỗ trợ JobFind').click();await send('Tìm việc React');await page.getByText('Kết quả thử nghiệm',{exact:true}).waitFor();await page.getByRole('link',{name:/Frontend React/}).waitFor();await button('Gửi tin nhắn').waitFor();
            await button('Tạo lại').click();await button('Gửi tin nhắn').waitFor();await button('Sửa câu hỏi').click();await page.getByLabel('Sửa câu hỏi và tạo câu trả lời mới').fill('Tạo CV và ứng tuyển');await button('Gửi lại').click();
            await page.getByText('Chế độ hướng dẫn dự phòng').waitFor();await page.getByRole('link',{name:'Tạo CV và ứng tuyển ↗',exact:true}).waitFor();
            await button('Mở rộng chatbot').click();await page.screenshot({path:path.join(output,'conversation.png')});
        });
        await check('browser partial error, cancellation, reload from MySQL and deletion',async()=>{
            await send('partial-error');await page.getByText('Phản hồi bị gián đoạn · cần thử lại').waitFor();
            await send('slow');await page.getByText('Đang trả lời',{exact:true}).waitFor();await button('Dừng trả lời').click();await page.getByText('Đã dừng · câu trả lời chưa hoàn chỉnh').waitFor();await delay(200);
            await page.reload();await button('Mở chatbot hỗ trợ JobFind').click();await button('Lịch sử trò chuyện').click();await page.getByRole('button',{name:/^Tạo CV và ứng tuyển /}).first().click();await page.getByText('Đã dừng · câu trả lời chưa hoàn chỉnh').waitFor();
            await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'mobile.png')});const box=await page.getByRole('dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);
            await button('Lịch sử trò chuyện').click();await page.getByRole('button',{name:'Xóa Tạo CV và ứng tuyển',exact:true}).click();await page.getByRole('button',{name:'Xóa Tạo CV và ứng tuyển',exact:true}).waitFor({state:'detached'});
        });
        await check('browser private lookup, consent-based handoff and staff inbox',async()=>{
            await page.evaluate(()=>localStorage.setItem('token_user','test-candidate'));await page.goto(origin);await button('Mở chatbot hỗ trợ JobFind').click();await button('Đơn ứng tuyển của tôi').click();await page.getByText('Đơn riêng của tài khoản 7',{exact:true}).waitFor();
            await button('Đóng kết quả tra cứu').click();await send('Tôi cần nhân viên hỗ trợ');await button('Gửi tin nhắn').waitFor();
            await page.getByRole('checkbox',{name:'Đồng ý chia sẻ hội thoại này với nhân viên.'}).check();await button('Chuyển hội thoại cho hỗ trợ').click();await page.getByText('Đã lưu yêu cầu. Đang chờ nhân viên tiếp nhận.').waitFor();
            await page.evaluate(()=>localStorage.setItem('token_user','test-admin'));await page.goto(origin+'/admin/support');await page.getByRole('button',{name:'Tiếp nhận',exact:true}).first().click();await page.getByRole('link',{name:'Mở tin nhắn với người dùng ↗'}).waitFor();
            await page.screenshot({path:path.join(output,'inbox.png')});await page.getByRole('button',{name:'Đánh dấu đã xử lý',exact:true}).click();
            await page.goto(origin+'/support/help#cv');await page.getByRole('heading',{name:'Tạo CV và ứng tuyển',exact:true}).waitFor();assert.deepEqual(errors,[]);
        });
    }
    await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'validation.json'),JSON.stringify({passed,realMysql:true,realBrowser:!!browser,realProvider:false,externalMessagesSent:0,at:new Date().toISOString()},null,2));
    console.log(`PASS ${passed} integration scenarios; synthetic identities/providers, disposable MySQL.`);
} catch(error) {
    if(browserPage) { await browserPage.screenshot({path:path.join(output,'failure.png')}).catch(()=>{}); await fs.writeFile(path.join(output,'failure.txt'),await browserPage.locator('body').innerText()).catch(()=>{}); }
    throw error;
} finally {
    await browser?.close();await Promise.all(servers.map(server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})));await pool?.end();
    if(container){const label=await docker('inspect','--format','{{index .Config.Labels "jobfind.support-test"}}',container);assert.equal(label,token);await docker('stop',container);}
}
