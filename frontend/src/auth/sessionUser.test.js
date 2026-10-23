import { SESSION_USER_UPDATED_EVENT, updateSessionProfile } from './sessionUser';

describe('updateSessionProfile', () => {
    let updates;
    const listener = event => updates.push(event.detail);
    beforeEach(() => {
        updates = [];
        localStorage.clear();
        window.addEventListener(SESSION_USER_UPDATED_EVENT, listener);
    });
    afterEach(() => window.removeEventListener(SESSION_USER_UPDATED_EVENT, listener));

    it('refreshes profile fields in place and keeps the confirmed role and company', () => {
        localStorage.setItem('userData', JSON.stringify({ id: 7, roleCode: 'COMPANY', companyId: 4, companyStatusCode: 'S1', image: 'old' }));
        const next = updateSessionProfile({ id: 7, firstName: 'An', image: 'new', roleCode: 'ADMIN', companyId: 99 });
        const expected = { id: 7, roleCode: 'COMPANY', companyId: 4, companyStatusCode: 'S1', firstName: 'An', image: 'new' };
        expect(next).toEqual(expected);
        expect(JSON.parse(localStorage.getItem('userData'))).toEqual(expected);
        expect(updates).toEqual([expected]);
    });

    it.each([
        ['another account', JSON.stringify({ id: 8 }), { id: 7, image: 'new' }],
        ['a signed-out browser', null, { id: 7, image: 'new' }],
        ['an empty response', JSON.stringify({ id: 7 }), undefined],
    ])('ignores a profile for %s', (_, stored, profile) => {
        if (stored) localStorage.setItem('userData', stored);
        expect(updateSessionProfile(profile)).toBeNull();
        expect(localStorage.getItem('userData')).toBe(stored);
        expect(updates).toEqual([]);
    });
});
