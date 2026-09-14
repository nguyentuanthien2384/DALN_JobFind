export const mergeMessages = (...groups) => {
    const messages = new Map();
    for (const group of groups) for (const message of group || []) {
        const previous = messages.get(Number(message.id));
        messages.set(Number(message.id), { ...previous, ...message, isRead: +previous?.isRead === 1 ? 1 : message.isRead });
    }
    return [...messages.values()].sort((a, b) => Number(a.id) - Number(b.id));
};

// Reconcile the gap between the last successful database snapshot and the new
// latest page. Live events do not move this cursor: receiving one new event must
// never cause the client to skip older messages missed while offline.
export const synchronizeConversation = async ({ partnerId, afterId, fetchPage, current }) => {
    const latest = await fetchPage({ partnerId });
    if (!current() || latest?.errCode !== 0) return latest;
    const high = Number(latest.data[latest.data.length - 1]?.id || 0);
    let data = latest.data;
    if (afterId && Number(latest.data[0]?.id) > afterId) {
        let cursor = afterId;
        while (cursor < high && current()) {
            const page = await fetchPage({ partnerId, afterId: cursor });
            if (!current()) return null;
            if (page?.errCode !== 0) return page;
            const next = Number(page.data[page.data.length - 1]?.id || 0);
            if (next <= cursor) return { errCode: -1, errMessage: 'Đồng bộ bị gián đoạn. Vui lòng thử lại.' };
            data = mergeMessages(data, page.data);
            cursor = next;
            if (!page.pageInfo?.hasMore) break;
        }
    }
    return { ...latest, data };
};
