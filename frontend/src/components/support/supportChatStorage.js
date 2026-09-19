// Browser-tab-only history; never put tokens or confidential records in storage.
const MAX_THREADS = 6;
const MAX_MESSAGES = 40;
const MAX_CHARS = 1400;
const messageLimit = (role) => role === 'assistant' ? 12000 : MAX_CHARS;
export const supportMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const createThread = () => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Cuộc trò chuyện mới',
    createdAt: Date.now(),
    messages: []
});

// Never persist model-provided URLs: generate same-origin job routes from validated IDs.
export const normalizeSupportCards = (payload) => {
    const raw = Array.isArray(payload?.jobs) ? payload.jobs : (payload?.job ? [payload.job] : []);
    return raw.slice(0, 5).filter((job) => Number.isSafeInteger(job?.id) && job.id > 0)
        .map((job) => ({
            id: job.id,
            name: String(job.name || '').slice(0, 180),
            company: String(job.company || '').slice(0, 120),
            location: String(job.location || '').slice(0, 80),
            salary: String(job.salary || '').slice(0, 80),
            workType: String(job.workType || '').slice(0, 80)
        }));
};

export const createSupportStore = (ownerKey) => {
    const thread = createThread();
    return { ownerKey, activeId: thread.id, threads: [thread] };
};

export const loadSupportStore = (ownerKey) => {
    try {
        const stored = JSON.parse(sessionStorage.getItem(ownerKey));
        if (!stored || !Array.isArray(stored.threads)) return createSupportStore(ownerKey);
        const threads = stored.threads.slice(0, MAX_THREADS).filter((thread) =>
            thread && typeof thread.id === 'string' && Array.isArray(thread.messages)
        ).map((thread) => ({
            id: thread.id.slice(0, 100),
            title: typeof thread.title === 'string' ? thread.title.slice(0, 55) : 'Cuộc trò chuyện',
            createdAt: Number.isFinite(thread.createdAt) ? thread.createdAt : Date.now(),
            messages: thread.messages.slice(-MAX_MESSAGES).filter((message) =>
                message && ['user', 'assistant'].includes(message.role) && typeof message.text === 'string'
            ).map((message) => ({
                id: typeof message.id === 'string' ? message.id.slice(0, 100) : supportMessageId(),
                role: message.role, text: message.text.slice(0, messageLimit(message.role)),
                cards: message.role === 'assistant' ? normalizeSupportCards({ jobs: message.cards }) : [],
                status: message.status === 'cancelled' ? 'cancelled' : 'complete'
            }))
        }));
        if (!threads.length) return createSupportStore(ownerKey);
        return { ownerKey, threads, activeId: threads.some((thread) => thread.id === stored.activeId)
            ? stored.activeId : threads[0].id };
    } catch { return createSupportStore(ownerKey); }
};

export const saveSupportStore = (store) => {
    try {
        const safe = {
            activeId: store.activeId,
            threads: store.threads.slice(0, MAX_THREADS).map((thread) => ({
                id: thread.id, title: thread.title, createdAt: thread.createdAt,
                messages: thread.messages.filter((message) => message.status !== 'pending')
                    .slice(-MAX_MESSAGES).map(({ id, role, text, status, cards }) => ({
                        id, role, text: text.slice(0, messageLimit(role)), status,
                        cards: role === 'assistant' ? normalizeSupportCards({ jobs: cards }) : []
                    }))
            }))
        };
        sessionStorage.setItem(store.ownerKey, JSON.stringify(safe));
    } catch { /* Private browsing/full quota: chat remains usable in memory. */ }
};

export const addSupportThread = (store) => {
    const thread = createThread();
    return { ...store, activeId: thread.id, threads: [thread, ...store.threads].slice(0, MAX_THREADS) };
};

export const updateSupportMessages = (store, threadId, updater) => ({
    ...store,
    threads: store.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        const messages = updater(thread.messages).map((message) => message.id ? message : { ...message, id: supportMessageId() });
        const firstQuestion = messages.find((message) => message.role === 'user');
        return { ...thread, messages: messages.slice(-MAX_MESSAGES),
            title: firstQuestion ? firstQuestion.text.slice(0, 55) : 'Cuộc trò chuyện mới' };
    })
});

export const deleteSupportThread = (store, threadId) => {
    const threads = store.threads.filter((thread) => thread.id !== threadId);
    if (!threads.length) return createSupportStore(store.ownerKey);
    return { ...store, threads, activeId: store.activeId === threadId ? threads[0].id : store.activeId };
};
