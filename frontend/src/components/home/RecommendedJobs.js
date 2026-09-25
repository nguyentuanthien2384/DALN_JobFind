import React from "react";
import { useEffect, useState } from "react";
import FeatureJobs from "./FeaturesJobs";
import { getRecommendedPostService } from "../../service/userService";
import useReferenceDataRevision from '../../util/useReferenceDataRevision';

const RecommendedJobs = () => {
    const [dataRecommend, setDataRecommend] = useState([]);
    const [userData] = useState(() => JSON.parse(localStorage.getItem("userData")));
    const referenceRevision = useReferenceDataRevision();

    useEffect(() => {
        let active = true;
        const fetchRecommend = async () => {
            try {
                const res = await getRecommendedPostService({
                    userId: userData.id,
                    limit: 5,
                });
                if (active) setDataRecommend(res?.errCode === 0 ? res.data : []);
            } catch {
                if (active) setDataRecommend([]);
            }
        };

        if (userData && userData.roleCode === "CANDIDATE") {
            fetchRecommend();
        }
        return () => { active = false; };
    }, [userData, referenceRevision]);

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
