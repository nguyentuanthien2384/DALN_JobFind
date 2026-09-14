const assert=require('node:assert/strict');
const {io}=require('socket.io-client');const WebSocket=require('ws');
module.exports=async({url,tokenFor})=>{
    const event=(socket,name,timeout=8000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timed out ${name}`)),timeout);socket.once(name,x=>{clearTimeout(timer);resolve(x)});});
    const connect=async(id)=>{const s=io(url,{auth:{token:tokenFor(id)},extraHeaders:{Origin:'http://localhost:3000'},reconnection:false,autoConnect:false});const ready=event(s,'connect');s.connect();await ready;return s;};
    const sender=await connect(7),receiver=await connect(8);
    try {
        const initial=await sender.timeout(4000).emitWithAck('chat:send',{receiverId:8,content:'timing baseline',clientMessageId:'timing-baseline-0001'});
        // Allow the recipient to observe an offset before breaking the transport.
        await new Promise(r=>setTimeout(r,200));receiver.io.engine.close();
        const began=Date.now();
        const heartbeat=(async()=>{
            const ws=new WebSocket(url.replace('http','ws')+'/socket.io/?EIO=4&transport=websocket',{origin:'http://localhost:3000'});
            ws.on('message',bytes=>{if(bytes.toString().startsWith('0'))ws.send('40'+JSON.stringify({token:tokenFor(9)})); /* no Engine.IO pong */});
            await event(ws,'close',55000);
            assert.ok(Date.now()-began>=40000);console.log('PASS heartbeat: silent real TCP/WebSocket peer removed after the configured 25s + 20s heartbeat window');
        })();
        console.log('Running real 121-second recovery expiry and silent-peer heartbeat checks');
        await new Promise(r=>setTimeout(r,121000));await heartbeat;
        const missed=await sender.timeout(4000).emitWithAck('chat:send',{receiverId:8,content:'outside recovery window',clientMessageId:'timing-outside-000001'});
        const ready=event(receiver,'connect');receiver.connect();await ready;assert.equal(receiver.recovered,false);
        const response=await fetch(`${url}/api/get-chat-conversation?partnerId=7&afterId=${initial.data.id}`,{headers:{authorization:`Bearer ${tokenFor(8)}`}});
        const data=await response.json();assert.ok(data.data.some(m=>m.id===missed.data.id));
        console.log('PASS actual 121-second disconnection: recovery expires, fresh authentication and database catch-up retrieve the missed message');
    } finally {sender.disconnect();receiver.disconnect();}
};
