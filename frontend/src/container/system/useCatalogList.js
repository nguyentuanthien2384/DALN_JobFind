import { useCallback, useEffect, useState } from 'react';
import useListQuery, { clampListPage } from '../../util/useListQuery';
import { PAGINATION } from '../../util/constant';
import CommonUtils from '../../util/CommonUtils';

// Catalogs and package lists share the same URL-backed paging behavior.
export default function useCatalogList(fetchList, { type, withCategory = false } = {}) {
    const [query, setQuery] = useListQuery({
        page: 0,
        search: '',
        ...(withCategory ? { categoryJobCode: '' } : {}),
    });
    const { page, search, categoryJobCode } = query;
    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [revision, setRevision] = useState(0);
    const [searchDraft, setSearchDraft] = useState(search);
    useEffect(() => setSearchDraft(search), [search]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setRows([]);
        const load = async () => {
            try {
                const result = await fetchList({
                    ...(type ? { type } : {}),
                    ...(withCategory ? { categoryJobCode } : {}),
                    limit: PAGINATION.pagerow,
                    offset: page * PAGINATION.pagerow,
                    search: CommonUtils.removeSpace(search),
                });
                if (!active) return;
                if (result?.errCode === 0) {
                    const validPage = clampListPage(page, result.count, PAGINATION.pagerow);
                    setCount(Math.ceil(Math.max(0, Number(result.count) || 0) / PAGINATION.pagerow));
                    if (validPage !== page) {
                        setQuery({ page: validPage }, { replace: true });
                        return;
                    }
                    setRows(result.data || []);
                } else {
                    setCount(0);
                }
            } catch (error) {
                if (active) setCount(0);
            } finally {
                if (active) setLoading(false);
            }
        };
        load();
        return () => { active = false; };
    }, [fetchList, type, withCategory, categoryJobCode, page, search, revision, setQuery]);

    const refresh = useCallback(() => setRevision(value => value + 1), []);
    const handleChangePage = ({ selected }) => setQuery({ page: selected });
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
    return { rows, count, loading, numberPage: page, categoryJobCode, searchDraft,
        setSearchDraft, handleChangePage, handleSearch, handleCategoryChange, refresh };
}
