import {
    createSupportStore, loadSupportStore, saveSupportStore,
    addSupportThread, updateSupportMessages, deleteSupportThread, normalizeSupportCards
} from './supportChatStorage';

describe('support chat per-tab history', () => {
    beforeEach(() => sessionStorage.clear());

    test('isolates sessions, drops in-flight text and keeps only six threads', () => {
        const guest = createSupportStore('guest-chat');
        const updated = updateSupportMessages(guest, guest.activeId, () => [
            { role: 'user', text: 'Tìm việc', status: 'complete' },
            { role: 'assistant', text: 'still streaming', status: 'pending' }
        ]);
        saveSupportStore(updated);
        expect(loadSupportStore('guest-chat').threads[0].messages).toEqual([
            { id: expect.any(String), role: 'user', text: 'Tìm việc', status: 'complete', cards: [] }
        ]);
        expect(loadSupportStore('user-22').threads[0].messages).toEqual([]);
        let many = guest;
        for (let index = 0; index < 12; index++) many = addSupportThread(many);
        expect(many.threads).toHaveLength(6);
    });

    test('keeps only numeric same-origin job cards and no arbitrary model links', () => {
        const cards = normalizeSupportCards({ jobs: [
            { id: 12, name: 'React', company: 'Test', url: 'https://evil.example/steal' },
            { id: '../admin', name: 'Bad' }, { id: 7, name: 'Valid' }
        ] });
        expect(cards.map(({ id }) => id)).toEqual([12, 7]);
        expect(cards[0].url).toBeUndefined();
        const store = createSupportStore('cards-tab');
        const updated = updateSupportMessages(store, store.activeId, () => [
            { role: 'user', text: 'Tìm việc', status: 'complete' },
            { role: 'assistant', text: 'Đây là các tin', status: 'complete', cards }
        ]);
        saveSupportStore(updated);
        expect(loadSupportStore('cards-tab').threads[0].messages[1].cards).toEqual(cards);
    });

    test('deleting the active thread always leaves a new active thread', () => {
        const store = createSupportStore('support-history');
        const deleted = deleteSupportThread(store, store.activeId);
        expect(deleted.threads).toHaveLength(1);
        expect(deleted.activeId).toBe(deleted.threads[0].id);
    });

    test('preserves long answers, stable IDs and cancelled status after reload', () => {
        const store = createSupportStore('long-history');
        const updated = updateSupportMessages(store, store.activeId, () => [
            { role: 'user', text: 'question', status: 'complete' },
            { role: 'assistant', text: 'answer'.repeat(1000), status: 'complete' },
            { role: 'assistant', text: 'partial', status: 'cancelled' },
            { role: 'assistant', text: 'network interrupted', status: 'failed' }
        ]);
        saveSupportStore(updated);
        expect(loadSupportStore('long-history').threads[0].messages).toEqual(updated.threads[0].messages.map((item) => ({ ...item, cards: [] })));
    });

    test('keeps the complete live transcript during streaming beyond the legacy 40-message limit', () => {
        const store = createSupportStore('server-history');
        const earlier = Array.from({ length: 100 }, (_, index) => ({
            id: `saved-${index}`, role: index % 2 ? 'assistant' : 'user',
            text: `Message ${index}`, status: 'complete'
        }));
        const loaded = updateSupportMessages(store, store.activeId, () => earlier);
        const updated = updateSupportMessages(loaded, store.activeId, messages => [
            ...messages, { role: 'user', text: 'New question', status: 'complete' },
            { role: 'assistant', text: 'New partial answer', status: 'pending' }
        ]);
        expect(updated.threads[0].messages).toHaveLength(102);
        expect(updated.threads[0].messages.slice(0, 100)).toEqual(earlier);
        expect(updated.threads[0].title).toBe('Message 0');

        const edited = updateSupportMessages(updated, store.activeId, messages => messages.slice(0, 10));
        expect(edited.threads[0].messages).toEqual(earlier.slice(0, 10));
    });

    test('keeps the legacy browser snapshot bounded without mutating the live transcript', () => {
        const store = createSupportStore('legacy-history');
        const updated = updateSupportMessages(store, store.activeId, () => Array.from({ length: 60 }, (_, index) => ({
            id: `message-${index}`, role: index % 2 ? 'assistant' : 'user', text: `Message ${index}`, status: 'complete'
        })));
        saveSupportStore(updated);
        expect(updated.threads[0].messages).toHaveLength(60);
        const legacy = loadSupportStore('legacy-history').threads[0].messages;
        expect(legacy).toHaveLength(40);
        expect(legacy[0].id).toBe('message-20');
    });
});
