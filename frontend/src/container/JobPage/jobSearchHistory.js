import { useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

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
    const [restored] = useState(() => entries.get(key));
    const latest = useRef(restored);
    const position = useRef(restored?.position || { x: 0, y: 0 });

    useLayoutEffect(() => {
        const track = () => { position.current = { x: window.scrollX, y: window.scrollY }; };
        const root = document.documentElement;
        const previousBehavior = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        window.scrollTo(position.current.x, position.current.y);
        root.style.scrollBehavior = previousBehavior;
        window.addEventListener('scroll', track, { passive: true });
        window.addEventListener('click', track, true);
        return () => {
            window.removeEventListener('scroll', track);
            window.removeEventListener('click', track, true);
            if (localStorage.getItem('token_user') !== token) return;
            entries.delete(key);
            entries.set(key, { ...latest.current, position: position.current });
            while (entries.size > 20) entries.delete(entries.keys().next().value);
        };
    }, [key, token]);

    return [restored, snapshot => { latest.current = snapshot; }];
}
