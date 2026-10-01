// Leave headroom below the server's 60/minute limit and its 750ms per-pair
// window. Only new edits schedule a trailing notification; idle drafts do not.
const TYPING_INTERVAL_MS = 1200;
const RECENT_EDIT_MS = 3000;

export const createTypingNotifier = (getSocket, userId) => {
    const storageKey = `jobfind:chat:typing:${userId}`;
    let lastSentAt = null;
    let timer;
    try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved !== null && Number.isFinite(Number(saved))) lastSentAt = Number(saved);
    } catch { /* Typing still works when browser storage is unavailable. */ }

    const cancel = () => { clearTimeout(timer); timer = undefined; };
    const notify = (partnerId, value) => {
        cancel();
        const socket = getSocket();
        const receiverId = Number(partnerId);
        if (!value.trim() || !Number.isSafeInteger(receiverId) || receiverId < 1 || !socket?.connected) return;
        const editedAt = Date.now();
        const emit = () => {
            timer = undefined;
            // Never buffer an offline draft or revive an old edit after a
            // suspended tab resumes or the signed-in socket changes.
            if (!socket.connected || getSocket() !== socket || Date.now() - editedAt > RECENT_EDIT_MS) return;
            lastSentAt = Date.now();
            try { sessionStorage.setItem(storageKey, String(lastSentAt)); } catch {}
            // Volatile events can be dropped while a connected transport is
            // busy. This bounded event should wait for its active transport.
            socket.emit('chat:typing', { receiverId });
        };
        const delay = lastSentAt === null ? 0
            : Math.min(TYPING_INTERVAL_MS, Math.max(0, TYPING_INTERVAL_MS - (editedAt - lastSentAt)));
        if (delay > 0) timer = setTimeout(emit, delay);
        else emit();
    };
    return { notify, cancel };
};
