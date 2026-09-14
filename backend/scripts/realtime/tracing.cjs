const http=require('http'),assert=require('node:assert/strict');
const tracing=require('../../src/utils/realtimeTracing');
(async()=>{
    const packets=[];
    const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{packets.push(JSON.parse(body));res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');});});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    process.env.SOCKET_TRACING_ENABLED='true';
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=`http://127.0.0.1:${server.address().port}/v1/traces`;
    let correlation;
    try {
        tracing.init();
        await tracing.run('socket.chat:send',async span=>{
            correlation=tracing.id(span);await tracing.run('chat.insert',async()=>{});
            try{await tracing.run('chat.publish',async()=>{throw new Error('secret SQL token message')});}catch{}
        });
        await tracing.close();
        const spans=packets.flatMap(p=>p.resourceSpans.flatMap(r=>r.scopeSpans.flatMap(s=>s.spans)));
        assert.equal(spans.length,3);assert.equal(new Set(spans.map(s=>s.traceId)).size,1);assert.equal(spans[0].traceId,correlation);
        assert.equal(JSON.stringify(packets).includes('secret SQL'),false);
        console.log('PASS actual OTLP HTTP export, linked trace, redacted failure, flush on shutdown');
    }finally{await tracing.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
