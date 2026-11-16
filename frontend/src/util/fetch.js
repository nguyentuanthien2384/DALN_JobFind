import { useEffect, useRef, useState } from 'react';
import { getAllCodeService } from '../service/userService';
import { retainedAllCode, pendingAllCodeRequests as pendingRequests } from './allCodeCache';

export { clearAllCodeCache } from './allCodeCache';

const ALL_CODE_REUSE_MS = 60 * 1000;

const sameRows = (left, right) =>
    Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && JSON.stringify(left) === JSON.stringify(right);

export const getCachedAllCode = type => retainedAllCode.read(type)?.value || null;

export const fetchAllCode = (type, { retain = true } = {}) => {
    if (!type || typeof getAllCodeService !== 'function') return Promise.resolve(null);
    const token = localStorage.getItem('token_user');
    const cached = retain ? retainedAllCode.read(type) : null;
    if (cached && Date.now() - cached.savedAt < ALL_CODE_REUSE_MS) {
        return Promise.resolve({ errCode: 0, data: cached.value });
    }
    let entry = pendingRequests.get(type);
    if (!entry || entry.token !== token) {
        entry = { token, retain };
        entry.request = new Promise(resolve => resolve(getAllCodeService(type)))
            .then(arrData => {
                if (arrData?.errCode === 0 && Array.isArray(arrData.data) && entry.retain
                    && pendingRequests.get(type) === entry && localStorage.getItem('token_user') === token) {
                    retainedAllCode.save(type, arrData.data);
                }
                return arrData;
            })
            .finally(() => {
                if (pendingRequests.get(type) === entry) pendingRequests.delete(type);
            });
        pendingRequests.set(type, entry);
    } else if (retain) {
        entry.retain = true;
    }
    return entry.request;
};

export const preloadAllCode = (types = []) =>
    Promise.all(types.map(type => {
        const cached = getCachedAllCode(type);
        if (cached) return Promise.resolve({ errCode: 0, data: cached });
        return fetchAllCode(type, { retain: true }).catch(() => null);
    }));

const useFetchAllcode = (type, { retain = true } = {}) => {
    const [data, setdata] = useState(() => (retain ? getCachedAllCode(type) || [] : []));
    const initialType = useRef(type);
    const retainData = useRef(retain);
    useEffect(() => {
        let active = true;
        const fetchData = async () => {
            try {
                const arrData = await fetchAllCode(initialType.current, { retain: retainData.current });
                if (arrData?.errCode === 0 && Array.isArray(arrData.data) && active) {
                    setdata(previous => (sameRows(previous, arrData.data) ? previous : arrData.data));
                }
            } catch { /* Preserve already loaded filter options during a network failure. */ }
        };
        fetchData();
        return () => { active = false; };
    }, []);
    return { data };
};

export {
    useFetchAllcode
};
