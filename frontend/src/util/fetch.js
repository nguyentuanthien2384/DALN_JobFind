import { useEffect, useRef, useState } from 'react';
import { getAllCodeService } from '../service/userService';
import createListCache from './listCache';

const retainedAllCode = createListCache({ ttl: 30 * 60 * 1000, limit: 64 });
const pendingRequests = new Map();

const sameRows = (left, right) =>
    Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && JSON.stringify(left) === JSON.stringify(right);

export const clearAllCodeCache = () => {
    retainedAllCode.clear();
    pendingRequests.clear();
};

export const getCachedAllCode = type => retainedAllCode.read(type)?.value || null;

export const fetchAllCode = (type, { retain = true } = {}) => {
    if (!type || typeof getAllCodeService !== 'function') return Promise.resolve(null);
    if (!pendingRequests.has(type)) {
        const request = new Promise(resolve => resolve(getAllCodeService(type)))
            .then(arrData => {
                if (arrData?.errCode === 0 && Array.isArray(arrData.data) && retain) {
                    retainedAllCode.save(type, arrData.data);
                }
                return arrData;
            })
            .finally(() => {
                if (pendingRequests.get(type) === request) pendingRequests.delete(type);
            });
        pendingRequests.set(type, request);
    } else if (retain) {
        pendingRequests.get(type).then(arrData => {
            if (arrData?.errCode === 0 && Array.isArray(arrData.data)) {
                retainedAllCode.save(type, arrData.data);
            }
        }).catch(() => {});
    }
    return pendingRequests.get(type);
};

export const preloadAllCode = (types = []) =>
    Promise.all(types.map(type => {
        const cached = getCachedAllCode(type);
        if (cached) return Promise.resolve({ errCode: 0, data: cached });
        return fetchAllCode(type, { retain: true }).catch(() => null);
    }));

const useFetchAllcode = (type, { retain = false } = {}) => {
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
