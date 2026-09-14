// Bounded labels only. No tokens, content, user IDs or arbitrary error messages.
const counts = new Map();
const durations = new Map();
const payloads = new Map(), acks = new Map(), transports = new Map();
const sample = (map, key, value, bounds) => {
    const entry=map.get(key)||{count:0,sum:0,buckets:bounds.map(()=>0)};
    entry.count++;entry.sum+=value;bounds.forEach((bound,i)=>{if(value<=bound)entry.buckets[i]++;});map.set(key,entry);
};
const histogram = (name,map,bounds,label) => [`# TYPE ${name} histogram`,...Array.from(map,([key,v])=>[
    ...bounds.map((bound,i)=>`${name}_bucket{${label}="${key}",le="${bound}"} ${v.buckets[i]}`),
    `${name}_bucket{${label}="${key}",le="+Inf"} ${v.count}`,`${name}_count{${label}="${key}"} ${v.count}`,`${name}_sum{${label}="${key}"} ${v.sum}`
].join("\n"))];
let active = 0;
const increment = (name, labels = '') => {
    const key = `${name}${labels}`;
    counts.set(key, (counts.get(key) || 0) + 1);
};
const observe = (event, seconds) => {
    const value = durations.get(event) || { count: 0, sum: 0, buckets: [0, 0, 0, 0, 0] };
    value.count++; value.sum += seconds;
    [0.01, 0.05, 0.1, 0.5, 2].forEach((bound, i) => { if (seconds <= bound) value.buckets[i]++; });
    durations.set(event, value);
};
const render = () => [
    '# TYPE socket_connections_active gauge', `socket_connections_active ${active}`,
    ...Array.from(counts, ([key, count]) => `${key} ${count}`),
    '# TYPE socket_connected_by_transport gauge',
    ...['polling','websocket'].map(name=>`socket_connected_by_transport{transport="${name}"} ${transports.get(name)||0}`),
    ...histogram('socket_payload_bytes',payloads,[128,512,2048,8192,65536],'event'),
    ...histogram('chat_send_ack_seconds',acks,[0.05,0.1,0.25,0.5,1,5,15,30],'outcome'),
    '# TYPE socket_event_duration_seconds histogram',
    ...Array.from(durations, ([event, value]) => [
        ...[0.01, 0.05, 0.1, 0.5, 2].map((bound, i) => `socket_event_duration_seconds_bucket{event="${event}",le="${bound}"} ${value.buckets[i]}`),
        `socket_event_duration_seconds_bucket{event="${event}",le="+Inf"} ${value.count}`,
        `socket_event_duration_seconds_count{event="${event}"} ${value.count}`,
        `socket_event_duration_seconds_sum{event="${event}"} ${value.sum}`,
    ].join('\n')),
].join('\n') + '\n';
module.exports = { increment, observe, render,
    payload:(event,bytes)=>sample(payloads,event,bytes,[128,512,2048,8192,65536]),
    ack:(outcome,seconds)=>sample(acks,outcome,seconds,[0.05,0.1,0.25,0.5,1,5,15,30]),
    transport:(name,delta)=>{if(['polling','websocket'].includes(name))transports.set(name,Math.max(0,(transports.get(name)||0)+delta));}, connect: () => { active++; }, disconnect: () => { active = Math.max(0, active - 1); } };
