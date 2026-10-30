import { Gauge } from '@prometheus-io/client';

// One bounded, shared snapshot per scrape; no accumulating queries if a DB hangs.
const snapshot = (read) => {
    let pending;
    let cached;
    let until = 0;
    return async () => {
        if (cached && Date.now() < until) return cached;
        if (!pending) {
            pending = Promise.resolve().then(read);
            pending.then((rows) => { cached = rows; until = Date.now() + 1000; pending = null; }, () => { pending = null; });
        }
        let timer;
        try {
            return await Promise.race([pending, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Metrics snapshot unavailable')), 2000);
            })]);
        } finally { clearTimeout(timer); }
    };
};
const age = (value) => value ? Math.max(0, (Date.now() - new Date(value).getTime()) / 1000) : 0;

export const registerOutboxMetrics = (registry, read) => {
    const get = snapshot(read);
    new Gauge({ name: 'jobfind_outbox_pending', help: 'Committed outbox events awaiting broker confirmation', registers: [registry],
        async collect() { this.set(Number((await get()).pending)); } });
    new Gauge({ name: 'jobfind_outbox_oldest_seconds', help: 'Age of the oldest unpublished event', registers: [registry],
        async collect() { this.set(age((await get()).oldest)); } });
};

export const registerAiTaskMetrics = (registry, read) => {
    const get = snapshot(read);
    new Gauge({ name: 'jobfind_ai_tasks', help: 'Durable AI tasks by bounded state (not a lifetime counter)', labelNames: ['state'], registers: [registry],
        async collect() {
            const rows = await get();
            for (const state of ['pending', 'done', 'failed']) {
                this.set({ state }, Number(rows.find((row) => row.status === state)?.total || 0));
            }
        } });
    new Gauge({ name: 'jobfind_ai_oldest_pending_seconds', help: 'Age of the oldest pending AI task', registers: [registry],
        async collect() { this.set(age((await get()).find((row) => row.status === 'pending')?.oldest)); } });
};

export const registerNotificationDeliveryMetrics = (registry, read) => {
    const get = snapshot(read);
    new Gauge({ name: 'jobfind_notification_deliveries', help: 'Durable notification deliveries by bounded state', labelNames: ['state'], registers: [registry],
        async collect() {
            const rows = await get();
            for (const state of ['pending', 'sent', 'failed', 'unknown']) {
                this.set({ state }, Number(rows.find((row) => row.status === state)?.total || 0));
            }
        } });
    new Gauge({ name: 'jobfind_notification_oldest_pending_seconds', help: 'Age of the oldest pending notification delivery', registers: [registry],
        async collect() { this.set(age((await get()).find((row) => row.status === 'pending')?.oldest)); } });
};

export const registerCircuitBreakerMetrics = (registry, readBreakers) => {
    const stateToCode = { closed: 0, 'half-open': 1, open: 2 };
    new Gauge({ name: 'jobfind_gateway_breaker_state', help: 'Circuit breaker state per downstream target (0=closed, 1=half-open, 2=open)', labelNames: ['target'], registers: [registry],
        collect() {
            const items = readBreakers() || [];
            for (const item of items) {
                if (!item?.service) continue;
                this.set({ target: String(item.service) }, stateToCode[item.state] ?? 0);
            }
        } });
    new Gauge({ name: 'jobfind_gateway_breaker_totals', help: 'Circuit breaker cumulative outcomes per downstream target', labelNames: ['target', 'outcome'], registers: [registry],
        collect() {
            const items = readBreakers() || [];
            for (const item of items) {
                if (!item?.service) continue;
                for (const outcome of ['successes', 'failures', 'timeouts', 'rejects']) {
                    this.set({ target: String(item.service), outcome }, Number(item.stats?.[outcome] || 0));
                }
            }
        } });
};
