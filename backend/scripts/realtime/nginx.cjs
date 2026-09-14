// Optional local Nginx/TLS verification. No system certificate trust changes.
const fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net');
const {spawn,execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
exports.prepare=async()=>{
    if(!process.env.CHAT_TEST_NGINX_BIN || !process.env.CHAT_TEST_OPENSSL_BIN) throw new Error('Explicit local nginx and openssl binaries required');
    const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
    const dir=path.resolve(__dirname,'../../../.local/socket-nginx-test',`run-${port}`);await fs.mkdir(path.join(dir,'logs'),{recursive:true});await fs.mkdir(path.join(dir,'temp'),{recursive:true});
    const key=path.join(dir,'local.key'),cert=path.join(dir,'local.crt');
    // An empty dedicated config prevents use of another application's OpenSSL config.
    const config=path.join(dir,'openssl.cnf');await fs.writeFile(config,'[req]\ndistinguished_name=dn\n[dn]\n');
    execFileSync(process.env.CHAT_TEST_OPENSSL_BIN,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-config',config],{windowsHide:true,stdio:'ignore'});
    return {url:`https://127.0.0.1:${port}`,dir,port,key,cert};
};
exports.start=async(config,nodes)=>{
    const prefix=config.dir.replaceAll('\\','/')+'/';
    await fs.writeFile(path.join(config.dir,'nginx.conf'),`daemon off; worker_processes 1; pid logs/nginx.pid;
events { worker_connections 1024; }
http { log_format upstream '$arg_sid $upstream_addr $status'; access_log logs/access.log upstream;
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
upstream socket_nodes { hash $remote_addr consistent; ${nodes.map(n=>`server ${new URL(n).host};`).join(' ')} }
server {listen 127.0.0.1:${config.port} ssl; ssl_certificate local.crt; ssl_certificate_key local.key; ssl_protocols TLSv1.2 TLSv1.3;
location / {proxy_pass http://socket_nodes; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection $connection_upgrade; proxy_set_header Host $host; proxy_read_timeout 75s; proxy_send_timeout 75s;}
}}`);
    const child=spawn(process.env.CHAT_TEST_NGINX_BIN,['-p',prefix,'-c','nginx.conf'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let error='';child.stderr.on('data',chunk=>{error+=chunk});
    for(let i=0;i<50;i++) {
        if(child.exitCode!==null)throw new Error(`Nginx startup: ${error}`);
        const ready=await new Promise(resolve=>{const s=net.connect(config.port,'127.0.0.1',()=>{s.destroy();resolve(true)});s.on('error',()=>resolve(false));});
        if(ready)break;await new Promise(r=>setTimeout(r,100));
    }
    return {close:async()=>{
        if(child.exitCode!==null)return;
        execFileSync(process.env.CHAT_TEST_NGINX_BIN,['-p',prefix,'-c','nginx.conf','-s','quit'],{windowsHide:true,stdio:'ignore'});
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Nginx shutdown timed out'))},8000);child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`Nginx exit ${code}`));});});
    }};
};
exports.verify=async({config,token})=>{
    const {io}=require('socket.io-client');const ca=await fs.readFile(config.cert);
    const event=(s,name)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`TLS ${name} timeout`)),8000);s.once(name,x=>{clearTimeout(timer);resolve(x)});});
    for(const transports of [['polling'],['polling','websocket']]) {
        const s=io(config.url,{auth:{token},extraHeaders:{Origin:config.url},transports,ca,reconnection:false,autoConnect:false});
        try {
            const ready=event(s,'connect');s.connect();await ready;
            const sid=s.io.engine.id;
            for(let i=0;i<6;i++)assert.equal((await s.timeout(3000).emitWithAck('chat:presence',{partnerId:8})).errCode,0);
            if(transports.length>1) {
                if(s.io.engine.transport.name!=='websocket')await event(s.io.engine,'upgrade');
                assert.equal(s.io.engine.transport.name,'websocket');
            } else {
                const rows=(await fs.readFile(path.join(config.dir,'logs/access.log'),'utf8')).split('\n').filter(line=>line.startsWith(sid+' '));
                assert.ok(rows.length>=6);assert.equal(new Set(rows.map(line=>line.split(' ')[1])).size,1);
                assert.ok(rows.every(line=>line.trim().endsWith('200')));
            }
        } finally {s.disconnect();}
    }
    console.log('PASS Nginx + locally trusted TLS: polling affinity in access log, actual polling-to-WSS upgrade, authenticated ACKs');
};
