import { useEffect, useRef, useState } from 'react';
import { getAllCodeService } from '../service/userService';
const useFetchAllcode = (type) => {
    const [data, setdata] = useState([])
    const initialType = useRef(type)
    useEffect(() => {
        try {
            let fetchData = async () => {
                let arrData = await getAllCodeService(initialType.current)
                if (arrData && arrData.errCode === 0) {
                    setdata(arrData.data)               
                }
            }
            fetchData();
        } catch (error) {
            console.log(error)
        }

    }, [])
    return { data }
}
export {
    useFetchAllcode
}
