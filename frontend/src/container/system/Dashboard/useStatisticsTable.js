import { useCallback, useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import useListQuery, { clampListPage } from '../../../util/useListQuery';
import { PAGINATION } from '../../../util/constant';

/** Bo loc ngay + trang cua mot bang thong ke, luu tren URL (co tien to rieng). */
export const useStatisticsQuery = (defaults, prefix) => {
    const [savedQuery, setQuery] = useListQuery(defaults, { prefix, persistDefaults: ['fromDate', 'toDate'] });
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value).isValid() && dayjs(value).format('YYYY-MM-DD') === value;
    const validRange = validDate(savedQuery.fromDate) && validDate(savedQuery.toDate) && savedQuery.fromDate <= savedQuery.toDate;
    const { fromDate, toDate } = defaults;
    useEffect(() => {
        if (!validRange) setQuery({ fromDate, toDate }, { replace: true });
    }, [validRange, fromDate, toDate, setQuery]);
    return [validRange ? savedQuery : { ...savedQuery, fromDate, toDate }, setQuery];
};

// Each table owns its request sequence so a slow response cannot replace a
// newer page, including requests made by dashboard auto-refresh.
export const useStatisticsTable = (query, setQuery, service, enabled, companyId) => {
    const [result, setResult] = useState({ data: [], count: 0, sum: 0 });
    const [failure, setFailure] = useState(null);
    const [loading, setLoading] = useState(enabled);
    const sequence = useRef(0);
    const key = JSON.stringify([query.page, query.fromDate, query.toDate, enabled, companyId]);
    const currentKey = useRef(key);
    currentKey.current = key;
    const reload = useCallback(async () => {
        if (!enabled) return;
        const request = ++sequence.current;
        setFailure(null);
        setLoading(true);
        try {
            const response = await service({
                limit: PAGINATION.pagerow,
                offset: query.page * PAGINATION.pagerow,
                fromDate: query.fromDate,
                toDate: query.toDate,
                ...(companyId ? { companyId } : {}),
            });
            if (request !== sequence.current || currentKey.current !== key) return;
            if (response?.errCode !== 0) throw Error('statistics-unavailable');
            const page = clampListPage(query.page, response.count, PAGINATION.pagerow);
            if (page !== query.page) {
                setQuery({ page }, { replace: true });
                return;
            }
            setResult({ key, data: response.data || [], count: Math.ceil(response.count / PAGINATION.pagerow), sum: response.sum || 0 });
        } catch {
            if (request === sequence.current && currentKey.current === key) {
                setFailure({ key, message: 'Không tải được dữ liệu thống kê. Vui lòng thử Làm mới.' });
            }
        } finally {
            if (request === sequence.current && currentKey.current === key) setLoading(false);
        }
    }, [query.page, query.fromDate, query.toDate, enabled, companyId, service, setQuery, key]);
    useEffect(() => {
        reload();
        return () => { sequence.current += 1; };
    }, [reload]);
    // Retain the previous table geometry while its replacement loads. StableList
    // marks these rows unavailable until the current request succeeds.
    return {
        ...(result.key !== key && failure?.key === key ? { data: [], count: 0, sum: 0 } : result),
        loading: enabled && (loading || (result.key !== key && failure?.key !== key)),
        error: failure?.key === key ? failure.message : '',
        reload,
    };
};
