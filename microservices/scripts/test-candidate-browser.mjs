import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium, expect } from 'playwright/test';

// Tests a production build with REACT_APP_JOB_SEARCH_MODE=core,
// REACT_APP_CANDIDATE_AI_ENABLED=true and REACT_APP_APPLICATION_PROGRESS_ENABLED=true.
// All API requests are fulfilled in the browser; no backend/provider is contacted.
const build = fileURLToPath(new URL('../../frontend/build/',import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(),'jobfind-candidate-ui-'));
const app=express();app.use(express.static(build));app.get('*',(_req,res)=>res.sendFile(path.join(build,'index.html')));
const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser=await chromium.launch({headless:true,...(process.env.JOBFIND_TEST_BROWSER_CHANNEL && {channel:process.env.JOBFIND_TEST_BROWSER_CHANNEL})});
    const context=await browser.newContext({viewport:{width:1280,height:1000}});
    const user={id:8,roleCode:'CANDIDATE',firstName:'Synthetic',lastName:'Candidate',image:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="20" fill="%23246b53"/></svg>'};
    await context.addInitScript(user=>{localStorage.setItem('userData',JSON.stringify(user));localStorage.setItem('token_user','synthetic-ui-token');},user);
    let creates=0, cvs=[], taskType='parse_resume', progressFailure=false;const requests=[];const errors=[];
    const parsed={title:'Developer',fullName:'Synthetic Candidate',email:'candidate@example.invalid',phone:null,address:null,summary:'Node services',
        skills:['Node'],languages:['Vietnamese'],experiences:[{company:'Example',position:'Developer',duration:'2024–2026',description:'Services'}],educations:[],yearsOfExperience:2};
    await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if (url.pathname.startsWith('/api/')) {
            const method=request.method();requests.push({path:url.pathname,method,query:url.search});
            const reply=body=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
            if(method==='OPTIONS') return reply({});
            if(url.pathname==='/api/auth/me')return reply({errCode:0,data:{userId:8,roleCode:'CANDIDATE',companyId:null}});
            if(url.pathname==='/api/get-all-cv-by-userId')return reply({errCode:0,count:2,data:[
                {id:12,userId:8,postId:7,isChecked:0,createdAt:'2026-09-09T00:00:00Z',postCvData:{id:7,postDetailData:{name:'Submitted synthetic job'}}},
                {id:13,userId:8,postId:8,isChecked:1,createdAt:'2026-09-08T00:00:00Z',postCvData:null}]});
            if(url.pathname==='/api/my-applications')return reply(progressFailure?{errCode:503}:{errCode:0,count:1,data:[{id:'900',legacy_cv_id:12,job_id:7,stage:'phong_van'}]});
            if(url.pathname==='/api/profile/cvs'){
                if(method==='POST'){cvs.push({...request.postDataJSON(),_id:'507f1f77bcf86cd799439011'});return reply({errCode:0,data:cvs.at(-1)});}
                return reply({errCode:0,data:cvs,count:cvs.length});
            }
            if(url.pathname.startsWith('/api/ai/tasks/'))return reply({errCode:0,data:{id:'task-browser',type:taskType,status:'done',result:taskType==='parse_resume'?parsed:{letter:'Synthetic application letter.'}}});
            if(url.pathname.startsWith('/api/ai/') && method==='POST'){
                creates++;taskType=url.pathname.endsWith('parse-resume')?'parse_resume':'cover_letter';return reply({errCode:0,taskId:'task-browser'});
            }
            if(url.pathname==='/api/get-all-code')return reply({errCode:0,data:[{code:url.searchParams.get('type')+'-1',value:'Synthetic '+url.searchParams.get('type')} ]});
            if(url.pathname==='/api/search/jobs')return reply({errCode:0,count:1,data:[{id:7,name:'Synthetic Search Job',statusCode:'PS1',companyName:'Synthetic Company',timePost:String(Date.now()),salaryJobCode:'SALARYTYPE-1'}]});
            return reply({errCode:0,data:[],count:0});
        }
        if (url.origin===origin) return route.continue();
        return route.abort();
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/candidate/ai-cv');
    await expect(page.getByRole('heading',{name:'CV và trợ lý AI'})).toBeVisible();
    await page.getByLabel('Tệp CV PDF (tối đa 5 MiB)').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nSynthetic')});
    await page.getByRole('button',{name:'Gửi yêu cầu AI',exact:true}).click();
    await expect(page.getByRole('button',{name:'Xem và chỉnh sửa toàn bộ CV'})).toBeVisible();assert.equal(creates,1);
    await page.getByRole('button',{name:'Xem và chỉnh sửa toàn bộ CV'}).click();
    await expect(page.getByLabel('Họ và tên',{exact:true})).toHaveValue('Synthetic Candidate');
    await expect(page.getByLabel('Từ 1',{exact:true})).toHaveValue('2024–2026');
    await page.getByRole('button',{name:'Tải danh sách CV',exact:true}).click();
    await page.getByRole('button',{name:'Lưu CV',exact:true}).click();await expect(page.getByRole('button',{name:'Xóa CV',exact:true})).toBeEnabled();
    assert.equal(cvs.length,1);
    await page.reload();await page.getByRole('button',{name:'Xem / tiếp tục chờ kết quả'}).click();
    await expect(page.getByRole('button',{name:'Xem và chỉnh sửa toàn bộ CV'})).toBeVisible();assert.equal(creates,1);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(directory,'candidate-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'candidate mobile must not overflow');
    await expect.poll(()=>page.locator('.candidate-ai-panel').first().evaluate(element=>element.getBoundingClientRect().width),{message:'mobile form must use the available screen width'}).toBeGreaterThanOrEqual(300);
    await page.screenshot({path:path.join(directory,'candidate-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'Tác vụ mới',exact:true}).click();
    await page.getByLabel('Chức năng').selectOption('cover_letter');
    await page.getByLabel('Nội dung CV',{exact:true}).fill('Synthetic Node experience');
    await page.getByLabel('Mã công việc',{exact:true}).fill('7');
    await page.getByRole('button',{name:'Gửi yêu cầu AI',exact:true}).click();
    const letter=page.getByRole('textbox',{name:'Thư ứng tuyển (có thể chỉnh sửa)',exact:true});
    await expect(letter).toHaveValue('Synthetic application letter.');
    await letter.fill('Edited by candidate.');await expect(letter).toHaveValue('Edited by candidate.');assert.equal(creates,2);
    await page.goto(origin+'/job');await expect(page.getByText('Synthetic Search Job',{exact:true})).toBeVisible();
    assert.ok(requests.some(row=>row.path==='/api/search/jobs'));assert.ok(!requests.some(row=>row.path==='/api/get-filter-post'));
    await page.goto(origin+'/candidate/cv-post');
    await expect(page.getByText('Phỏng vấn',{exact:true})).toBeVisible();
    await expect(page.getByText('Đang chờ đồng bộ',{exact:true})).toBeVisible();
    await expect(page.getByText('Tin tuyển dụng không còn thông tin',{exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'Xem CV đã nộp'}).first()).toHaveAttribute('href','/candidate/cv-detail/12');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'application history mobile must not overflow');
    await page.screenshot({path:path.join(directory,'application-history-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1280,height:1000});await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(directory,'application-history-desktop.png'),fullPage:true});
    progressFailure=true;await page.getByRole('button',{name:'Tải lại hồ sơ'}).click();await expect(page.getByText('Chưa tải được tiến trình',{exact:true}).first()).toBeVisible();
    await expect(page.getByText('Submitted synthetic job',{exact:true})).toBeVisible();
    progressFailure=false;await page.getByRole('button',{name:'Tải lại hồ sơ'}).click();await expect(page.getByText('Phỏng vấn',{exact:true})).toBeVisible();
    assert.deepEqual(errors,[]);
    console.log('PASS: production browser AI/CV, cover letter, Core search, application stages/history, progress outage and recovery, mobile layout');
    if (process.env.JOBFIND_KEEP_UI_SCREENSHOT === '1') console.log('Screenshot: '+path.join(directory,'candidate-desktop.png'));
} finally {
    await browser?.close();await new Promise(resolve=>server.close(resolve));
    if (process.env.JOBFIND_KEEP_UI_SCREENSHOT !== '1') {
        assert.ok(path.basename(directory).startsWith('jobfind-candidate-ui-'));
        await rm(directory,{recursive:true,force:true});
    }
}
