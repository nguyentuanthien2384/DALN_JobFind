import { useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { canonicalJobLevelFilter } from './jobLevels';

// Combine updates from independent lists in the same browser event/React commit.
const pendingSearches = new WeakMap();

function readValue(raw, fallback, key) {
    if (raw === null) return fallback;
    if (key === 'page') {
        const page = Number(raw);
        return Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page - 1 : fallback;
    }
    if (Array.isArray(fallback)) {
        try {
            const value = JSON.parse(raw);
            return Array.isArray(value) && value.length <= 100 && value.every(item =>
                typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item))) ? value : fallback;
        } catch { return fallback; }
    }
    if (typeof fallback === 'number') return raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : fallback;
    if (typeof fallback === 'boolean') return raw === 'true' || raw === '1' ? true : raw === 'false' || raw === '0' ? false : fallback;
    return raw;
}

export function readListQuery(search, defaults, prefix = '') {
    const params = new URLSearchParams(search);
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
        const value = readValue(params.get(`${prefix}${key}`), fallback, key);
        return [key, key === 'categoryJoblevelCode' ? canonicalJobLevelFilter(value) : value];
    }));
}

export function clampListPage(page, total, pageSize) {
    if ((typeof total !== 'number' && typeof total !== 'string') || String(total).trim() === ''
        || !Number.isSafeInteger(Number(total)) || Number(total) < 0 || !(pageSize > 0)) return page;
    return Math.max(0, Math.min(page, Math.ceil(Number(total) / pageSize) - 1));
}

/** List state belongs to its URL: browser reload, Back, Forward and copied links agree. */
export default function useListQuery(defaults, { prefix = '', persistDefaults = [] } = {}) {
    const location = useLocation();
    const navigate = useNavigate();
    const schemaKey = JSON.stringify(defaults);
    const schema = useMemo(() => JSON.parse(schemaKey), [schemaKey]);
    const query = useMemo(() => readListQuery(location.search, schema, prefix), [location.search, schema, prefix]);
    const current = useRef();
    current.current = { location, navigate, schema, prefix, persistDefaults };
    const setQuery = useCallback((update, { replace = false } = {}) => {
        const { location: route, navigate: go, schema: fields, prefix: namespace, persistDefaults: pinned } = current.current;
        const search = pendingSearches.get(route)?.search ?? route.search;
        const previous = readListQuery(search, fields, namespace);
        const next = { ...previous, ...(typeof update === 'function' ? update(previous) : update) };
        const params = new URLSearchParams(search);
        for (const [key, fallback] of Object.entries(fields)) {
            const value = next[key] ?? fallback;
            const name = `${namespace}${key}`;
            if (!pinned.includes(key) && JSON.stringify(value) === JSON.stringify(fallback)) params.delete(name);
            else if (key === 'page') {
                if (Number.isSafeInteger(value) && value >= 0 && value < 100000) params.set(name, String(value + 1));
                else params.delete(name);
            } else params.set(name, Array.isArray(value) ? JSON.stringify(value) : String(value));
        }
        const nextSearch = params.toString() ? `?${params.toString()}` : '';
        if (nextSearch === search) return;
        const pending = { search: nextSearch };
        pendingSearches.set(route, pending);
        queueMicrotask(() => { if (pendingSearches.get(route) === pending) pendingSearches.delete(route); });
        go({ pathname: route.pathname, search: nextSearch, hash: route.hash },
            { replace, state: route.state, preventScrollReset: true });
    }, []);
    return [query, setQuery];
}
