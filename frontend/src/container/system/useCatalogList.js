import useListLoading from './useListLoading';
import { useCallback, useEffect, useState } from 'react';
import useListQuery, { clampListPage } from '../../util/useListQuery';
import CommonUtils from '../../util/CommonUtils';
import { DEFAULT_PAGE_SIZE, normalizePageSize, pageForSize } from './List/AdminList';

// Catalogs and package lists share the same URL-backed paging behavior.
export default function useCatalogList(fetchList, { type, withCategory = false } = {}) {
    const [query, setQuery] = useListQuery({
        page: 0,
        search: '',
        size: DEFAULT_PAGE_SIZE,
        ...(withCategory ? { categoryJobCode: '' } : {}),
    });
    const { page, search, categoryJobCode } = query;
    const pageSize = normalizePageSize(query.size);
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [revision, setRevision] = useState(0);
    const [searchDraft, setSearchDraft] = useState(search);
    const [loading, setLoading] = useListLoading(JSON.stringify([type, withCategory, categoryJobCode, page, pageSize, search, revision]));
    useEffect(() => setSearchDraft(search), [search]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        const load = async () => {
            try {
                const result = await fetchList({
                    ...(type ? { type } : {}),
                    ...(withCategory ? { categoryJobCode } : {}),
                    limit: pageSize,
                    offset: page * pageSize,
                    search: CommonUtils.removeSpace(search),
                });
                if (!active) return;
                if (result?.errCode === 0) {
                    const validPage = clampListPage(page, result.count, pageSize);
                    setTotal(Math.max(0, Number(result.count) || 0));
                    if (validPage !== page) {
                        setQuery({ page: validPage }, { replace: true });
                        return;
                    }
                    setRows(result.data || []);
                } else {
                    setRows([]);
                    setTotal(0);
                }
            } catch (error) {
                if (active) { setRows([]); setTotal(0); }
            } finally {
                if (active) setLoading(false);
            }
        };
        load();
        return () => { active = false; };
    }, [fetchList, type, withCategory, categoryJobCode, page, pageSize, search, revision, setQuery, setLoading]);

    const refresh = useCallback(() => setRevision(value => value + 1), []);
    const handleChangePage = selected => setQuery({ page: typeof selected === 'number' ? selected : selected.selected });
    const handlePageSizeChange = size => setQuery({ size, page: pageForSize(page, pageSize, size) });
    const handleSearch = value => {
        const normalized = CommonUtils.removeSpace(value);
        setSearchDraft(normalized);
        setQuery(previous => ({
            search: normalized,
            page: CommonUtils.removeSpace(previous.search) === normalized ? previous.page : 0,
        }));
    };
    const handleCategoryChange = value => setQuery(previous => ({
        categoryJobCode: value,
        page: previous.categoryJobCode === value ? previous.page : 0,
    }));
    const resetFilters = () => {
        setSearchDraft('');
        setQuery({ search: '', page: 0, ...(withCategory ? { categoryJobCode: '' } : {}) });
    };
    return {
        rows, total, count: Math.ceil(total / pageSize), loading, numberPage: page, pageSize, categoryJobCode, search, searchDraft,
        filtered: Boolean(search || categoryJobCode), setSearchDraft, handleChangePage, handlePageSizeChange, handleSearch,
        handleCategoryChange, resetFilters, refresh,
    };
}
