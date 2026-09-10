import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { chromium, expect } from 'playwright/test';

// Tests a production build with REACT_APP_JOB_SEARCH_MODE=core,
// REACT_APP_CANDIDATE_AI_ENABLED=true, REACT_APP_APPLICATION_PROGRESS_ENABLED=true
// and REACT_APP_PREPARED_CV_APPLICATION_ENABLED=true.
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
    // Only seed the top-level document. PDF preview frames must not overwrite
    // the refreshed session or dispatch a cross-document storage change.
    await context.addInitScript(user=>{if(window.top!==window)return;localStorage.setItem('userData',JSON.stringify(user));localStorage.setItem('token_user','synthetic-ui-token');},user);
    let creates=0, cvs=[], taskType='parse_resume', progressFailure=false;const requests=[];const errors=[];const submissions=[];
    const parsed={title:'Developer',fullName:'Synthetic Candidate',email:'candidate@example.invalid',phone:null,address:null,summary:'Node services',
        skills:['Node'],languages:['Vietnamese'],experiences:[{company:'Example',position:'Developer',duration:'2024–2026',description:'Services'}],educations:[],yearsOfExperience:2};
    await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if (url.pathname.startsWith('/api/')) {
            const method=request.method();requests.push({path:url.pathname,method,query:url.search});
            const reply=body=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
            if(method==='OPTIONS') return reply({});
            if(url.pathname==='/api/auth/me')return reply({errCode:0,data:{userId:8,roleCode:'CANDIDATE',companyId:null}});
            if(url.pathname==='/api/get-detail-post-by-id')return reply({errCode:0,data:{id:7,userId:10,timeEnd:Date.now()+86400000,
                companyData:{id:3,name:'Công ty thử nghiệm',website:'https://example.invalid',address:'Đà Nẵng',amountEmployer:10},
                postDetailData:{name:'Kỹ sư phần mềm',descriptionHTML:'<p>Công việc dùng cho kiểm thử.</p>',
                    jobTypePostData:{value:'Công nghệ'},provincePostData:{value:'Đà Nẵng'},workTypePostData:{value:'Toàn thời gian'},expTypePostData:{value:'3 năm'},salaryTypePostData:{value:'Thỏa thuận'}}}});
            if(url.pathname==='/api/get-detail-user-by-id')return reply({errCode:0,data:{userAccountData:{userSettingData:{file:''}}}});
            if(url.pathname==='/api/create-new-cv' && method==='POST') {
                submissions.push(request.postDataJSON());return reply(submissions.length===1?{errCode:0,cvId:12}:{errCode:5,httpStatus:409,cvId:12});
            }
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
    await page.getByLabel('Họ và tên',{exact:true}).fill('Nguyễn Thị Ánh');
    await page.getByRole('textbox',{name:/^Giới thiệu/}).fill(('Tôi xây dựng hệ thống xử lý hồ sơ đáng tin cậy, kiểm tra quyền truy cập và bảo vệ dữ liệu ứng viên.\n').repeat(28)+'DÒNG KẾT THÚC GIỚI THIỆU');
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
    await page.goto(origin+'/detail-job/7/');
    await expect(page.getByRole('heading',{name:'Kỹ sư phần mềm',exact:true})).toBeVisible({timeout:10000}).catch(async failure=>{
        console.log('Job detail errors: '+JSON.stringify(errors));console.log('Job detail text: '+(await page.locator('body').innerText()).slice(0,1800));throw failure;
    });
    await page.getByRole('button',{name:/Nộp CV ngay/}).first().click();
    const modal=page.getByRole('dialog'); await expect(modal).toBeVisible();
    await modal.getByLabel('CV đã chuẩn bị',{exact:true}).check();
    await modal.getByLabel('CV đã lưu',{exact:true}).selectOption('507f1f77bcf86cd799439011');
    await modal.getByLabel('Lời giới thiệu',{exact:true}).fill('Tôi muốn ứng tuyển vị trí kỹ sư phần mềm.');
    await expect(modal.getByRole('button',{name:'Gửi hồ sơ',exact:true})).toBeDisabled();
    await modal.getByRole('button',{name:'Tạo bản PDF để xem lại'}).click();
    const pdfLink=modal.getByRole('link',{name:'Mở bản PDF sẽ gửi'}); await expect(pdfLink).toBeVisible({timeout:15000}).catch(async failure=>{
        console.log('PDF preview errors: '+JSON.stringify(errors));console.log('Modal text: '+await page.locator('.send-cv-modal').allTextContents());
        await page.screenshot({path:path.join(directory,'prepared-application-failure.png'),fullPage:true});
        console.log('Failed preview screenshot: '+directory);throw failure;
    });
    const pdfUrl=await pdfLink.getAttribute('href');
    const pdfBytes=Buffer.from(await page.evaluate(async url=>Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),pdfUrl));
    assert.ok(pdfBytes.subarray(0,5).toString()==='%PDF-');assert.ok(pdfBytes.length<=2*1024*1024);
    await writeFile(path.join(directory,'prepared-application.pdf'),pdfBytes);
    await pdfLink.scrollIntoViewIfNeeded();
    await expect(modal.getByRole('button',{name:'Gửi hồ sơ',exact:true})).toBeInViewport({ratio:1});
    await expect(modal.getByRole('button',{name:'Hủy',exact:true})).toBeInViewport({ratio:1});
    await page.screenshot({path:path.join(directory,'prepared-application-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await modal.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'application modal mobile must not overflow');
    await pdfLink.scrollIntoViewIfNeeded();
    await expect(modal.getByRole('button',{name:'Gửi hồ sơ',exact:true})).toBeInViewport({ratio:1});
    await expect(modal.getByRole('button',{name:'Hủy',exact:true})).toBeInViewport({ratio:1});
    await page.screenshot({path:path.join(directory,'prepared-application-mobile.png')});
    assert.equal(submissions.length,0,'Preview must not submit an application');
    // Editing the source after preview cannot change the reviewed attachment.
    cvs[0]={...cvs[0],fullName:'A later edit must not replace the reviewed PDF'};
    await modal.getByLabel('Tôi đã xem và chọn bản PDF này để ứng tuyển').check();
    await modal.getByRole('button',{name:'Gửi hồ sơ',exact:true}).click();await expect(modal).not.toBeVisible();
    assert.equal(submissions.length,1);assert.equal(String(submissions[0].postId),'7');assert.equal(submissions[0].userId,8);
    assert.equal(submissions[0].file,'data:application/pdf;base64,'+pdfBytes.toString('base64'));
    assert.deepEqual(Object.keys(submissions[0]).sort(),['description','file','postId','userId']);assert.equal(creates,2,'Preparing or submitting a saved CV does not call AI');
    assert.deepEqual(errors,[]);
    if (process.env.JOBFIND_VERIFY_PREPARED_CV_DELIVERY === '1') {
        const delivery = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./test-application-sync.mjs', import.meta.url))], {
            cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 * 1024,
            env: { ...process.env, JOBFIND_APPLICATION_TEST_PDF: path.join(directory, 'prepared-application.pdf') }
        });
        console.log(delivery.stdout);
    }
    console.log('PASS: production browser AI/CV, cover letter, Core search, application stages/history, progress outage and recovery, reviewed prepared CV PDF -> exact submitted bytes, mobile layout');
    if (process.env.JOBFIND_KEEP_UI_SCREENSHOT === '1') console.log('Screenshot: '+path.join(directory,'candidate-desktop.png'));
} finally {
    await browser?.close();await new Promise(resolve=>server.close(resolve));
    if (process.env.JOBFIND_KEEP_UI_SCREENSHOT !== '1') {
        assert.ok(path.basename(directory).startsWith('jobfind-candidate-ui-'));
        await rm(directory,{recursive:true,force:true});
    }
}
