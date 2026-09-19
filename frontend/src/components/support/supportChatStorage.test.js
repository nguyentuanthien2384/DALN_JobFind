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
            { role: 'user', text: 'Tìm việc', status: 'complete', cards: [] }
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
});
