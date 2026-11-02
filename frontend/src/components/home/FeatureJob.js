import React from 'react'
import { Link } from 'react-router-dom'
import { formatJobTime, jobLabel } from '../../util/jobLocale';
import { prefetchJobDetail } from '../../container/JobDetail/jobDetailResource';
import '../Job/JobCard.css';

const FeatureJob = (props) => {
    const warmJob = () => prefetchJobDetail(props.data.id)
    return (
        <>
            <div className="single-job-items mb-30">
                <div className="job-items">
                    <div className="company-img">
                        <Link to={`/detail-job/${props.data.id}`} onMouseEnter={warmJob} onTouchStart={warmJob}>
                            <img
                                src={props.data.userPostData.userCompanyData.thumbnail}
                                alt=""
                                width="85"
                                height="85"
                                loading="lazy"
                                decoding="async"
                                style={{ width: "85px", height: "85px", objectFit: "contain" }}
                            />
                        </Link>
                    </div>
                    <div className="job-tittle">
                        <Link to={`/detail-job/${props.data.id}`} onMouseEnter={warmJob} onTouchStart={warmJob}>
                            <h4>{props.data.postDetailData.name}</h4>
                        </Link>
                        <ul>
                            <li>{jobLabel(props.data.postDetailData.jobLevelPostData)}</li>
                            <li><i className="fas fa-map-marker-alt"></i>{props.data.postDetailData.provincePostData.value}</li>
                            <li>{jobLabel(props.data.postDetailData.salaryTypePostData)}</li>
                        </ul>
                    </div>
                </div>
                <div className="items-link items-link2 f-right">
                    <Link to={`/detail-job/${props.data.id}`} onMouseEnter={warmJob} onTouchStart={warmJob}>
                        {jobLabel(props.data.postDetailData.workTypePostData)}
                    </Link>
                    <span>{formatJobTime(props.data.timePost)}</span>
                </div>
            </div>
        </>
    )
}

export default FeatureJob
