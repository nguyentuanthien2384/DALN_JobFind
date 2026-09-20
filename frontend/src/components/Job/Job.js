import React from 'react'
import { formatJobTime, jobLabel } from '../../util/jobLocale';
const Job = (props) => {
    return (
        <>
            <div className="job-items">
                <div className="company-img">
                    <img
                        src={props.data.userPostData.userCompanyData.thumbnail}
                        alt=""
                        width="85"
                        height="85"
                        loading="lazy"
                        decoding="async"
                        style={{ width: "85px", height: "85px", objectFit: "contain" }}
                    />
                </div>
                <div className="job-tittle job-tittle2">
                    <div>
                        <h5>{props.data.postDetailData.name}</h5>
                    </div>
                    <ul className='my-font'>
                        <li>{jobLabel(props.data.postDetailData.jobLevelPostData)}</li>
                        <li><i className="fas fa-map-marker-alt"></i>{props.data.postDetailData.provincePostData.value}</li>
                        <li>{jobLabel(props.data.postDetailData.salaryTypePostData)}</li>
                    </ul>
                </div>
            </div>
            <div className="items-link items-link2 f-right">
                <span className='my-font'>{jobLabel(props.data.postDetailData.workTypePostData)}</span>
                <span>{formatJobTime(props.data.timePost)}</span>
            </div>

        </>
    )
}

export default React.memo(Job)
