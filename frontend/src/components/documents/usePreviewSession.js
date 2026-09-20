import { useEffect, useState } from 'react';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';

const sessionKey = () => JSON.stringify([localStorage.getItem('token_user'), localStorage.getItem('userData')]);
export default function usePreviewSession() {
    const [owner] = useState(sessionKey);
    const [ended, setEnded] = useState(false);
    useEffect(() => {
        const end = () => setEnded(true);
        const changed = event => { if (event.key === null || ['token_user', 'userData'].includes(event.key)) end(); };
        window.addEventListener(SESSION_ENDED_EVENT, end);
        window.addEventListener('storage', changed);
        return () => { window.removeEventListener(SESSION_ENDED_EVENT, end); window.removeEventListener('storage', changed); };
    }, []);
    return !ended && owner === sessionKey();
}
