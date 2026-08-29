import React from 'react'
import { Link } from 'react-router-dom'
import Job from '../../../components/Job/Job'
import {Input} from 'antd'
const RightContent = (props) => {
    return (
        <>
                {/* <!-- Featured_job_start --> */}
                <section className="featured-job-area">
                    <div className="container">
                        {/* <!-- Count of Job list Start --> */}
                        <div className="row">
                            <div className="col-lg-12">
                                <div className="count-job mb-35">
                                    <span>{props.count} công việc được tìm thấy</span>
                                    <Input.Search onSearch={props.handleSearch} className='mt-5' placeholder="Nhập tên bài đăng" allowClear enterButton="Tìm kiếm">
                                    
                                    </Input.Search>

                                    {/* <!-- Select job items start --> */}
                                    {/* <div class="select-job-items">
                                                <span>Sort by</span>
                                                <select name="select">
                                                    <option value="">None</option>
                                                    <option value="">job list</option>
                                                    <option value="">job list</option>
                                                    <option value="">job list</option>
                                                </select>
                                            </div> */}
                                    {/* <!--  Select job items End--> */}
                                </div>
                            </div>
                        </div>
                        {props.post.map((data) => {
                            return (
                                <Link key={data.id} to={`/detail-job/${data.id}`}>
                                    <div className="single-job-items mb-30">
                                        <Job data={data} />
                                    </div>
                                </Link>
                            )
                        })}


                        {/* <div class="single-job-items mb-30">
                                   <Job />
                                </div>
                               
                                <div class="single-job-items mb-30">

                                     <Job />
                                </div>
                              
                                <div class="single-job-items mb-30">
                                    <Job />

                                </div>
                               
                                
                                <div class="single-job-items mb-30"> 
                                      <Job />
                                </div>
                                
                                <div class="single-job-items mb-30">                                
                                     <Job /> 
                                </div>  */}
                    </div>
                </section>
                {/* <!-- Featured_job_end --> */}
        </>
    )
}

export default RightContent
