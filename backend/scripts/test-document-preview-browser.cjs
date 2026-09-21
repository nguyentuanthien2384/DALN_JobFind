// Exercise the shared PDF components with actual React-PDF and nested Reactstrap dialogs.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {PDFDocument,StandardFonts}=require('pdf-lib');
const {chromium,expect}=require('@playwright/test');
const root=path.resolve(__dirname,'../..'),assets=path.join(root,'.local/document-preview-checks');
let appServer,fileServer,browser;
(async()=>{
    const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
    for(let i=1;i<=2;i++){const page=pdf.addPage([595,842]);page.drawText(i===1?'JOBFIND | CANDIDATE PROFILE':'EXPERIENCE & PROJECTS',{x:45,y:770,size:20,font});page.drawText(`Shared PDF preview verification - page ${i}`,{x:45,y:728,size:12,font});}
    const bytes=Buffer.from(await pdf.save()),data=`data:application/pdf;base64,${bytes.toString('base64')}`;
    const tall=await PDFDocument.create();tall.addPage([100,10000]);const tallData=`data:application/pdf;base64,${Buffer.from(await tall.save()).toString('base64')}`;
    let crossOriginReads=0;
    fileServer=http.createServer((req,res)=>{assert.equal(req.headers.cookie,undefined);assert.equal(req.headers.authorization,undefined);crossOriginReads++;res.writeHead(200,{'content-type':'application/pdf','access-control-allow-origin':'*'});res.end(bytes);});
    await new Promise(resolve=>fileServer.listen(0,'127.0.0.1',resolve));
    const remote=`http://127.0.0.1:${fileServer.address().port}/cv.pdf`;
    await fs.mkdir(assets,{recursive:true});
    require('node:child_process').execFileSync(process.execPath,[path.join(root,'frontend/scripts/copy-pdf-assets.cjs')],{windowsHide:true,stdio:'ignore'});
    await require('esbuild').build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
        import{Modal,ModalBody,ModalFooter,Button}from'reactstrap';import PdfPreviewButton from './src/components/documents/PdfPreviewButton';
        const data=${JSON.stringify(data)},remote=${JSON.stringify(remote)},tallData=${JSON.stringify(tallData)};
        function App(){const[parent,setParent]=useState(false),[file,setFile]=useState(null);return <main><h1>Hồ sơ & tài liệu</h1><p>Xem lại tài liệu trước khi gửi hoặc tải xuống.</p>
            <section><h2>CV đã nộp</h2><PdfPreviewButton source={data} fileName='CV-da-nop.pdf' label='Xem CV đã nộp'/></section>
            <section><h2>Chọn CV trên máy</h2><input type='file' aria-label='Chọn PDF' onChange={e=>setFile(e.target.files[0])}/>{file&&<PdfPreviewButton source={file} fileName={file.name} label='Xem PDF vừa chọn'/>}</section>
            <section><h2>Hồ sơ công ty</h2><PdfPreviewButton source={remote} fileName='Ho-so-cong-ty.pdf' label='Xem hồ sơ công ty'/></section>
            <section><PdfPreviewButton source='data:application/pdf;base64,PGh0bWw+YmFkPC9odG1sPg==' label='Tài liệu lỗi'/></section>
            <section><PdfPreviewButton source={tallData} fileName='Trang-dai.pdf' label='Trang PDF lớn'/></section>
            <button onClick={()=>setParent(true)}>Mở form ứng tuyển</button>
            <Modal isOpen={parent} toggle={()=>setParent(false)} centered><ModalBody><h2>Ứng tuyển công việc</h2><label>Lời giới thiệu<input aria-label='Lời giới thiệu'/></label><PdfPreviewButton source={data} fileName='CV-ung-tuyen.pdf' label='Xem trước khi nộp'/></ModalBody><ModalFooter><Button onClick={()=>setParent(false)}>Đóng form</Button></ModalFooter></Modal>
        </main>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:path.join(root,'frontend'),loader:'jsx'},bundle:true,format:'esm',outfile:path.join(assets,'app.js'),loader:{'.js':'jsx'},define:{'process.env.NODE_ENV':JSON.stringify('production'),'process.env.PUBLIC_URL':JSON.stringify(''),'process.env.REACT_APP_BACKEND_URL':JSON.stringify('/')},logLevel:'warning'});
    await fs.writeFile(path.join(assets,'index.html'),'<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;background:#f5f7fa;color:#24384e;font:15px Arial,sans-serif}main{padding:32px;max-width:1000px;margin:auto}section{background:white;border:1px solid #dee6ee;border-radius:12px;padding:22px;margin:16px 0}h1{font-size:28px}h2{font-size:18px}button,input{padding:8px}*{box-sizing:border-box}.modal{position:fixed;inset:0;z-index:1050;display:none;background:#0006}.modal.show{display:block}.modal-dialog{margin:10vh auto;max-width:700px}.modal-content{padding:24px;background:white;border-radius:14px}.modal-footer{padding-top:24px}.modal-backdrop{display:none}</style><div id="root"></div><script type="module" src="/app.js"></script></html>');
    const express=require('express'),app=express();app.use('/pdfjs',express.static(path.join(root,'frontend/public/pdfjs')));app.use(express.static(assets,{dotfiles:'allow'}));
    appServer=http.createServer(app);await new Promise(resolve=>appServer.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${appServer.address().port}`);
    await page.evaluate(()=>{document.cookie='synthetic_private_cookie=must-not-leave-origin;path=/';});
    const checkPdf=async()=>{await expect(page.locator('.react-pdf__Page canvas')).toBeVisible({timeout:20000});await expect(page.getByText('Trang 1 / 2',{exact:true})).toBeVisible();};
    const close=()=>page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Xem CV đã nộp',exact:true}).click();await checkPdf();assert.equal(crossOriginReads,0);
    await page.getByRole('button',{name:'Trang PDF sau'}).click();await expect(page.getByText('Trang 2 / 2',{exact:true})).toBeVisible();
    const[download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Tải PDF',exact:true}).click()]);assert.deepEqual(await fs.readFile(await download.path()),bytes);await close();
    await page.getByLabel('Chọn PDF').setInputFiles({name:'CV-local.pdf',mimeType:'application/pdf',buffer:bytes});await page.getByRole('button',{name:'Xem PDF vừa chọn'}).click();await checkPdf();assert.equal(crossOriginReads,0);await close();
    await page.getByRole('button',{name:'Xem hồ sơ công ty'}).click();await checkPdf();assert.equal(crossOriginReads,1);await close();
    await page.getByRole('button',{name:'Tài liệu lỗi'}).click();await expect(page.getByRole('alert')).toContainText('không phải PDF');await expect(page.locator('iframe')).toHaveCount(0);await close();
    await page.getByRole('button',{name:'Trang PDF lớn'}).click();await expect(page.locator('.react-pdf__Page canvas')).toBeVisible();
    assert.ok(await page.locator('.react-pdf__Page canvas').evaluate(canvas=>canvas.width*canvas.height<=8*1024*1024&&canvas.height<=8192&&canvas.width<=8192));await close();
    await page.getByRole('button',{name:'Mở form ứng tuyển'}).click();await page.getByRole('button',{name:'Xem trước khi nộp'}).click();await checkPdf();
    await page.getByRole('link',{name:'Tải PDF',exact:true}).focus();await page.keyboard.press('Shift+Tab');
    assert.ok(await page.evaluate(()=>Boolean(document.activeElement.closest('.ant-modal'))),'Keyboard focus stays in PDF viewer');
    await page.keyboard.press('Escape');await expect(page.locator('.react-pdf__Page canvas')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Ứng tuyển công việc'})).toBeVisible();
    await page.getByRole('button',{name:'Đóng form'}).click();
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Xem CV đã nộp',exact:true}).click();await checkPdf();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(assets,'document-mobile.png'),animations:'disabled'});await close();
    await page.setViewportSize({width:1280,height:950});await page.getByRole('button',{name:'Xem CV đã nộp',exact:true}).click();await checkPdf();await page.screenshot({path:path.join(assets,'document-desktop.png'),animations:'disabled'});
    await page.evaluate(()=>window.dispatchEvent(new Event('jobfind:session-ended')));await expect(page.locator('.react-pdf__Page canvas')).toHaveCount(0);await expect(page.getByRole('button',{name:'Xem CV đã nộp',exact:true})).toBeDisabled();
    assert.deepEqual(errors,[]);console.log('PASS: data/local/remote PDF canvas, original-byte download, private credentials, invalid documents, nested form focus/Escape, mobile, session expiry, no JS errors.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();for(const server of [appServer,fileServer])if(server)await new Promise(resolve=>server.close(resolve));});
