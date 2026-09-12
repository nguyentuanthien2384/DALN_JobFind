import { readFile, writeFile, mkdir, copyFile, open } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './release/verify.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)), exec=promisify(execFile);
const id=(await readFile(path.join(root,'.local/deployments/LATEST'),'utf8')).trim();
const directory=path.join(root,'.local/deployments',id), kit=path.join(root,'.local/releases/bc9cb1c4e070-2026-09-11T14-26-04-972Z');
const manifest=JSON.parse(await readFile(path.join(kit,'manifest.json'),'utf8'));
const context=path.join(directory,'web-source');await mkdir(context,{recursive:true});
await exec('git',['archive','--format=tar','-o',path.join(directory,'frontend-source.tar'),manifest.applicationCommit,'--','frontend/src','frontend/public','frontend/package.json','frontend/package-lock.json'],{cwd:root,windowsHide:true});
await exec('tar',['-xf',path.join(directory,'frontend-source.tar'),'-C',context],{windowsHide:true});
const frontend=path.join(context,'frontend');await mkdir(path.join(frontend,'.release'),{recursive:true});
await copyFile(path.join(directory,'nginx-gated.conf'),path.join(frontend,'.release/nginx.conf'));
await copyFile(path.join(root,'scripts/release/web.Dockerfile'),path.join(directory,'web.Dockerfile'));
const flags={...manifest.variants.rollback.flags};
const artifacts=[];
for(const [stage,key,value] of [['search','REACT_APP_JOB_SEARCH_MODE','core'],['progress','REACT_APP_APPLICATION_PROGRESS_ENABLED','true'],['workspace','REACT_APP_JOB_WORKSPACE_MODE','core'],['prepared-cv','REACT_APP_PREPARED_CV_APPLICATION_ENABLED','true']]) {
    flags[key]=value;
    const info={releaseId:id+'-'+stage,applicationCommit:manifest.applicationCommit,variant:stage,gatewayUrl:'/',flags:{...flags}};
    await writeFile(path.join(frontend,'.release/release-info.json'),JSON.stringify(info,null,2)+'\n');
    const tag='jobfind-activation-web:'+id.toLowerCase()+'-'+stage;
    console.log('Building staged frontend: '+stage);
    const log=await open(path.join(directory,'build-'+stage+'.log'),'w');
    try {
        // The child uses only public flag arguments; provider secrets are never build args.
        const {spawn}=await import('node:child_process');
        await new Promise((resolve,reject)=>{
            const c=spawn('docker',['build','--platform','linux/amd64','--progress=plain','--label','org.opencontainers.image.revision='+manifest.applicationCommit,'-t',tag,'-f',path.join(directory,'web.Dockerfile'),...Object.entries(flags).flatMap(([k,v])=>['--build-arg',k+'='+v]),frontend],{cwd:root,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
            c.on('error',reject);c.on('exit',code=>code===0?resolve():reject(Error('Frontend build failed: '+stage)));
        });
    }finally{await log.close();}
    const built=JSON.parse((await exec('docker',['image','inspect',tag],{windowsHide:true})).stdout)[0];
    artifacts.push({...info,image:built.Id});
    await writeFile(path.join(directory,'frontend-artifacts.json'),JSON.stringify({artifacts,nginxSha256:await sha256(path.join(directory,'nginx-gated.conf')),dockerfileSha256:await sha256(path.join(directory,'web.Dockerfile')),sourceSha256:await sha256(path.join(directory,'frontend-source.tar'))},null,2)+'\n');
    console.log('Built '+stage+': '+built.Id);
}
await exec('docker',['image','save','-o',path.join(directory,'frontend-images.tar'),...artifacts.map(a=>a.image)],{windowsHide:true,timeout:300000});
await writeFile(path.join(directory,'frontend-images.sha256'),await sha256(path.join(directory,'frontend-images.tar'))+'\n');
console.log('Four staged frontends archived; provider-dependent features remain disabled.');
