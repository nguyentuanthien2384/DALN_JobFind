// Keep the application being prepared in this tab, including across an SSO
// round trip. This is navigation context only; the API still checks permission.
const KEY = 'jobfind:application-intent';
const MAX_AGE = 30 * 60 * 1000;
const validId = value => typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value);

export const clearApplicationIntent = () => {
    try { sessionStorage.removeItem(KEY); } catch { /* Browsing still works without storage. */ }
};

export const readApplicationIntent = () => {
    try {
        const intent = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        if (!intent) return null;
        const age = Date.now() - intent.createdAt;
        if (!validId(intent.jobId) || typeof intent.jobTitle !== 'string'
            || intent.jobTitle.length > 300 || !Number.isFinite(intent.createdAt)
            || age < 0 || age >= MAX_AGE) {
            clearApplicationIntent();
            return null;
        }
        return intent;
    } catch { clearApplicationIntent(); return null; }
};

export const rememberApplicationIntent = ({ jobId, jobTitle }) => {
    clearApplicationIntent();
    const id = String(jobId);
    if (!validId(id)) return false;
    try {
        sessionStorage.setItem(KEY, JSON.stringify({
            jobId: id, jobTitle: String(jobTitle || '').slice(0, 300), createdAt: Date.now(),
        }));
        return true;
    } catch { return false; }
};

export const getApplicationReturnPath = user => {
    const intent = readApplicationIntent();
    return user && intent ? `/detail-job/${intent.jobId}` : null;
};
