import createListCache from './listCache';

export const retainedAllCode = createListCache({ ttl: 30 * 60 * 1000, limit: 64 });
export const pendingAllCodeRequests = new Map();

// Successful catalog edits invalidate both results and requests started before the edit.
export const clearAllCodeCache = () => {
    retainedAllCode.clear();
    pendingAllCodeRequests.clear();
};
