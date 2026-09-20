const keyOf = (userId, partnerId) => `jobfind:chat:pending:${userId}:${partnerId}`;
export const readPending = (userId, partnerId) => {
    try {
        const value = JSON.parse(sessionStorage.getItem(keyOf(userId, partnerId)));
        return value && value.receiverId === Number(partnerId) && typeof value.content === 'string'
            && typeof value.clientMessageId === 'string' ? value : null;
    } catch { return null; }
};
export const preparePending = (userId, partnerId, content, media = {}) => {
    const previous = readPending(userId, partnerId);
    if (previous) {
        if (previous.content !== content || (previous.attachmentId || null) !== (media.attachmentId || null)
            || (previous.jobPostId || null) !== (media.jobPostId || null)) throw new Error('Tin nhắn trước chưa được xác nhận. Hãy gửi lại tin đó trước.');
        return previous;
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    const payload = { v: 1, receiverId: Number(partnerId), content,
        ...(media.attachmentId ? { attachmentId: media.attachmentId } : {}),
        ...(media.jobPostId ? { jobPostId: Number(media.jobPostId) } : {}),
        clientMessageId: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') };
    // Persist before sending; if storage is unavailable, do not risk a send
    // whose idempotency key would be lost when the page reloads.
    sessionStorage.setItem(keyOf(userId, partnerId), JSON.stringify(payload));
    return payload;
};
export const clearPending = (userId, partnerId, clientMessageId) => {
    if (readPending(userId, partnerId)?.clientMessageId === clientMessageId) sessionStorage.removeItem(keyOf(userId, partnerId));
};
export const sendReliably = async (socket, payload, sendRest) => {
    let socketOutcomeUnknown = false;
    const started = performance.now();
    const report = (outcome) => {
        try { if (socket?.connected) socket.volatile?.emit('chat:telemetry', {v:1,outcome,durationMs:Math.min(30000,Math.max(0,Math.round(performance.now()-started)))}); } catch {}
    };
    if (socket?.connected) {
        try {
            // Only transport/ACK failure falls back. A business rejection must
            // not be retried through another transport.
            const result = await socket.timeout(5000).emitWithAck('chat:send', payload);
            report('ack'); return result;
        } catch { socketOutcomeUnknown = true; }
    }
    const result = await sendRest(payload);
    report(result?.errCode === 0 ? 'fallback' : 'uncertain');
    // A fallback denial (for example a rate limit) does not prove that the
    // original socket request failed to commit. Keep the key until success.
    return socketOutcomeUnknown && result?.errCode !== 0 ? { ...result, deliveryUncertain: true } : result;
};
