// Real ChatPage + actual API/SQL/socket. Only authentication bootstrap and fixture
// seed are test-specific. No network route mocking or replacement chat component.
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { chromium, firefox, webkit, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../../..');
exports.build = async () => {
    const assets = path.join(root, '.local/websocket-checks/browser-assets');
    await fs.mkdir(assets, {recursive:true});
    await require('esbuild').build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client';
        import {BrowserRouter,Routes,Route} from 'react-router-dom'; import ChatPage from './src/container/Chat/ChatPage';
        import {ToastContainer} from 'react-toastify';
        import './src/css/App.css';
        createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path='/chat/:partnerId' element={<ChatPage/>}/></Routes><ToastContainer/></BrowserRouter>);`,
        resolveDir:path.join(root,'frontend'),loader:'jsx'}, bundle:true, outfile:path.join(assets,'app.js'), loader:{'.js':'jsx'},
        define:{'process.env.REACT_APP_BACKEND_URL':JSON.stringify('/'), 'process.env.PUBLIC_URL':JSON.stringify(''), 'process.env.NODE_ENV':JSON.stringify('production')},logLevel:'warning'});
    require(path.join(root, 'frontend/scripts/copy-pdf-assets.cjs'));
    await fs.cp(path.join(root, 'frontend/public/pdfjs'), path.join(assets, 'pdfjs'), { recursive: true });
    await fs.copyFile(path.join(root,'frontend/public/push-sw.js'),path.join(assets,'push-sw.js'));
    await fs.writeFile(path.join(assets,'index.html'),`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}button{cursor:pointer;padding:8px}input{padding:10px;min-width:0;flex:1}a{text-decoration:none}</style><div id="root"></div><script src="/app.js"></script></html>`);
    return assets;
};
exports.run = async ({url,db,tokenFor}) => {
    let id=100;
    for (const [engine, launcher] of Object.entries({chromium,firefox,webkit})) {
        const adminId=id++,candidateId=id++;
        await db.User.bulkCreate([{id:adminId,firstName:'Support'}, {id:candidateId,firstName:'Candidate'}]);
        await db.Account.bulkCreate([{userId:adminId,roleCode:'ADMIN',statusCode:'S1'},{userId:candidateId,roleCode:'CANDIDATE',statusCode:'S1'}]);
        await db.ChatMessage.bulkCreate(Array.from({length:240},(_,i)=>({senderId:adminId,receiverId:candidateId,content:`${engine} history ${i}`,isRead:0})));
        const browser=await launcher.launch({headless:true});
        const errors=[];
        try {
            const context = await browser.newContext({viewport:{width:1365,height:900}});
            await context.addInitScript(({id,token})=>{localStorage.setItem('userData',JSON.stringify({id,roleCode:'CANDIDATE'}));localStorage.setItem('token_user',token);},{id:candidateId,token:tokenFor(candidateId)});
            const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
            await page.goto(`${url}/chat/${adminId}`);
            await expect(page.getByText(`${engine} history 239`,{exact:true}).first()).toBeVisible();
            const older=page.getByRole('button',{name:'Xem tin nhắn cũ'});
            await older.click(); await expect(page.getByText(`${engine} history 40`,{exact:true})).toBeAttached();
            await older.click(); await expect(page.getByText(`${engine} history 0`,{exact:true})).toBeAttached();
            await expect(older).toHaveCount(0);
            const input=page.getByPlaceholder('Nhập tin nhắn...');
            const content=`${engine} <img src=x onerror=alert(1)> ' OR 1=1 --`;
            await input.fill(content);await page.getByRole('button',{name:'Gửi tin nhắn',exact:true}).click();
            await expect(input).toHaveValue('');
            assert.equal(await db.ChatMessage.count({where:{senderId:candidateId,content}}),1);
            assert.equal(await page.locator('[role="log"] img').count(),0);
            // A second real browser context receives typing/message/read events.
            const other=await browser.newContext();
            await other.addInitScript(({id,token})=>{localStorage.setItem('userData',JSON.stringify({id,roleCode:'ADMIN'}));localStorage.setItem('token_user',token);},{id:adminId,token:tokenFor(adminId)});
            const peer=await other.newPage();await peer.goto(`${url}/chat/${candidateId}`);
            await expect(peer.getByText(content,{exact:true}).first()).toBeVisible();
            await peer.getByPlaceholder('Nhập tin nhắn...').fill(`${engine} live reply`);
            await expect(page.getByText('đang soạn tin nhắn...')).toBeVisible({timeout:6000});
            await peer.getByRole('button',{name:'Gửi tin nhắn',exact:true}).click();
            await expect(page.getByRole('log').getByText(`${engine} live reply`,{exact:true})).toBeVisible();
            await expect(peer.getByText('Đã xem',{exact:true})).toBeVisible({timeout:8000});
            // Drop networking and seed 260 committed messages with no broadcast:
            // reconnect must fetch the missing DB interval beyond the latest page.
            await context.setOffline(true);
            await db.ChatMessage.bulkCreate(Array.from({length:260},(_,i)=>({senderId:adminId,receiverId:candidateId,content:`${engine} missed ${i}`,isRead:0})));
            await context.setOffline(false);
            await expect(page.getByRole('log').getByText(`${engine} missed 0`,{exact:true})).toBeAttached({timeout:20000});
            await expect(page.getByRole('log').getByText(`${engine} missed 259`,{exact:true})).toBeAttached();
            assert.equal(await page.getByRole('log').locator('.chat-bubble').count(),502);
            await expect(page.locator('.chat-sidebar').getByText('260',{exact:true})).toHaveCount(0);
            await expect(page.getByText(/Đang trực tuyến|Đang kết nối trực tiếp|Người nhận đang ngoại tuyến|Hoạt động lúc/)).toBeVisible({timeout:45000});
            await page.setViewportSize({width:390,height:844});
            await expect(input).toBeVisible();
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
            await page.screenshot({path:path.join(root,`.local/websocket-checks/chat-${engine}-mobile.png`)});
            await page.setViewportSize({width:1365,height:900});
            await page.screenshot({path:path.join(root,`.local/websocket-checks/chat-${engine}-desktop.png`)});
            await other.close();await context.close();assert.deepEqual(errors,[]);
            console.log(`PASS browser ${engine}: history, send once, safe text, typing, cross-context receive/read, 260-message offline catch-up, mobile width, no JS errors`);
        } finally {await browser.close();}
    }
};
