// Recent list results kept in memory for this browser tab and the signed-in account,
// so coming back to a list (Back button, switching tabs) paints it at once and then
// refreshes it quietly, instead of collapsing the page while it reloads.
const caches = new Set();

/** Forget every remembered list (tests, and nothing else, need this). */
export const clearListCaches = () => caches.forEach(cache => cache.clear());

export default function createListCache({ ttl = 5 * 60 * 1000, limit = 20 } = {}) {
    const entries = new Map();
    const pending = new Map();
    let owner;
    // A different (or no) account must never see the previous account's lists.
    const scoped = () => {
        const token = localStorage.getItem('token_user');
        if (token !== owner) {
            entries.clear();
            pending.clear();
            owner = token;
        }
        return token;
    };
    const cache = {
        /** The remembered value with its age, or null when missing or older than `ttl`. */
        read(key) {
            scoped();
            const entry = entries.get(key);
            return entry && Date.now() - entry.savedAt < ttl ? entry : null;
        },
        save(key, value) {
            scoped();
            entries.delete(key);
            entries.set(key, { value, savedAt: Date.now() });
            if (entries.size > limit) entries.delete(entries.keys().next().value);
        },
        forget(key) {
            scoped();
            entries.delete(key);
        },
        /** Fetch and remember a list; callers asking for the same key at once share one request. */
        load(key, fetchList, { reuseFor = 0 } = {}) {
            const token = scoped();
            const entry = cache.read(key);
            if (entry && Date.now() - entry.savedAt < reuseFor) return Promise.resolve(entry.value);
            if (!pending.has(key)) {
                const request = new Promise(resolve => resolve(fetchList())).then(value => {
                    if (localStorage.getItem('token_user') === token) cache.save(key, value);
                    return value;
                }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
                pending.set(key, request);
            }
            return pending.get(key);
        },
        clear() {
            entries.clear();
            pending.clear();
        },
    };
    caches.add(cache);
    return cache;
}
