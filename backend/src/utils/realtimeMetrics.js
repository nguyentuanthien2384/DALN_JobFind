// Bounded labels only. No tokens, content, user IDs or arbitrary error messages.
const counts = new Map();
const durations = new Map();
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
    '# TYPE socket_event_duration_seconds histogram',
    ...Array.from(durations, ([event, value]) => [
        ...[0.01, 0.05, 0.1, 0.5, 2].map((bound, i) => `socket_event_duration_seconds_bucket{event="${event}",le="${bound}"} ${value.buckets[i]}`),
        `socket_event_duration_seconds_bucket{event="${event}",le="+Inf"} ${value.count}`,
        `socket_event_duration_seconds_count{event="${event}"} ${value.count}`,
        `socket_event_duration_seconds_sum{event="${event}"} ${value.sum}`,
    ].join('\n')),
].join('\n') + '\n';
module.exports = { increment, observe, render, connect: () => { active++; }, disconnect: () => { active = Math.max(0, active - 1); } };
