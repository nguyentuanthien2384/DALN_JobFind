import { useEffect, useRef, useState } from 'react';
import { getAllCodeService } from '../service/userService';
import { sortJobLevels } from './jobLocale';
import { getReferenceDataRevision, subscribeReferenceDataChanges } from '../service/referenceDataEvents';
import useReferenceDataRevision from './useReferenceDataRevision';
const allCodeCache = new Map();
export const clearAllCodeCache = () => allCodeCache.clear();
subscribeReferenceDataChanges(clearAllCodeCache);
const useFetchAllcode = (type, { retain = false } = {}) => {
    const revision = useReferenceDataRevision();
    const [state, setState] = useState(() => ({ type, data: retain ? allCodeCache.get(type) || [] : [] }));
    const retainData = useRef(retain);
    useEffect(() => {
        let active = true;
        let request = 0;
        const fetchData = async () => {
            const version = ++request;
            const requestRevision = getReferenceDataRevision();
            try {
                const arrData = await getAllCodeService(type);
                if (!active || version !== request || requestRevision !== getReferenceDataRevision() || arrData?.stale) return;
                if (arrData?.errCode === 0 && Array.isArray(arrData.data)) {
                    const rows = type === 'JOBLEVEL' ? sortJobLevels(arrData.data) : arrData.data;
                    if (retainData.current) allCodeCache.set(type, rows);
                    setState({ type, data: rows });
                }
            } catch { /* Preserve already loaded filter options during a network failure. */ }
        };
        const refreshVisible = () => { if (document.visibilityState !== 'hidden') fetchData(); };
        fetchData();
        window.addEventListener('focus', refreshVisible);
        window.addEventListener('online', refreshVisible);
        document.addEventListener('visibilitychange', refreshVisible);
        return () => {
            active = false;
            window.removeEventListener('focus', refreshVisible);
            window.removeEventListener('online', refreshVisible);
            document.removeEventListener('visibilitychange', refreshVisible);
        };
    }, [type, revision]);
    return { data: state.type === type ? state.data : [] };
}
export {
    useFetchAllcode
}
