import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { startBrowserFixture } from './fixture.mjs';
import { handleAiResult } from '../../job-core-service/src/libs/aiResultHandler.js';

// Browser exercise of actual components -> Axios -> production Gateway app ->
// Core HTTP controllers/legacy ORM -> owned MySQL. Synthetic auth sessions and
// AI result injection only; no login/provider/queue consumer or deployment.
export async function runJobBrowserJourneys(input) {
    const { pool, check } = input;
    const channel = process.env.JOBFIND_TEST_BROWSER_CHANNEL;
    assert.ok(!channel || ['chrome','msedge'].includes(channel), 'Only installed test browser channels are supported');
    const browser = await chromium.launch({ headless: true, ...(channel && { channel }) });
    let fixture;
    const contexts = [], errors = [], outside = [];
    try {
        fixture = await startBrowserFixture(input);
        const { uiUrl, gatewayUrl, issue } = fixture;
        const user = (id, roleCode, companyId = 3) => ({ id, roleCode, companyId, companyStatusCode:'S1', companyCensorCode:'CS1' });
        const employer = user(8,'EMPLOYER'), company = user(7,'COMPANY'), admin = user(88,'ADMIN',null);
        const session = async (identity, bundle = 'core') => {
            const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, serviceWorkers:'block' }); contexts.push(context);
            await context.route('**/*', route => {
                const url = route.request().url();
                if ([uiUrl,gatewayUrl].includes(new URL(url).origin)) return route.continue();
                outside.push(url); return route.abort();
            });
            const page = await context.newPage(); page.setDefaultTimeout(12000);
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`${uiUrl}/login?bundle=${bundle}`);
            await page.evaluate(({ identity, token }) => { localStorage.setItem('userData',JSON.stringify(identity)); localStorage.setItem('token_user', token); }, { identity, token: issue(identity.id) });
            return page;
        };
        const post = async id => (await pool.query(`SELECT p.*,d.name,d.amount,d.descriptionHTML FROM posts p JOIN detailposts d ON d.id=p.detailPostId WHERE p.id=?`,[id]))[0][0];
        const quota = async () => (await pool.query('SELECT allowPost,allowHotPost FROM companies WHERE id=3'))[0][0];
        const tally = async () => (await pool.query('SELECT (SELECT COUNT(*) FROM posts) AS posts,(SELECT COUNT(*) FROM job_request_keys) AS requestKeys,(SELECT COUNT(*) FROM outbox_events) AS events'))[0][0];
        const state = async id => (await pool.query('SELECT * FROM job_moderation_state WHERE jobId=?',[id]))[0][0];
        const ai = (id, request, approved) => handleAiResult({ type:'moderate_job',jobId:id,moderationRequestId:request,ok:true,result:{approved,reason:'Synthetic browser test result'} }, {eventId:randomUUID(),aggregateId:String(id)});
        const readStorage = (page, key) => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)),key);
        const gotoList = async (page, id) => {
            await page.goto(`${uiUrl}/admin/manage-post/${id}`);
            const row = page.getByRole('row').filter({ has: page.getByRole('cell',{ name:String(id),exact:true }) });
            await expect(row).toBeVisible(); return row;
        };
        const createForm = async (page, name) => {
            await page.goto(`${uiUrl}/admin/add-post`);
            await expect(page.locator('select[name="categoryJobCode"]')).toHaveValue('JOBTYPE-1');
            await page.locator('input[name="name"]').fill(name);
            await page.locator('input[name="amount"]').fill('2');
            await page.locator('.rc-md-editor textarea').fill('Build safe JobFind APIs');
            const date = page.locator('.react-datepicker-wrapper input');
            const future = new Date(Date.now() + 365 * 86400000);
            await date.fill(`${future.getMonth()+1}/${future.getDate()}/${future.getFullYear()}`); await date.press('Tab');
        };
        const waitWrite = async (page, path, action, method = 'POST') => {
            const response = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === method);
            await action(); const received = await response;
            const data = await received.json(); assert.equal(data.errCode,0,JSON.stringify(data)); return data;
        };
        const dropResponse = async (page, pathname, expectedStatus) => {
            let resolve, reject;
            const completed = new Promise((yes,no) => { resolve=yes; reject=no; });
            completed.catch(() => {}); // always observed below; do not leave a rejected route callback
            await page.route('**' + pathname,async route => {
                try {
                    const response = await route.fetch({timeout:10000,maxRetries:0,maxRedirects:0});
                    assert.equal(response.status(),expectedStatus);
                    const body = await response.json(); assert.equal(body.errCode,0);
                    await route.abort('connectionreset'); resolve(body);
                } catch {
                    await route.abort().catch(() => {});
                    reject(new Error('Response-loss fixture did not confirm commit at ' + pathname));
                }
            },{times:1});
            return { completed };
        };
        const page = await session(employer);
        let created, source, request, originalQuota, firstReceipt;
        await check('Browser: real create -> stored receipt -> list -> notes -> editor; Core scope, pending AI and one quota charge stay aligned', async () => {
            originalQuota = await quota();
            await createForm(page,'Browser JobFind lifecycle');
            const result = await waitWrite(page,'/api/jobs',() => page.getByRole('button',{name:'Lưu',exact:true}).click());
            created = result.data.id; await expect(page.getByRole('button',{name:'Xem tin đã tạo'})).toBeVisible();
            firstReceipt = await readStorage(page,'jobfind:core-create:v1:8:3'); assert.equal(firstReceipt.status,'succeeded');
            assert.equal((await quota()).allowPost,originalQuota.allowPost-1);
            assert.equal((await post(created)).statusCode,'PS3'); request = (await state(created)).requestId;
            await page.getByRole('link',{name:'Danh sách kiểm thử'}).click();
            const row = page.getByRole('row').filter({hasText:'Browser JobFind lifecycle'}); await expect(row).toBeVisible();
            await expect(row).toContainText('Chờ kiểm duyệt'); await row.getByRole('link',{name:'Chú thích'}).click();
            await expect(page.getByText('Đã gửi yêu cầu AI kiểm duyệt;', {exact:false})).toBeVisible();
            assert.deepEqual(await readStorage(page,'jobfind:core-create:v1:8:3'),firstReceipt);
            await (await gotoList(page,created)).getByRole('link',{name:'Sửa',exact:true}).click();
            await expect(page.locator('input[name="name"]')).toHaveValue('Browser JobFind lifecycle');
        });
        await check('Browser: approved job metadata edit returns to pending, keeps author/deadline/quota and fences an old AI result; no-op is silent', async () => {
            await ai(created,request,true); source = await post(created);
            await page.reload(); await expect(page.locator('input[name="amount"]')).toHaveValue('2');
            const before = await tally();
            await page.getByRole('button',{name:'Lưu',exact:true}).click();
            await expect(page.getByText(/Không có thay đổi/).first()).toBeVisible(); assert.deepEqual(await tally(),before);
            await page.locator('input[name="amount"]').fill('3');
            await waitWrite(page,`/api/jobs/${created}`,() => page.getByRole('button',{name:'Lưu',exact:true}).click(),'PUT');
            await expect(page.locator('input[name="amount"]')).toHaveValue('3');
            const edited = await post(created); assert.equal(edited.statusCode,'PS3'); assert.equal(edited.amount,3);
            for (const field of ['userId','timeEnd','isHot']) assert.equal(edited[field],source[field]);
            assert.equal((await quota()).allowPost,originalQuota.allowPost-1);
            assert.notEqual((await state(created)).requestId,request);
            await ai(created,request,true); assert.equal((await post(created)).statusCode,'PS3');
            const row = await gotoList(page,created); await expect(row).toContainText('Chờ kiểm duyệt');
        });
        await check('Browser: ADMIN uses actual legacy list/manual note; recruiter review sees cancellation and note without changing the Core create receipt', async () => {
            const moderator = await session(admin);
            const row = await gotoList(moderator,created);
            await row.getByRole('button',{name:'Từ chối',exact:true}).click();
            await moderator.getByPlaceholder('Giải thích lý do cho nhà tuyển dụng').fill('Browser manual review: clarify the role');
            await waitWrite(moderator,'/api/accept-post',() => moderator.getByRole('button',{name:'Hoàn thành',exact:true}).click(),'PUT');
            assert.equal((await post(created)).statusCode,'PS2'); assert.equal((await state(created)).state,'cancelled');
            await (await gotoList(page,created)).getByRole('link',{name:'Chú thích'}).click();
            await expect(page.getByText('Browser manual review: clarify the role',{exact:true})).toBeVisible();
            await expect(page.getByText(/Không có yêu cầu AI hiện hành/)).toBeVisible();
            assert.deepEqual(await readStorage(page,'jobfind:core-create:v1:8:3'),firstReceipt);
        });
        await check('Browser: expired repost copies saved source, not draft, consumes one slot and navigates to its independent pending copy', async () => {
            // Time passage is arranged only in owned fixture data; not a product API.
            await pool.query('UPDATE posts SET timeEnd=? WHERE id=?',[String(Date.now()-86400000),created]);
            await (await gotoList(page,created)).getByRole('link',{name:'Sửa',exact:true}).click();
            await expect(page.locator('input[name="name"]')).toHaveValue('Browser JobFind lifecycle');
            await page.locator('input[name="name"]').fill('Unsaved draft must not be reposted');
            await page.getByRole('button',{name:'Đăng lại',exact:true}).click();
            const result = await waitWrite(page,`/api/jobs/${created}/repost`,() => page.getByRole('button',{name:'Hoàn thành',exact:true}).click());
            const copy = await post(result.data.id); assert.notEqual(copy.id,created); assert.equal(copy.name,'Browser JobFind lifecycle'); assert.equal(copy.statusCode,'PS3');
            assert.equal((await quota()).allowPost,originalQuota.allowPost-2);
            await expect(page.locator('input[name="name"]')).toHaveValue('Unsaved draft must not be reposted');
            await page.getByRole('button',{name:'Xem tin đăng lại'}).click();
            await expect(page).toHaveURL(new RegExp(`/admin/edit-post/${copy.id}/?$`));
            await expect(page.locator('input[name="name"]')).toHaveValue(copy.name);
        });
        await check('Browser: lost create response survives list/reload/legacy bundle; explicit reconciliation uses the original Core key with no second charge', async () => {
            const lost = await session(company); await createForm(lost,'Browser lost creation');
            const before = await tally(), balance = await quota();
            const loss = await dropResponse(lost,'/api/jobs',201);
            await lost.getByRole('button',{name:'Lưu',exact:true}).click();
            const accepted = await loss.completed;
            await expect(lost.getByRole('button',{name:'Đối chiếu / gửi lại cùng mã'})).toBeEnabled();
            const saved = await readStorage(lost,'jobfind:core-create:v1:7:3'); assert.equal(saved.status,'pending');
            assert.equal((await tally()).posts,before.posts+1); assert.equal((await quota()).allowPost,balance.allowPost-1);
            await gotoList(lost,accepted.data.id); assert.deepEqual(await readStorage(lost,'jobfind:core-create:v1:7:3'),saved);
            await lost.goto(`${uiUrl}/admin/add-post?bundle=legacy`);
            await expect(lost.getByRole('button',{name:'Đối chiếu / gửi lại cùng mã'})).toBeVisible();
            const stable = await tally(); assert.equal(stable.posts,before.posts+1);
            const response = await waitWrite(lost,'/api/jobs',() => lost.getByRole('button',{name:'Đối chiếu / gửi lại cùng mã'}).click());
            assert.equal(response.data.id,accepted.data.id); await expect(lost.getByRole('button',{name:'Xem tin đã tạo'})).toBeVisible();
            assert.deepEqual(await tally(),stable); assert.equal((await readStorage(lost,'jobfind:core-create:v1:7:3')).key,saved.key);
        });
        await check('Browser: committed edit with a lost response stays pending across workspace and legacy bundle; confirmed private GET reconciles without PUT replay', async () => {
            await page.goto(`${uiUrl}/admin/edit-post/${created}`); await expect(page.locator('input[name="amount"]')).toHaveValue('3');
            let writes = 0; page.on('request',req => { if (req.method()==='PUT' && new URL(req.url()).pathname===`/api/jobs/${created}`) writes++; });
            const loss = await dropResponse(page,`/api/jobs/${created}`,200);
            await page.locator('input[name="amount"]').fill('4'); await page.getByRole('button',{name:'Lưu',exact:true}).click();
            await loss.completed;
            await expect(page.getByText(/Không tự gửi lại hoặc đổi sang luồng cũ/)).toBeVisible();
            await expect(page.getByRole('button',{name:'Tải lại tin',exact:true})).toBeVisible();
            const key = `jobfind:core-edit:v1:8:3:${created}`;
            await expect.poll(() => readStorage(page,key)).not.toBeNull(); const saved = await readStorage(page,key);
            await gotoList(page,created); assert.deepEqual(await readStorage(page,key),saved);
            await page.goto(`${uiUrl}/admin/edit-post/${created}?bundle=legacy`);
            await expect(page.locator('input[name="amount"]')).toHaveValue('4'); assert.equal(writes,1);
            await page.getByRole('button',{name:'Tải lại tin',exact:true}).click();
            await page.getByRole('button',{name:'Bỏ phần chưa lưu và tải lại'}).click();
            await expect.poll(() => readStorage(page,key)).toBeNull(); assert.equal(writes,1); assert.equal((await post(created)).amount,4);
        });
        await check('Browser: lost repost remains pinned to Core after visiting notes and loading the legacy bundle; retry preserves source/revision/date/key and quota', async () => {
            const lost = await session(company); await lost.goto(`${uiUrl}/admin/edit-post/${created}`);
            await expect(lost.locator('input[name="amount"]')).toHaveValue('4');
            const before = await quota(), loss = await dropResponse(lost,`/api/jobs/${created}/repost`,201);
            await lost.getByRole('button',{name:'Đăng lại',exact:true}).click();
            await lost.getByRole('button',{name:'Hoàn thành',exact:true}).click();
            const received = await loss.completed;
            await expect(lost.getByRole('button',{name:'Đối chiếu đăng lại cùng mã'})).toBeEnabled();
            const key = `jobfind:core-repost:v1:7:3:${created}`, saved = await readStorage(lost,key);
            assert.equal(saved.status,'pending'); assert.equal((await quota()).allowPost,before.allowPost-1);
            await lost.goto(`${uiUrl}/admin/note/${received.data.id}`); await expect(lost.getByText(/Đã gửi yêu cầu AI kiểm duyệt/)).toBeVisible();
            assert.deepEqual(await readStorage(lost,key),saved);
            await lost.goto(`${uiUrl}/admin/edit-post/${created}?bundle=legacy`);
            await expect(lost.getByRole('button',{name:'Đối chiếu đăng lại cùng mã'})).toBeEnabled();
            const stable = await tally();
            const result = await waitWrite(lost,`/api/jobs/${created}/repost`,() => lost.getByRole('button',{name:'Đối chiếu đăng lại cùng mã'}).click());
            assert.equal(result.data.id,received.data.id); await expect(lost.getByRole('button',{name:'Xem tin đăng lại'})).toBeVisible();
            const reconciled = await readStorage(lost,key);
            assert.equal(reconciled.key,saved.key); assert.deepEqual(reconciled.payload,saved.payload); assert.deepEqual(reconciled.expected,saved.expected);
            assert.deepEqual(await tally(),stable); assert.equal((await quota()).allowPost,before.allowPost-1);
        });
        await check('Browser: previously submitted legacy create is not sent to Core after loading the Core bundle', async () => {
            const lost = await session(company,'legacy'); await createForm(lost,'Browser legacy intent');
            const loss = await dropResponse(lost,'/api/create-new-post',200);
            await lost.getByRole('button',{name:'Lưu',exact:true}).click(); const accepted = await loss.completed;
            await expect(lost.getByRole('button',{name:'Đối chiếu / gửi lại cùng mã'})).toBeEnabled();
            const before = await tally(), balance = await quota();
            await lost.goto(`${uiUrl}/admin/add-post?bundle=core`);
            await expect(lost.getByRole('button',{name:'Đối chiếu / gửi lại cùng mã'})).toBeEnabled();
            const result = await waitWrite(lost,'/api/create-new-post',() => lost.getByRole('button',{name:'Đối chiếu / gửi lại cùng mã'}).click());
            assert.equal(result.postId,accepted.postId); assert.equal(result.idempotencyKey,accepted.idempotencyKey);
            await expect(lost.getByRole('button',{name:'Xem tin đã tạo'})).toBeVisible(); assert.deepEqual(await tally(),before); assert.deepEqual(await quota(),balance);
            assert.equal(await state(result.postId),undefined); // legacy stays manual, no AI generation
        });
        await check('Browser: Core read outage hides stale review and never falls back; explicit reload recovers', async () => {
            const reader = await session(employer); await reader.goto(`${uiUrl}/admin/note/${created}`);
            await expect(reader.getByText('Browser manual review: clarify the role',{exact:true})).toBeVisible();
            const requests = []; reader.on('request',req => requests.push(new URL(req.url()).pathname));
            await pool.query('RENAME TABLE job_moderation_state TO browser_saved_moderation_state');
            try {
                await reader.getByRole('button',{name:'Tải lại thông tin kiểm duyệt'}).click(); await expect(reader.getByRole('alert')).toBeVisible();
                await expect(reader.getByText('Browser manual review: clarify the role',{exact:true})).toHaveCount(0);
                assert.ok(!requests.some(path => path.includes('get-note') || path.includes('/search')));
            } finally { await pool.query('RENAME TABLE browser_saved_moderation_state TO job_moderation_state'); }
            await reader.getByRole('button',{name:'Tải lại thông tin kiểm duyệt'}).click();
            await expect(reader.getByText('Browser manual review: clarify the role',{exact:true})).toBeVisible();
        });
        await check('Browser/API: candidate/foreign tenant/header forgery/admin workspace cannot bypass current Gateway identity or leak private review', async () => {
            const foreign = await session(user(99,'COMPANY',4)), candidate = await session(user(26,'CANDIDATE',null));
            await candidate.goto(`${uiUrl}/admin/manage-post`); await expect(candidate).toHaveURL(/\/forbidden$/);
            const api = async (actor, headers={}) => {
                const response = await fetch(`${gatewayUrl}/api/jobs/${created}/review`,{ headers:{authorization:`Bearer ${issue(actor)}`,...headers},signal:AbortSignal.timeout(10000) });
                assert.equal(response.headers.get('cache-control'),'private, no-store'); return {status:response.status,body:await response.json()};
            };
            for (const [id,status] of [[26,403],[99,404],[88,403]]) {
                const response = await api(id,{'x-user-role':'ADMIN','x-company-id':'3','x-user-id':'8','x-internal-secret':'forged'});
                assert.equal(response.status,status); assert.ok(!response.body.data && !response.body.count);
            }
            await foreign.goto(`${uiUrl}/admin/note/${created}`); await expect(foreign.getByRole('alert')).toBeVisible();
            await expect(foreign.getByText('Browser manual review: clarify the role',{exact:true})).toHaveCount(0);
        });
        await check('Browser: membership change hides stale list without fallback; expired token redirects and preserves pending intent evidence', async () => {
            const current = await session(company); await gotoList(current,created);
            await pool.query('UPDATE users SET companyId=4 WHERE id=7');
            try {
                await current.goto(`${uiUrl}/admin/manage-post`); await expect(current.getByRole('alert')).toBeVisible();
                await expect(current.getByRole('cell',{name:'Browser JobFind lifecycle',exact:true})).toHaveCount(0);
            } finally { await pool.query('UPDATE users SET companyId=3 WHERE id=7'); }
            await createForm(current,'Browser expiry pending intent');
            const loss = await dropResponse(current,'/api/jobs',201);
            await current.getByRole('button',{name:'Lưu',exact:true}).click();
            await loss.completed;
            await expect(current.getByRole('button',{name:'Đối chiếu / gửi lại cùng mã'})).toBeEnabled();
            const key = 'jobfind:core-create:v1:7:3', saved = await readStorage(current,key); assert.equal(saved.status,'pending');
            await current.evaluate(token => localStorage.setItem('token_user',token),issue(7,true));
            await current.goto(`${uiUrl}/admin/note/${created}`); await expect(current).toHaveURL(/\/login\?reason=expired$/);
            assert.equal(await current.evaluate(() => localStorage.getItem('token_user')),null);
            assert.deepEqual(await readStorage(current,key),saved);
        });
        await check('Browser: runtime has no uncaught page errors or external network requests', async () => {
            assert.deepEqual(errors,[]); assert.deepEqual(outside,[]);
        });
        console.log('Browser journeys passed: actual three pages/router/HTTP/Gateway/JWT/Redis/Core/legacy ORM; synthetic login session and AI results, not full Compose/provider E2E.');
    } catch (error) {
        console.error('Browser runtime errors:', errors);
        for (const context of contexts) for (const page of context.pages()) {
            console.error('Synthetic page at failure:', new URL(page.url()).pathname,
                (await page.locator('body').innerText().catch(() => '')).slice(-2200));
        }
        throw error;
    } finally {
        try {
            for (const context of contexts) {
                for (const page of context.pages()) await page.unrouteAll({behavior:'ignoreErrors'});
                await context.close();
            }
        } finally { try { await browser.close(); } finally { await fixture?.stop(); } }
    }
}
