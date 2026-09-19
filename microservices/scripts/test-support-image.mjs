import { execFileSync } from 'node:child_process';
const image = process.env.JOBFIND_IMAGE || 'jobfind-microservices:local';
const code = `
import assert from 'node:assert/strict';
assert.notEqual(process.getuid(),0);
await import('/app/support-chat-service/src/app.js');
await new Promise(resolve=>setTimeout(resolve,100));
const base='http://127.0.0.1:4008';
assert.equal((await fetch(base+'/healthz')).status,200);
assert.equal((await fetch(base+'/readyz')).status,503);
assert.equal((await fetch(base+'/support/knowledge')).status,403);
const headers={'x-internal-secret':'support-image-test-secret'};
const knowledge=await fetch(base+'/support/knowledge',{headers});
assert.equal(knowledge.status,200);assert.equal((await knowledge.json()).data.length,9);
assert.equal((await fetch(base+'/support/private/getMyProfileSummary',{headers})).status,401);
console.log('PASS support image: non-root startup, packaged SDK, offline readiness, trust boundary and public corpus');
process.kill(process.pid,'SIGTERM');
`;
execFileSync('docker',['run','--rm','--network','none','--read-only','--tmpfs','/tmp','--cap-drop','ALL','--security-opt','no-new-privileges:true','-e','PORT=4008','-e','INTERNAL_SECRET=support-image-test-secret','-e','MYSQL_HOST=127.0.0.1','-e','MYSQL_PORT=9','-e','SUPPORT_AUTO_MIGRATE=false',image,'node','--input-type=module','-e',code],{stdio:'inherit',windowsHide:true,timeout:60000});
