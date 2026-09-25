import { useEffect } from 'react';
import { getAllCodeService } from '../service/userService';

// Detect changes from another browser/session, including an open page without dropdowns.
export default function useReferenceDataRefresh() {
    useEffect(() => {
        let pending = false;
        const refresh = async () => {
            if (pending || document.visibilityState === 'hidden' || navigator.onLine === false) return;
            pending = true;
            try { await getAllCodeService('JOBLEVEL'); } catch { /* Preserve current content while offline. */ }
            finally { pending = false; }
        };
        refresh();
        const timer = window.setInterval(refresh, 30000);
        window.addEventListener('focus', refresh);
        window.addEventListener('online', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', refresh);
            window.removeEventListener('online', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, []);
}
