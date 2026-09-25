import { useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getReferenceDataRevision } from '../../service/referenceDataEvents';

// Keep a bounded snapshot per browser history entry, never across accounts.
const entries = new Map();
let sessionToken;
export const SEARCH_SNAPSHOT_TTL = 5 * 60 * 1000;
export const clearJobSearchHistory = () => entries.clear();

export function JobNavigationScroll() {
    const { pathname } = useLocation();
    const original = useRef(window.history.scrollRestoration);
    useLayoutEffect(() => {
        const originalMode = original.current;
        // Native POP restoration runs before React has replaced the detail page.
        // Its shorter height clamps the saved list position, causing a visible jump.
        const selectMode = () => {
            window.history.scrollRestoration = window.location.pathname === '/job' ? 'manual' : originalMode;
        };
        window.addEventListener('popstate', selectMode);
        return () => {
            window.removeEventListener('popstate', selectMode);
            window.history.scrollRestoration = originalMode;
        };
    }, []);
    useLayoutEffect(() => {
        window.history.scrollRestoration = pathname === '/job' ? 'manual' : original.current;
    }, [pathname]);
    return null;
}

export function useJobSearchHistory(key) {
    const token = localStorage.getItem('token_user');
    if (token !== sessionToken) {
        entries.clear();
        sessionToken = token;
    }
    const entry = useMemo(() => {
        const snapshot = entries.get(key);
        // Retain rows and scroll height while reloading a changed catalog, but
        // never accept the old result/label snapshot as a fresh cache entry.
        const restored = snapshot && snapshot.referenceRevision !== getReferenceDataRevision()
            ? { ...snapshot, loadedQuery: null, labelsReady: false, labelsRevision: undefined }
            : snapshot;
        return { key, token, restored, latest: restored, position: restored?.position || { x: window.scrollX, y: window.scrollY } };
    }, [key, token]);
    const mounted = useRef(false);

    useLayoutEffect(() => {
        const track = () => { entry.position = { x: window.scrollX, y: window.scrollY }; };
        // Paging stays mounted and retains the viewport. Only restore an actual
        // history snapshot (or start a fresh route at its top).
        if (entry.restored || !mounted.current) {
            const position = entry.restored?.position || { x: 0, y: 0 };
            const root = document.documentElement;
            const previousBehavior = root.style.scrollBehavior;
            root.style.scrollBehavior = 'auto';
            window.scrollTo(position.x, position.y);
            root.style.scrollBehavior = previousBehavior;
            entry.position = position;
        }
        mounted.current = true;
        window.addEventListener('scroll', track, { passive: true });
        window.addEventListener('click', track, true);
        return () => {
            window.removeEventListener('scroll', track);
            window.removeEventListener('click', track, true);
            if (localStorage.getItem('token_user') !== entry.token) return;
            entries.delete(entry.key);
            entries.set(entry.key, { ...entry.latest, position: entry.position });
            while (entries.size > 20) entries.delete(entries.keys().next().value);
        };
    }, [entry]);

    return [entry.restored, snapshot => { entry.latest = snapshot; }];
}
