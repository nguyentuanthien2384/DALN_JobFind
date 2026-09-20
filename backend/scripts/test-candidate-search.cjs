// Integration regression against an isolated, disposable MySQL database.
// No application rows are created or changed. Requires CREATE DATABASE permission.
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('@babel/register')({ presets: ['@babel/preset-env'], ignore: [/node_modules/] });

(async () => {
    const base = require('../src/config/config.json').development;
    const database = `jobfind_cv_search_test_${crypto.randomBytes(6).toString('hex')}`;
    const admin = await mysql.createConnection({ host: process.env.DB_HOST || base.host,
        port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || base.username,
        password: process.env.DB_PASSWORD ?? base.password });
    let db;
    try {
        await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        process.env.DB_NAME = database;
        db = require('../src/models');
        const quote = name => db.sequelize.getQueryInterface().queryGenerator.quoteTable(db[name].getTableName());
        const schemas = {
            User: 'id INT PRIMARY KEY, firstName VARCHAR(100), lastName VARCHAR(100), image TEXT, companyId INT, email TEXT, address TEXT, dob TEXT',
            Account: 'id INT PRIMARY KEY, userId INT, roleCode VARCHAR(40), statusCode VARCHAR(40)',
            Allcode: 'id INT PRIMARY KEY, code VARCHAR(40) UNIQUE, value VARCHAR(100)',
            UserSetting: 'id INT PRIMARY KEY, userId INT UNIQUE, categoryJobCode VARCHAR(40), experienceJobCode VARCHAR(40), salaryJobCode VARCHAR(40), addressCode VARCHAR(40), isFindJob TINYINT, file LONGBLOB',
            Skill: 'id INT PRIMARY KEY, name VARCHAR(100), categoryJobCode VARCHAR(40)',
            UserSkill: 'UserId INT, SkillId INT',
            Post: 'id INT PRIMARY KEY, userId INT, detailPostId INT',
            DetailPost: 'id INT PRIMARY KEY, name VARCHAR(100), categoryJobCode VARCHAR(40), experienceJobCode VARCHAR(40), salaryJobCode VARCHAR(40), addressCode VARCHAR(40), descriptionHTML TEXT, descriptionMarkdown TEXT',
        };
        for (const [name, columns] of Object.entries(schemas)) await db.sequelize.query(`CREATE TABLE ${quote(name)} (${columns})`);
        const insert = async (name, columns, values) => {
            for (const row of values) await db.sequelize.query(`INSERT INTO ${quote(name)} (${columns}) VALUES (${row.map(() => '?').join(',')})`, { replacements: row });
        };
        await insert('Allcode', 'id,code,value', [[1,'IT','Công nghệ'],[2,'HN','Hà Nội'],[3,'DN','Đà Nẵng'],[4,'E1','1 năm'],[5,'S1','10–15 triệu']]);
        await insert('Skill','id,name,categoryJobCode',[[1,'React','IT'],[2,'Node.js','IT'],[3,'C++','IT'],[4,'C#','IT'],[5,'C','IT']]);
        for (let id = 1; id <= 9; id++) {
            await insert('User','id,firstName,lastName,email,address,dob,companyId',[[id, id === 9 ? "O'Reilly 100%_" : `Ứng viên ${id}`,'Test','private@example.test','private-address','2000',null]]);
            await insert('Account','id,userId,roleCode,statusCode',[[id,id,id === 6 ? 'EMPLOYER' : 'CANDIDATE',id === 7 ? 'S2' : 'S1']]);
            await insert('UserSetting','id,userId,categoryJobCode,experienceJobCode,salaryJobCode,addressCode,isFindJob,file',
                [[id,id,'IT','E1','S1',id === 3 ? 'DN' : 'HN',id === 4 ? 0 : 1,id === 5 ? null : id === 8 ? '' : 'synthetic-cv']]);
        }
        await insert('UserSkill','UserId,SkillId',[[1,1],[1,1],[2,1],[2,2],[3,2],[3,3],[4,1],[4,2],[6,1],[7,1],[9,4]]);
        await insert('User','id,firstName,companyId',[[100,'Company A',10],[200,'Company B',20]]);
        await insert('DetailPost','id,name,categoryJobCode,experienceJobCode,salaryJobCode,addressCode,descriptionHTML',
            [[10,'Frontend Developer','IT','E1','S1','HN','<p>React, Node.js and C++</p>'],[20,'Private company B job','IT','E1','S1','DN','React']]);
        await insert('Post','id,userId,detailPostId',[[10,100,10],[20,200,20]]);
        const { searchCandidates, listCandidateSearchJobs } = require('../src/services/candidateSearchService');
        const search = extra => searchCandidates({ limit: 50, offset: 0, ...extra });
        const ids = result => result.data.map(row => row.userId);
        const all = await search({});
        assert.deepEqual(ids(all), [1,2,3,9]);
        assert.equal(all.count,4);
        assert(all.data.every(row => row.matchScore === null));
        assert(!/private|synthetic-cv|email|dob|password/.test(JSON.stringify(all)));
        assert.deepEqual(ids(await search({ provinceCode:'DN', categoryJobCode:'IT', experienceJobCode:'E1', salaryCode:'S1' })),[3]);
        assert.equal((await search({ salaryCode:'S2' })).count,0);
        const best = await search({ otherSkills:'React,Node.js', skillMode:'rank', limit:1 });
        assert.deepEqual(ids(best),[2]); assert.equal(best.count,4); assert.equal(best.data[0].matchScore,100);
        const page2 = await search({ otherSkills:'React,Node.js', skillMode:'rank', limit:1, offset:1 });
        assert.deepEqual(ids(page2),[1]); assert.equal(page2.data[0].matchScore,50);
        assert.deepEqual(ids(await search({ otherSkills:'React,Node.js',skillMode:'all' })),[2]);
        assert.deepEqual(ids(await search({ otherSkills:'React,Node.js',skillMode:'any' })),[2,1,3]);
        assert.deepEqual(ids(await search({ otherSkills:'React,Node.js',skillMode:'rank',minMatch:70 })),[2]);
        const duplicate = await search({listSkills:'1,1',otherSkills:'react,React',skillMode:'any'});
        assert.equal(duplicate.count,2); assert(duplicate.data.every(row => row.matchScore === 100));
        assert.equal(duplicate.data[0].skills.length,1);
        const partial = await search({ provinceCode:'HN',otherSkills:'React,Node.js',skillMode:'rank' });
        assert.equal(partial.data.find(row=>row.userId===1).matchScore,67);
        assert.deepEqual(partial.data.find(row=>row.userId===1).missingSkills,['Node.js']);
        assert.deepEqual(ids(await search({ keyword:'C++' })),[3]);
        assert.deepEqual(ids(await search({ otherSkills:'C#' })),[9]);
        assert.equal((await search({otherSkills:'C'})).count,0);
        assert.deepEqual(ids(await search({keyword:"O'Reilly 100%_"})),[9]);
        assert.equal((await search({keyword:"' OR 1=1 --"})).count,0);
        assert.equal((await search({keyword:'%'})).count,1);
        assert.equal((await search({sort:'name',offset:50})).data.length,0);
        assert.equal((await search({limit:0})).httpStatus,400);
        const jobs=await listCandidateSearchJobs({companyId:20},10);
        assert.deepEqual(jobs.data.map(row=>row.id),[10]);
        assert.deepEqual(jobs.data[0].criteria.listSkills.map(skill=>skill.name),['React','Node.js','C++']);
        assert.equal((await listCandidateSearchJobs({search:'company B'},10)).count,0);
        assert.equal((await listCandidateSearchJobs({},null)).httpStatus,403);
        console.log('PASS: candidate eligibility/privacy, combined filters, global ranking, pagination, skill modes, thresholds, punctuation, SQL input handling and company job isolation.');
    } finally {
        if (db) await db.sequelize.close();
        // Never allow cleanup to target a configured application database.
        if (!/^jobfind_cv_search_test_[a-f0-9]{12}$/.test(database)) throw new Error('Unsafe test database name');
        await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
        await admin.end();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
