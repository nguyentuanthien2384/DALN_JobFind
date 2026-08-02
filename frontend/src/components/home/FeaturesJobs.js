import React from 'react'
import FeatureJob from './FeatureJob'
const FeaturesJobs = (props) => {
    return (
        <>
             <div className="row justify-content-center">
                    <div className="col-xl-10">
                        {/* <!-- single-job-content --> */}
                        {props.dataFeature.map((data) => (
                            <FeatureJob key={data.id} data={data}/>
                        ))}
                        {/* <!-- single-job-content --> */}                
                    </div>
                </div>
        </>
    )
}
export default FeaturesJobs
