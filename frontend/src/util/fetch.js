import { useEffect, useRef, useState } from 'react';
import { getAllCodeService } from '../service/userService';
import { sortJobLevels } from './jobLocale';
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
                    const rows = initialType.current === 'JOBLEVEL' ? sortJobLevels(arrData.data) : arrData.data;
                    if (retainData.current) allCodeCache.set(initialType.current, rows);
                    if (active) setdata(rows);
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
