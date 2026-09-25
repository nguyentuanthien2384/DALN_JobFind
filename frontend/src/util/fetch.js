import { useEffect, useRef, useState } from 'react';
import { getAllCodeService } from '../service/userService';
const allCodeCache = new Map();
export const clearAllCodeCache = () => allCodeCache.clear();
const useFetchAllcode = (type, { retain = false } = {}) => {
    const [data, setdata] = useState(() => retain ? allCodeCache.get(type) || [] : [])
    const initialType = useRef(type)
    const retainData = useRef(retain);
    useEffect(() => {
        let active = true;
        const fetchData = async () => {
            try {
                let arrData = await getAllCodeService(initialType.current)
                if (arrData?.errCode === 0 && Array.isArray(arrData.data)) {
                    if (retainData.current) allCodeCache.set(initialType.current, arrData.data);
                    if (active) setdata(arrData.data);
                }
            } catch { /* Preserve already loaded filter options during a network failure. */ }
        };
        fetchData();
        return () => { active = false; };
    }, [])
    return { data }
}
export {
    useFetchAllcode
}
