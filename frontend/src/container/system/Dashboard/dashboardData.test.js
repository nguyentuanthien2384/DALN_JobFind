import dayjs from 'dayjs';
import {
    bucketSeries, buildTrend, byDay, describeEvent, labelAuditSources, percentChange, relativeTime, resolvePeriod,
    sumRange, topWithOther, trendPeriodFor,
} from './dashboardData';

const now = dayjs('2026-10-03T10:00:00');

describe('resolvePeriod', () => {
    it('builds inclusive presets and the equally long period right before them', () => {
        expect(resolvePeriod({ period: '7d' }, now)).toEqual({
            key: '7d', days: 7, from: '2026-09-27', to: '2026-10-03',
            previous: { from: '2026-09-20', to: '2026-09-26' },
        });
        expect(resolvePeriod({ period: 'today' }, now)).toMatchObject({ days: 1, from: '2026-10-03', previous: { from: '2026-10-02', to: '2026-10-02' } });
        expect(resolvePeriod({ period: '365d' }, now)).toMatchObject({ days: 365, from: '2025-10-04' });
    });

    it('accepts a valid custom range and rejects malformed, reversed, future or oversized ones', () => {
        expect(resolvePeriod({ period: 'custom', from: '2026-08-01', to: '2026-08-20' }, now)).toMatchObject({
            key: 'custom', days: 20, previous: { from: '2026-07-12', to: '2026-07-31' },
        });
        for (const range of [
            { from: '2026-02-30', to: '2026-03-01' },
            { from: '2026-08-20', to: '2026-08-01' },
            { from: '2026-10-01', to: '2026-10-05' },
            { from: '2024-01-01', to: '2026-01-01' },
            { from: '', to: '' },
        ]) {
            expect(resolvePeriod({ period: 'custom', ...range }, now)).toMatchObject({ key: '30d', from: '2026-09-04', to: '2026-10-03' });
        }
        expect(resolvePeriod({ period: 'unknown' }, now).key).toBe('30d');
    });

    it('widens periods shorter than a week for the trend chart', () => {
        const today = resolvePeriod({ period: 'today' }, now);
        expect(trendPeriodFor(today)).toMatchObject({ days: 14, from: '2026-09-20', to: '2026-10-03' });
        const month = resolvePeriod({ period: '30d' }, now);
        expect(trendPeriodFor(month)).toBe(month);
    });
});

describe('series helpers', () => {
    it('reads day strings and timestamps, sums duplicates and fills every day of the period', () => {
        const map = byDay([
            { ngay: '2026-10-02', soLuong: '2' },
            { ngay: '2026-10-02', soLuong: 1 },
            { ngay: dayjs('2026-09-26').toISOString(), soLuong: 4 },
            { ngay: 'not a day', soLuong: 9 },
        ]);
        expect([...map]).toEqual([['2026-10-02', 3], ['2026-09-26', 4]]);
        const period = resolvePeriod({ period: '7d' }, now);
        expect(sumRange(map, period.from, period.to)).toBe(3);
        expect(sumRange(map, period.previous.from, period.previous.to)).toBe(4);
        const trend = buildTrend(map, period);
        expect(trend).toHaveLength(7);
        expect(trend[5]).toEqual({ day: '2026-10-02', label: '02/10', current: 3, previous: 0 });
        expect(trend[6]).toMatchObject({ current: 0, previous: 4 });
    });

    it('buckets long periods by month', () => {
        const period = resolvePeriod({ period: 'custom', from: '2026-01-15', to: '2026-05-02' }, now);
        const { monthly, points } = bucketSeries({ hoSo: new Map([['2026-01-20', 2], ['2026-01-31', 1], ['2026-05-02', 4]]) }, period);
        expect(monthly).toBe(true);
        expect(points.map(point => [point.label, point.hoSo])).toEqual([
            ['01/2026', 3], ['02/2026', 0], ['03/2026', 0], ['04/2026', 0], ['05/2026', 4],
        ]);
    });

    it('compares with the previous period and marks values without a baseline', () => {
        expect(percentChange(150, 100)).toBe(50);
        expect(percentChange(50, 100)).toBe(-50);
        expect(percentChange(0, 0)).toBe(0);
        expect(percentChange(5, 0)).toBeNull();
        expect(percentChange('12', '8')).toBe(50);
    });

    it('keeps the top rows and groups the rest as other', () => {
        const result = topWithOther([
            { ten: 'A', soLuong: 5 }, { ten: 'B', soLuong: 3 }, { ten: null, soLuong: 1 }, { ten: 'D', soLuong: 1 }, { ten: 'E', soLuong: 0 },
        ], 2);
        expect(result.total).toBe(10);
        expect(result.rows).toEqual([
            { name: 'A', value: 5, share: 50 },
            { name: 'B', value: 3, share: 30 },
            { name: 'Khác', value: 2, other: true, share: 20 },
        ]);
    });

    it('merges audit producers of one service under one Vietnamese label', () => {
        expect(labelAuditSources([
            { ten: 'job', soLuong: 2 }, { ten: 'job-core-service', soLuong: '3' }, { ten: 'mystery', soLuong: 1 },
        ])).toEqual([{ ten: 'Tin tuyển dụng', soLuong: 5 }, { ten: 'mystery', soLuong: 1 }]);
    });
});

describe('describeEvent', () => {
    it('explains business events and links job targets to the public job page', () => {
        expect(describeEvent({ name: 'application.submitted', targetType: 'job', targetId: '233' })).toMatchObject({
            title: 'Ứng viên nộp hồ sơ', target: { label: 'Tin #233', to: '/detail-job/233' },
        });
        expect(describeEvent({ name: 'application.stage_changed', payload: { toStage: 'phong_van' } }).title)
            .toBe('Hồ sơ chuyển sang “Phỏng vấn”');
        expect(describeEvent({ name: 'ai.result', payload: { type: 'match_cv', ok: true } })).toMatchObject({ title: 'AI chấm độ phù hợp CV hoàn tất', tone: 'success' });
        expect(describeEvent({ name: 'ai.result', payload: { type: 'parse_resume', ok: false } })).toMatchObject({ title: 'AI đọc CV thất bại', tone: 'danger' });
        expect(describeEvent({ name: 'ai.generate_cv' }).title).toBe('Yêu cầu AI tạo CV');
        expect(describeEvent({ name: 'billing.custom', targetType: 'application', targetId: '9' })).toMatchObject({
            title: 'billing.custom', target: { label: 'Hồ sơ #9' },
        });
    });
});

describe('relativeTime', () => {
    it('uses short relative wording for recent activity', () => {
        expect(relativeTime('2026-10-03T09:59:40', now)).toBe('vừa xong');
        expect(relativeTime('2026-10-03T09:35:00', now)).toBe('25 phút trước');
        expect(relativeTime('2026-10-03T07:00:00', now)).toBe('3 giờ trước');
        expect(relativeTime('2026-10-02T14:05:00', now)).toBe('Hôm qua 14:05');
        expect(relativeTime('2026-09-28T09:12:00', now)).toBe('28/09 09:12');
        expect(relativeTime('2025-12-01T09:12:00', now)).toBe('01/12/2025');
        expect(relativeTime('invalid', now)).toBe('');
    });
});
