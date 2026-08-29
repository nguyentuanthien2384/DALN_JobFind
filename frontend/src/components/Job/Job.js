import React from 'react'
import moment from 'moment';
const Job = (props) => {
    const handleSplitTime = (time) => {
        return moment(new Date(+time)).fromNow();
    }
    return (
        <>
            <div className="job-items">
                <div className="company-img">
                    <img src={props.data.userPostData.userCompanyData.thumbnail} alt="" style={{ width: "85px", height: "85px" }} />
                </div>
                <div className="job-tittle job-tittle2">
                    <div>
                        <h5>{props.data.postDetailData.name}</h5>
                    </div>
                    <ul className='my-font'>
                        <li>{props.data.postDetailData.jobLevelPostData.value}</li>
                        <li><i className="fas fa-map-marker-alt"></i>{props.data.postDetailData.provincePostData.value}</li>
                        <li>{props.data.postDetailData.salaryTypePostData.value}</li>
                    </ul>
                </div>
            </div>
            <div className="items-link items-link2 f-right">
                <a className='my-font' href="job_details.html">{props.data.postDetailData.workTypePostData.value}</a>
                <span style={{ position: 'absolute', right: '70px' }}>{handleSplitTime(props.data.timePost)}</span>
            </div>

        </>
    )
}

export default Job
