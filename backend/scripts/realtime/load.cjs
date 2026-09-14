const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const {io}=require('socket.io-client');const {Op}=require('sequelize');
module.exports=async({nodes,db,tokenFor})=>{
    const clients=[],latencies=[],handshakes=[];
    const connect=async(s)=>{const start=performance.now();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Load handshake timeout')),15000);const done=()=>{clearTimeout(timer);s.off('connect_error',failed);resolve();};const failed=e=>{clearTimeout(timer);s.off('connect',done);reject(e);};s.once('connect',done);s.once('connect_error',failed);s.connect();});handshakes.push(performance.now()-start);};
    await db.User.bulkCreate(Array.from({length:500},(_,i)=>({id:1000+i,firstName:'Load fixture'})));
    await db.Account.bulkCreate(Array.from({length:500},(_,i)=>({userId:1000+i,roleCode:'ADMIN',statusCode:'S1'})));
    try {
        for(let start=0;start<500;start+=25){
            const batch=Array.from({length:25},(_,i)=>io(nodes[(start+i)%2],{auth:{token:tokenFor(1000+start+i)},extraHeaders:{Origin:'http://localhost:3000'},transports:['websocket'],autoConnect:false,reconnection:false}));
            clients.push(...batch);await Promise.all(batch.map(connect));
            if([50,100,500].includes(clients.length))console.log(`PASS load connection stage: ${clients.length} simultaneous authenticated sockets`);
        }
        const started=performance.now(),sending=[];
        for(let i=0;i<500;i++){
            const start=performance.now();
            sending.push(clients[i].timeout(5000).emitWithAck('chat:send',{receiverId:8,content:`load ${i}`,clientMessageId:`load-unique-${String(i).padStart(8,'0')}`}).then(result=>{assert.equal(result.errCode,0);latencies.push(performance.now()-start);}));
            await new Promise(resolve=>setTimeout(resolve,50));
        }
        await Promise.all(sending);
        assert.equal(await db.ChatMessage.count({where:{clientMessageId:{[Op.like]:'load-unique-%'}}}),500);
        const storm=clients.slice(0,125);storm.forEach(s=>s.io.engine.close());
        await new Promise(resolve=>setTimeout(resolve,250));await Promise.all(storm.map(connect));
        assert.ok(clients.every(s=>s.connected));
        const sorted=latencies.sort((a,b)=>a-b);const percentile=p=>Number(sorted[Math.ceil(sorted.length*p)-1].toFixed(2));
        const report={connections:500,successfulMessages:500,duplicateRows:0,reconnectedInStorm:125,offeredMessagesPerSecond:20,elapsedSeconds:Number(((performance.now()-started)/1000).toFixed(2)),ackP95Ms:percentile(.95),ackP99Ms:percentile(.99),maxAckMs:sorted.at(-1),environment:'Local synthetic MySQL/Redis, two Node processes; not production capacity or a soak test'};
        await fs.writeFile(path.resolve(__dirname,'../../../.local/websocket-checks/load-result.json'),JSON.stringify(report,null,2));
        const [plan]=await db.sequelize.query('EXPLAIN SELECT id FROM ChatMessages WHERE senderId=7 AND receiverId=8 AND id>1 ORDER BY id ASC LIMIT 101');
        assert.ok(plan[0].possible_keys);await fs.writeFile(path.resolve(__dirname,'../../../.local/websocket-checks/chat-explain.json'),JSON.stringify(plan,null,2));
        console.log(`PASS load: 500 messages, zero duplicate rows, 25% reconnect storm; ACK p95=${report.ackP95Ms}ms p99=${report.ackP99Ms}ms`);
    }finally{clients.forEach(s=>s.disconnect());}
};
