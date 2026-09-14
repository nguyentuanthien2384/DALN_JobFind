const { trace, isSpanContextValid, SpanStatusCode } = require('@opentelemetry/api');
const { randomUUID } = require('crypto');
let provider;
const init = () => {
    if (provider || process.env.SOCKET_TRACING_ENABLED !== 'true') return;
    const {NodeTracerProvider,BatchSpanProcessor}=require('@opentelemetry/sdk-trace-node');
    const {OTLPTraceExporter}=require('@opentelemetry/exporter-trace-otlp-http');
    provider=new NodeTracerProvider({spanProcessors:[new BatchSpanProcessor(new OTLPTraceExporter(),{
        maxQueueSize:2048,maxExportBatchSize:128,scheduledDelayMillis:1000,exportTimeoutMillis:3000,
    })]});
    provider.register();
};
const run = (name, action) => trace.getTracer('jobfind-realtime','1').startActiveSpan(name,async span=>{
    try { return await action(span); }
    catch (error) { span.setStatus({code:SpanStatusCode.ERROR});throw error; }
    finally { span.end(); }
});
const id = span => span && isSpanContextValid(span.spanContext()) ? span.spanContext().traceId : randomUUID();
const close = async () => { if(provider){const current=provider;provider=null;await current.shutdown();} };
// Deliberately no SQL text, content, tokens, participant IDs or exception messages.
module.exports={init,run,id,close};
