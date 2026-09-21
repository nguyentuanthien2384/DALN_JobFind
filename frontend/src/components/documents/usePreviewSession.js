import { useEffect, useState } from 'react';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';

export const getPreviewSessionKey = () => {
    try {
        const marker = localStorage.getItem('token_user');
        const user = JSON.parse(localStorage.getItem('userData') || 'null');
        return JSON.stringify([marker, Number(user?.id) || null, user?.roleCode || null, Number(user?.companyId) || null,
            user?.statusCode || null, user?.companyStatusCode || null, user?.companyCensorCode || null]);
    } catch { return null; }
};
export default function usePreviewSession() {
    const [owner] = useState(getPreviewSessionKey);
    const [ended, setEnded] = useState(false);
    useEffect(() => {
        const end = () => setEnded(true);
        const changed = event => {
            if ((event.key === null || ['token_user', 'userData'].includes(event.key)) && getPreviewSessionKey() !== owner) end();
        };
        window.addEventListener(SESSION_ENDED_EVENT, end);
        window.addEventListener('storage', changed);
        return () => { window.removeEventListener(SESSION_ENDED_EVENT, end); window.removeEventListener('storage', changed); };
    }, [owner]);
    return !ended && owner !== null && owner === getPreviewSessionKey();
}
