import React from 'react'
import { Link } from 'react-router-dom'
import Job from '../Job/Job';
import { prefetchJobDetail } from '../../container/JobDetail/jobDetailResource';
import '../../container/JobPage/RightPage/JobResults.css';

// Dung chung bo cuc the voi trang Viec lam (RightContent): ca the la mot link,
// noi dung render qua <Job /> de tieu de, thong tin va cot "hinh thuc / thoi gian"
// thang hang giong het nhau giua trang chu va trang Viec lam.
const FeatureJob = (props) => {
    const warmJob = () => prefetchJobDetail(props.data.id)
    return (
        <Link
            className="job-result-link"
            to={`/detail-job/${props.data.id}`}
            onMouseEnter={warmJob}
            onFocus={warmJob}
            onTouchStart={warmJob}
        >
            <div className="single-job-items mb-30">
                <Job data={props.data} />
            </div>
        </Link>
    )
}

export default FeatureJob
