// Keep the account page and header in sync even when realtime is unavailable.
export const NOTIFICATIONS_UPDATED_EVENT = 'jobfind:notifications-updated';

export const notifyNotificationsUpdated = source =>
    window.dispatchEvent(new CustomEvent(NOTIFICATIONS_UPDATED_EVENT, { detail: { source } }));
