import React from 'react'

const Category = (props) => {
    return (
        <>
            <div className="col-xl-3 col-lg-3 col-md-4 col-sm-6">
                        <div className="single-services text-center mb-30">
                            <div className="services-ion">
                                <img
                                    style={{width: '70%' , height: '70%'}}
                                    src={props.data.postDetailData.jobTypePostData.image}
                                    alt={props.data.postDetailData.jobTypePostData.value}
                                />
                            </div>
                            <div className="services-cap">
                               <h5><a href="job_listing.html">{props.data.postDetailData.jobTypePostData.value}</a></h5>
                                <span>{props.data.amount}</span>
                            </div>
                        </div>
                    </div>
        </>
    )
}

export default Category
