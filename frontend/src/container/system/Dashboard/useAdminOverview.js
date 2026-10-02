import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
    getAuditLogs, getDistribution, getOverview, getSystemFunnel, getSystemStatus, getTimeseries,
} from '../../../service/adminReportService';
import { trendPeriodFor } from './dashboardData';

const SOURCES = ['current', 'previous', 'series', 'funnel', 'distribution', 'events', 'status'];

// Moi nguon tra ve du lieu hoac undefined (loi). Khong de mot nguon hong lam
// hong ca dashboard.
const dataOf = (request) => Promise.resolve().then(request).then(
    response => (response?.errCode === 0 ? response.data : undefined),
    () => undefined
);
const statusOf = () => Promise.resolve().then(getSystemStatus).then(
    response => (Array.isArray(response?.services) ? response : undefined),
    () => undefined
);

/**
 * Tai toan bo so lieu cho dashboard quan tri cua mot khoang thoi gian.
 *
 * - Phan hoi cham cua khoang cu khong duoc ghi de khoang moi (dem request).
 * - Lam moi that bai thi giu so lieu cu cua CUNG khoang, danh dau nguon do loi.
 * - Bao loi tong quan bang toast MOT lan cho toi khi tai lai duoc.
 */
const useAdminOverview = (period) => {
    const key = JSON.stringify([period.from, period.to]);
    const [state, setState] = useState({ key: null, data: {}, failed: {} });
    const [loading, setLoading] = useState(true);
    const sequence = useRef(0);
    const warned = useRef(false);
    const periodRef = useRef(period);
    periodRef.current = period;

    const reload = useCallback(async () => {
        const request = ++sequence.current;
        const range = periodRef.current;
        const trend = trendPeriodFor(range);
        const seriesFrom = [range.previous.from, trend.previous.from].sort()[0];
        setLoading(true);
        const results = await Promise.all([
            dataOf(() => getOverview({ fromDate: range.from, toDate: range.to })),
            dataOf(() => getOverview({ fromDate: range.previous.from, toDate: range.previous.to })),
            dataOf(() => getTimeseries({ fromDate: seriesFrom, toDate: range.to })),
            dataOf(getSystemFunnel),
            dataOf(getDistribution),
            dataOf(() => getAuditLogs({ kind: 'event', limit: 8 })),
            statusOf(),
        ]);
        if (request !== sequence.current) return;
        setState(previous => {
            const sameRange = previous.key === key;
            const data = {};
            const failed = {};
            SOURCES.forEach((source, index) => {
                const value = results[index];
                if (value === undefined) failed[source] = true;
                data[source] = value !== undefined ? value : sameRange ? previous.data[source] : undefined;
            });
            return { key, data, failed };
        });
        if (results[0] === undefined) {
            if (!warned.current) {
                warned.current = true;
                toast.error('Không tải được số liệu tổng quan. Dashboard sẽ tự thử lại.');
            }
        } else {
            warned.current = false;
        }
        setLoading(false);
    }, [key]);

    useEffect(() => {
        reload();
        return () => { sequence.current += 1; };
    }, [reload]);

    // Doi khoang thoi gian thi van giu so lieu cu tren man hinh (lam mo di) cho
    // toi khi so lieu moi ve, de bo cuc khong nhay.
    const current = state.key === key;
    return {
        data: state.data,
        failed: current ? state.failed : {},
        loaded: state.key !== null,
        loading: loading || !current,
        reload,
    };
};

export default useAdminOverview;
