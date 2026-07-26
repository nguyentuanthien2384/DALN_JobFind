import React from "react";
import { useEffect, useState } from "react";
import FeatureJobs from "./FeaturesJobs";
import { getRecommendedPostService } from "../../service/userService";

const RecommendedJobs = () => {
    const [dataRecommend, setDataRecommend] = useState([]);
    const userData = JSON.parse(localStorage.getItem("userData"));

    useEffect(() => {
        if (userData && userData.roleCode === "CANDIDATE") {
            fetchRecommend();
        }
    }, []);

    const fetchRecommend = async () => {
        let res = await getRecommendedPostService({
            userId: userData.id,
            limit: 5,
        });
        if (res && res.errCode === 0) {
            setDataRecommend(res.data);
        }
    };

    if (!userData || userData.roleCode !== "CANDIDATE") return <></>;
    if (!dataRecommend || dataRecommend.length === 0) return <></>;

    return (
        <section className="featured-job-area feature-padding">
            <div className="container">
                <div className="row justify-content-center">
                    <div className="col-xl-6">
                        <div className="section-tittle text-center">
                            <span>Dựa trên kỹ năng và cài đặt tìm việc của bạn</span>
                            <h2>Việc làm phù hợp với bạn</h2>
                        </div>
                    </div>
                </div>
                <FeatureJobs dataFeature={dataRecommend} />
            </div>
        </section>
    );
};

export default RecommendedJobs;
