// Recent answers to the opening question of a conversation. Quick-question buttons and
// menu shortcuts send the same text for every visitor, so a model answer from the last
// few minutes is replayed instantly instead of waiting for the gateway again. Only
// complete model answers are stored; the TTL bounds how stale job results can be.
export const answerKey = text => String(text || '').normalize('NFC').toLowerCase()
    .replace(/\s+/g, ' ').replace(/[\s?.!…]+$/, '').trim();

export function createAnswerCache({ ttlMs = 10 * 60000, max = 200, now = Date.now } = {}) {
    const entries = new Map();
    return {
        get(key) {
            const entry = entries.get(key);
            if (!entry) return null;
            entries.delete(key);
            if (entry.expiresAt <= now()) return null;
            entries.set(key, entry);
            return entry.value;
        },
        set(key, value) {
            if (!(ttlMs > 0) || !key) return;
            entries.delete(key);
            entries.set(key, { value, expiresAt: now() + ttlMs });
            while (entries.size > max) entries.delete(entries.keys().next().value);
        }
    };
}
