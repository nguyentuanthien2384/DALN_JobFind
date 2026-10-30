import { describe, expect, it, vi } from 'vitest';
import { Registry } from '@prometheus-io/client';
import {
    registerOutboxMetrics,
    registerAiTaskMetrics,
    registerNotificationDeliveryMetrics,
    registerCircuitBreakerMetrics
} from '../shared/operationalMetrics.js';

describe('durable backlog metrics', () => {
    it('reads one snapshot and exposes pending count and real oldest age', async () => {
        const registry = new Registry();
        const read = vi.fn(async () => ({ pending: '4', oldest: new Date(Date.now() - 65000) }));
        registerOutboxMetrics(registry, read);
        const values = await registry.getMetricsAsJSON();
        expect(read).toHaveBeenCalledOnce();
        expect(values.find((item) => item.name === 'jobfind_outbox_pending').values[0].value).toBe(4);
        expect(values.find((item) => item.name === 'jobfind_outbox_oldest_seconds').values[0].value).toBeGreaterThanOrEqual(65);
    });
    it('does not report an empty queue when a query fails', async () => {
        const registry = new Registry();
        registerOutboxMetrics(registry, async () => { throw new Error('database offline'); });
        await expect(registry.metrics()).rejects.toThrow('database offline');
    });
    it('uses only the fixed AI states and reports zero age for no pending tasks', async () => {
        const registry = new Registry();
        registerAiTaskMetrics(registry, async () => [{ status: 'done', total: 4 }, { status: 'private-user-value', total: 3 }]);
        const metrics = await registry.metrics();
        expect(metrics).toContain('jobfind_ai_tasks{state="done"} 4');
        expect(metrics).toContain('jobfind_ai_oldest_pending_seconds 0');
        expect(metrics).not.toContain('private-user-value');
    });
    it('exposes bounded notification delivery states and oldest pending age', async () => {
        const registry = new Registry();
        registerNotificationDeliveryMetrics(registry, async () => [
            { status: 'pending', total: 2, oldest: new Date(Date.now() - 30000) },
            { status: 'sent', total: 11 },
            { status: 'unbounded-custom-state', total: 9 }
        ]);
        const metrics = await registry.metrics();
        expect(metrics).toContain('jobfind_notification_deliveries{state="pending"} 2');
        expect(metrics).toContain('jobfind_notification_deliveries{state="sent"} 11');
        expect(metrics).not.toContain('unbounded-custom-state');
        const values = await registry.getMetricsAsJSON();
        expect(values.find((item) => item.name === 'jobfind_notification_oldest_pending_seconds').values[0].value).toBeGreaterThanOrEqual(30);
    });
    it('exposes gateway circuit breaker state and outcome totals per downstream target', async () => {
        const registry = new Registry();
        registerCircuitBreakerMetrics(registry, () => [
            { service: 'jobs', state: 'closed', stats: { successes: 10, failures: 0, timeouts: 0, rejects: 0 } },
            { service: 'search', state: 'open', stats: { successes: 2, failures: 5, timeouts: 1, rejects: 3 } }
        ]);
        const metrics = await registry.metrics();
        expect(metrics).toContain('jobfind_gateway_breaker_state{target="jobs"} 0');
        expect(metrics).toContain('jobfind_gateway_breaker_state{target="search"} 2');
        expect(metrics).toContain('jobfind_gateway_breaker_totals{target="search",outcome="failures"} 5');
        expect(metrics).toContain('jobfind_gateway_breaker_totals{target="search",outcome="rejects"} 3');
    });
});
