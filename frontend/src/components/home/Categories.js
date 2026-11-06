import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { getListJobTypeAndCountPost } from "../../service/userService";
import Category from "./Category";

let cachedCategories = [];

const Categories = () => {
    const [allCategory, setAllCategory] = useState(() =>
        process.env.NODE_ENV !== "test" && cachedCategories.length > 0 ? cachedCategories : []
    );
    useEffect(() => {
        let active = true;
        const loadData = async () => {
            let res = await getListJobTypeAndCountPost({
                limit: 4,
                offset: 0,
            });
            if (!active || !res) return;
            if (res.errCode === 0) {
                const next = res.data || [];
                if (process.env.NODE_ENV !== "test") cachedCategories = next;
                setAllCategory(next);
            } else {
                toast.error(res.message);
            }
        };
        loadData();
        return () => {
            active = false;
        };
    }, []);
    return (
        <>
            <div className="row d-flex justify-contnet-center">
                {allCategory.map((data, index) => {
                    return <Category data={data} key={index} />;
                })}
            </div>
        </>
    );
};

export default Categories;
