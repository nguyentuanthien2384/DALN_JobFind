import React from 'react'
import { Link } from 'react-router-dom'

const Category = (props) => {
    const jobType = props.data.postDetailData.jobTypePostData
    const categoryUrl = jobType.code
        ? `/job?categoryJobCode=${encodeURIComponent(jobType.code)}`
        : '/job'

    return (
        <>
            <div className="col-xl-3 col-lg-3 col-md-4 col-sm-6">
                        <div className="single-services text-center mb-30">
                            <div className="services-ion">
                                <img
                                    style={{width: '70%' , height: '70%'}}
                                    src={jobType.image}
                                    alt={jobType.value}
                                />
                            </div>
                            <div className="services-cap">
                               <h5><Link to={categoryUrl}>{jobType.value}</Link></h5>
                                <span>{props.data.amount}</span>
                            </div>
                        </div>
                    </div>
        </>
    )
}

export default Category
