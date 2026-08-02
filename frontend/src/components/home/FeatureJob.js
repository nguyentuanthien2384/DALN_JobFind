import React from 'react'
import { Link } from 'react-router-dom'
import moment from 'moment';
const FeatureJob = (props) => {
    const handleSplitTime = (time) => {
        return moment(new Date(+time)).fromNow();
    }
    return (
        <>
            <div className="single-job-items mb-30">
                <div className="job-items">
                    <div className="company-img">
                        <Link to={`/detail-job/${props.data.id}`}><img src={props.data.userPostData.userCompanyData.thumbnail} alt="" style={{ width: "85px", height: "85px" }} /></Link>
                    </div>
                    <div className="job-tittle">
                        <Link to={`/detail-job/${props.data.id}`}><h4>{props.data.postDetailData.name}</h4></Link>
                        <ul>
                            <li>{props.data.postDetailData.jobLevelPostData.value}</li>
                            <li><i className="fas fa-map-marker-alt"></i>{props.data.postDetailData.provincePostData.value}</li>
                            <li>{props.data.postDetailData.salaryTypePostData.value}</li>
                        </ul>
                    </div>
                </div>
                <div className="items-link items-link2 f-right">
                    <Link to={`/detail-job/${props.data.id}`}>{props.data.postDetailData.workTypePostData.value}</Link>
                    <span style={{ position: 'absolute', right: '70px' }}>{handleSplitTime(props.data.timePost)}</span>
                </div>
            </div>
        </>
    )
}

export default FeatureJob
