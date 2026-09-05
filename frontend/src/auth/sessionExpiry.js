import { disconnectSocket } from '../socket';

export const SESSION_ENDED_EVENT = 'jobfind:session-ended';

// Old releases stored absolute URLs. Accept only this site's non-login pages.
export const safeReturnPath = (value, origin) => {
    if (typeof value !== 'string' || !value || value.includes('\\') || [...value].some((char) => char.charCodeAt(0) < 32)) return null;
    try {
        const target = new URL(value, origin);
        if (target.origin !== origin || target.username || target.password || target.pathname.startsWith('//')
            || /^\/(login|register|forget-password)\/?$/i.test(target.pathname)) return null;
        return target.pathname + target.search + target.hash;
    } catch { return null; }
};

export const createSessionExpiryHandler = ({ storage, location, disconnect, notify }) => (sentToken, reason = 'expired') => {
    // Anonymous/old-login responses cannot end the current session. Removing the
    // token also deduplicates concurrent failures without a permanent global flag.
    if (!sentToken || storage.getItem('token_user') !== sentToken) return false;
    storage.removeItem('userData');
    storage.removeItem('token_user');
    disconnect();
    notify();
    if (!/^\/login\/?$/i.test(location.pathname)) {
        const returnPath = safeReturnPath(location.href, location.origin);
        if (returnPath) storage.setItem('lastUrl', returnPath);
        location.assign(`/login?reason=${reason === 'inactive' ? 'inactive' : 'expired'}`);
    }
    return true;
};

export const expireSession = (sentToken, reason) => createSessionExpiryHandler({
    storage: localStorage, location: window.location, disconnect: disconnectSocket,
    notify: () => window.dispatchEvent(new Event(SESSION_ENDED_EVENT))
})(sentToken, reason);
