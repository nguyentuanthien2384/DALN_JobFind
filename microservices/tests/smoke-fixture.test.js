import { describe, expect, it } from 'vitest';
import { buildAuditCleanupFilter } from '../scripts/test-fixture.js';

describe('smoke fixture audit cleanup safety', () => {
    it('khong tao bo loc xoa rong khi khong co dau hieu cua luot smoke', () => {
        expect(buildAuditCleanupFilter()).toBeNull();
        expect(buildAuditCleanupFilter({ correlationId: '  ', postIds: [], taskIds: [] }))
            .toBeNull();
    });

    it('chi doi chieu action theo correlation ID chinh xac', () => {
        expect(buildAuditCleanupFilter({ correlationId: 'smoke-run-1' })).toEqual({
            $or: [{ kind: 'action', correlationId: 'smoke-run-1' }]
        });
    });

    it('doi chieu event theo ID tam va loai doi tuong, co loai trung', () => {
        expect(buildAuditCleanupFilter({
            correlationId: 'smoke-run-2',
            postIds: [123, '123', null],
            taskIds: ['task-1', '', 'task-1']
        })).toEqual({
            $or: [
                { kind: 'action', correlationId: 'smoke-run-2' },
                { kind: 'event', targetType: 'job', targetId: { $in: ['123'] } },
                { kind: 'event', targetType: 'ai_task', targetId: { $in: ['task-1'] } }
            ]
        });
    });
});
