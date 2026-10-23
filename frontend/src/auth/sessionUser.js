import { readJsonStorage } from '../util/storage';

export const SESSION_USER_UPDATED_EVENT = 'jobfind:session-user-updated';

// Fields a user edits on their own profile page. Role and company access stay as
// /api/auth/me last confirmed them.
const PROFILE_FIELDS = ['firstName', 'lastName', 'email', 'image', 'address', 'dob', 'genderCode'];

/** Show a saved profile (header name and avatar) at once, without reloading the app. */
export function updateSessionProfile(profile) {
    const stored = readJsonStorage('userData');
    if (!stored || !profile || Number(stored.id) !== Number(profile.id)) return null;
    const next = { ...stored };
    for (const field of PROFILE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(profile, field)) next[field] = profile[field];
    }
    localStorage.setItem('userData', JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(SESSION_USER_UPDATED_EVENT, { detail: next }));
    return next;
}
