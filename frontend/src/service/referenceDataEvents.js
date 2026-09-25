// Catalog changes affect joined job labels as well as dropdown options.
export const REFERENCE_DATA_STORAGE_KEY = 'jobfind.reference-data.revision';
let revision = 0;
const listeners = new Set();
const fingerprints = new Map();

export const getReferenceDataRevision = () => revision;
export const subscribeReferenceDataChanges = listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const changed = () => {
    revision += 1;
    fingerprints.clear();
    listeners.forEach(listener => listener());
};

export const invalidateReferenceData = () => {
    changed();
    try {
        localStorage.setItem(REFERENCE_DATA_STORAGE_KEY, `${Date.now()}:${Math.random()}`);
    } catch { /* Updates in this tab still work when browser storage is unavailable. */ }
};

export const observeReferenceData = (type, rows, requestRevision) => {
    if (requestRevision !== revision) return false;
    const fingerprint = JSON.stringify(rows.map(({ code, value, image }) => [code, value, image])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    const previous = fingerprints.get(type);
    if (previous !== undefined && previous !== fingerprint) invalidateReferenceData();
    fingerprints.set(type, fingerprint);
    return true;
};

if (typeof window !== 'undefined') {
    window.addEventListener('storage', event => {
        if (event.key === REFERENCE_DATA_STORAGE_KEY && event.newValue !== event.oldValue) changed();
    });
}
