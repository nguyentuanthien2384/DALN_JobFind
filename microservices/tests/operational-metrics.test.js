import { describe, expect, it, vi } from 'vitest';
import { Registry } from '@prometheus-io/client';
import { registerOutboxMetrics, registerAiTaskMetrics } from '../shared/operationalMetrics.js';

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
});
