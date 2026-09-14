const {NodeTracerProvider,SimpleSpanProcessor,InMemorySpanExporter}=require('@opentelemetry/sdk-trace-node');

const {trace,context}=require('@opentelemetry/api');
const tracing=require('../../src/utils/realtimeTracing');
test('links async spans and records failures without sensitive exception details',async()=>{
    const memory=new InMemorySpanExporter();
    const provider=new NodeTracerProvider({spanProcessors:[new SimpleSpanProcessor(memory)]});
    provider.register();
    try {
        let correlation;
        await tracing.run('socket.chat:send',async span=>{
            correlation=tracing.id(span);
            await tracing.run('chat.insert',async()=>{await Promise.resolve();});
            await expect(tracing.run('chat.publish',async()=>{throw new Error('private SQL and message content');})).rejects.toThrow();
        });
        await provider.forceFlush();
        const spans=memory.getFinishedSpans();expect(spans).toHaveLength(3);
        expect(new Set(spans.map(s=>s.spanContext().traceId))).toEqual(new Set([correlation]));
        const parent=spans.find(s=>s.name==='socket.chat:send');
        expect(spans.find(s=>s.name==='chat.insert').parentSpanContext.spanId).toBe(parent.spanContext().spanId);
        expect(spans.find(s=>s.name==='chat.publish').status.code).toBe(2);
        expect(JSON.stringify(spans.map(s=>s.attributes))).not.toContain('private SQL');
    } finally {await provider.shutdown();trace.disable();context.disable();}
});

test('exports OTLP to a real HTTP collector in the Node runtime',()=>{
    require('node:child_process').execFileSync(process.execPath,[require('node:path').resolve(__dirname,'../../scripts/realtime/tracing.cjs')],{windowsHide:true,timeout:10000});
});
