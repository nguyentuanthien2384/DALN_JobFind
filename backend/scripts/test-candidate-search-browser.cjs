// Production recruiter shell + real controls, with synthetic API responses.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');

(async () => {
    const root = path.resolve(__dirname, '../..');
    const output = path.join(root, '.local/candidate-search-browser');
    await fs.mkdir(output, { recursive: true });
    const app = express();
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        await build({
            stdin: { contents: `
                import React from 'react'; import {createRoot} from 'react-dom/client';
                import {BrowserRouter} from 'react-router-dom';
                import HomeAdmin from './src/container/system/HomeAdmin';
                import SessionContext from './src/auth/SessionContext';
                import './src/css/App.css';
                const user={id:8,companyId:42,roleCode:'EMPLOYER',companyStatusCode:'S1',companyCensorCode:'CS1',firstName:'Nhà',lastName:'Tuyển dụng',image:'/assetsAdmin/images/logo-mini.svg'};
                localStorage.setItem('userData',JSON.stringify(user));
                createRoot(document.getElementById('root')).render(<BrowserRouter basename='/admin'><SessionContext.Provider value={user}><HomeAdmin user={user}/></SessionContext.Provider></BrowserRouter>);
            `, resolveDir: path.join(root, 'frontend'), loader: 'jsx' },
            bundle: true, outfile: path.join(output, 'app.js'),
            loader: { '.js': 'jsx', '.scss': 'empty', '.png': 'dataurl', '.jpg': 'dataurl' },
            define: { 'process.env.NODE_ENV': '"development"', 'process.env.REACT_APP_BACKEND_URL': JSON.stringify(origin) },
        });
        app.use('/assets', express.static(path.join(root, 'frontend/public/assets')));
        app.use('/assetsAdmin', express.static(path.join(root, 'frontend/public/assetsAdmin')));
        app.use('/app', express.static(output));
        const requests = [];
        let failSearch = false;
        const codes = { JOBTYPE:[{code:'IT',value:'Công nghệ thông tin'}], PROVINCE:[{code:'HN',value:'Hà Nội'}],
            EXPTYPE:[{code:'E1',value:'1–3 năm'}], SALARYTYPE:[{code:'S1',value:'15–20 triệu'}] };
        app.all(/^\/api\//, (req, res) => {
            if (req.path === '/api/get-all-code') return res.json({errCode:0,data:codes[req.query.type] || []});
            if (req.path === '/api/get-all-skill-by-job-code') return res.json({errCode:0,data:[{id:8,name:'React'},{id:9,name:'Node.js'}]});
            if (req.path === '/api/get-detail-company-by-userId') return res.json({errCode:0,data:{allowCvFree:3,allowCv:12}});
            if (req.path === '/api/candidate-search-jobs') return res.json({errCode:0,count:1,data:[{id:50,name:'Frontend Developer',criteria:{
                categoryJobCode:'IT',provinceCode:'HN',salaryCode:'S1',experienceJobCode:'E1',listSkills:[{id:8,name:'React'},{id:9,name:'Node.js'}]}}]});
            if (req.path === '/api/fillter-cv-by-selection') {
                requests.push({...req.query});
                if (failSearch) return res.status(503).json({errCode:-1,errMessage:'Tạm thời mất kết nối'});
                if (req.query.keyword === 'no-results') return res.json({errCode:0,data:[],count:0});
                const scored = Boolean(req.query.categoryJobCode || req.query.listSkills || req.query.otherSkills);
                return res.json({errCode:0,count:8,isHiddenPercent:!scored,allowance:{free:3,paid:12},data:[{
                    userId:Number(req.query.offset || 0)+99,userSettingData:{firstName:'Nguyễn Minh',lastName:'Anh'},
                    jobTypeSettingData:codes.JOBTYPE[0],provinceSettingData:codes.PROVINCE[0],
                    expTypeSettingData:codes.EXPTYPE[0],salaryTypeSettingData:codes.SALARYTYPE[0],
                    matchScore:scored?83:null,skills:[{id:8,name:'React'},{id:10,name:'TypeScript'},{id:11,name:'HTML / CSS'}],
                    matchedSkills:['React'],missingSkills:['Node.js'],matchedCriteria:['categoryJobCode','provinceCode','experienceJobCode','salaryCode'],
                }]});
            }
            return res.json({errCode:0,data:[],count:0});
        });
        app.get(/.*/, (_, res) => res.send(`<!doctype html><html lang='vi'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
            <link rel='stylesheet' href='/assetsAdmin/vendors/css/vendor.bundle.base.css'>
            <link rel='stylesheet' href='/assetsAdmin/vendors/feather/feather.css'>
            <link rel='stylesheet' href='/assetsAdmin/vendors/ti-icons/css/themify-icons.css'>
            <link rel='stylesheet' href='/assets/css/fontawesome-all.min.css'>
            <link rel='stylesheet' href='/assetsAdmin/css/vertical-layout-light/style.css'>
            <link rel='stylesheet' href='/assets/css/style.css'><link rel='stylesheet' href='/app/app.css'>
            <div id='root'></div><script src='/app/app.js'></script></html>`));
        browser = await chromium.launch({headless:true});
        const page = await browser.newPage({viewport:{width:1440,height:1000}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${origin}/admin/list-candiate/`);
        await expect(page.getByRole('heading',{name:'Tìm ứng viên phù hợp'})).toBeVisible();
        await expect(page.getByRole('heading',{name:'Nguyễn Minh Anh'})).toBeVisible();
        await page.getByRole('combobox',{name:'Chọn tin tuyển dụng'}).click();
        await page.getByTitle('#50 · Frontend Developer').click();
        await expect(page.locator('.cv-search-score')).toContainText('83%');
        await page.getByText('Vì sao có điểm này?').click();
        await expect(page.getByText('Chưa thấy khai báo:')).toBeVisible();
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
        await page.locator('.cv-search-pagination').getByText('Sau',{exact:true}).click();
        await expect.poll(()=>requests.at(-1)).toMatchObject({offset:'5',provinceCode:'HN',salaryCode:'S1',experienceJobCode:'E1',listSkills:'8,9'});
        await page.getByRole('heading',{name:'Nguyễn Minh Anh'}).waitFor();
        await page.getByRole('combobox',{name:'Kỹ năng cần có'}).fill('C++');
        await page.getByRole('combobox',{name:'Kỹ năng cần có'}).press('Enter');
        await expect.poll(()=>requests.at(-1)).toMatchObject({offset:'0',otherSkills:'C++',listSkills:'8,9'});
        await page.getByRole('combobox',{name:'Kỹ năng cần có'}).press('Escape');
        await page.getByRole('button',{name:'Xem chi tiết ứng viên'}).click();
        await expect(page.getByRole('dialog')).toContainText('không trừ thêm lượt');
        await page.getByRole('button',{name:'Hủy',exact:true}).click();
        await page.getByRole('button',{name:'Xóa bộ lọc',exact:true}).click();
        await expect.poll(()=>requests.at(-1)?.offset).toBe('0');
        await expect(page.locator('.cv-search-score')).toHaveCount(0);
        await page.getByLabel('Từ khóa',{exact:true}).fill('no-results');
        await expect(page.getByText('Chưa có ứng viên phù hợp')).toBeVisible();
        failSearch=true;
        await page.getByLabel('Từ khóa',{exact:true}).fill('error');
        await expect(page.getByRole('alert')).toContainText('Tạm thời mất kết nối');
        failSearch=false;
        await page.getByRole('button',{name:'Thử lại'}).click();
        await expect(page.getByRole('heading',{name:'Nguyễn Minh Anh'})).toBeVisible();
        await page.getByLabel('Từ khóa',{exact:true}).fill('');
        await page.setViewportSize({width:390,height:844});
        await expect(page.getByRole('heading',{name:'Nguyễn Minh Anh'})).toBeVisible();
        assert(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth+1),'Mobile page must not overflow horizontally');
        await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
        assert.deepEqual(errors,[]);
        console.log(`PASS: real recruiter UI, job criteria, pagination, C++ tags, consent dialog, empty/error/retry states and mobile layout. Screenshots: ${output}`);
    } finally { if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
