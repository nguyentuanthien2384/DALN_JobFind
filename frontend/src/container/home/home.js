import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Categories from '../../components/home/Categories'
import FeatureJobs from '../../components/home/FeaturesJobs'
import RecommendedJobs from '../../components/home/RecommendedJobs'
import { getListPostService } from '../../service/userService'
const Home = () => {
    const [dataFeature, setDataFeature] = useState([])
    const [dataHot,setDateHot] = useState([])
    let loadPost = async (limit, offset) => {
        let arrData = await getListPostService({
            limit: limit,
            offset: offset,
            categoryJobCode: '',
            addressCode: '',
            salaryJobCode: '',
            categoryJoblevelCode: '',
            categoryWorktypeCode: '',
            experienceJobCode: '',
            sortName: false
        })
        let arrData2 = await getListPostService({
            limit: limit,
            offset: offset,
            categoryJobCode: '',
            addressCode: '',
            salaryJobCode: '',
            categoryJoblevelCode: '',
            categoryWorktypeCode: '',
            experienceJobCode: '',
            sortName: false,
            isHot: 1
        })
        if (arrData && arrData.errCode === 0) {
            setDataFeature(arrData.data)
        }
        if (arrData2 && arrData2.errCode === 0) {
            setDateHot(arrData2.data)
        }
    }
    useEffect(() => {
        let fetchPost = async () => {
            await loadPost(5, 0)
        }
        fetchPost()
    }, [])
    return (
        <>
            {/* <div id="preloader-active">
        <div class="preloader d-flex align-items-center justify-content-center">
            <div class="preloader-inner position-relative">
                <div class="preloader-circle"></div>
                <div class="preloader-img pere-text">
                    <img src="assets/img/logo/logo.png" alt="" />
                </div>
            </div>
        </div>
    </div> */}
            {/* <!-- Preloader Start --> */}

            <main>
                {/* <!-- slider Area Start--> */}
                <div className="slider-area ">
                    {/* <!-- Mobile Menu --> */}
                    <div className="slider-active">
                        <div className="single-slider slider-height d-flex align-items-center"
                            style={{
                                backgroundImage: `url("./assets/img/hero/h1_hero.jpg")`
                            }}>
                            <div className="container">
                                <div className="row">
                                    <div className="col-xl-6 col-lg-9 col-md-10">
                                        <div className="hero__caption">
                                            <h1>Hãy tìm công việc phù hợp với bạn nào</h1>
                                        </div>
                                    </div>
                                </div>
                                {/* <!-- Search Box --> */}

                            </div>
                        </div>
                    </div>
                </div>
                {/* <!-- slider Area End-->
        <!-- Our Services Start --> */}
                <div className="our-services section-pad-t30">
                    <div className="container">
                        {/* <!-- Section Tittle --> */}
                        <div className="row">
                            <div className="col-lg-12">
                                <div className="section-tittle text-center">
                                    <span>Lĩnh vực công việc nổi bật</span>
                                    <h2>Danh mục nghề nghiệp </h2>
                                </div>
                            </div>
                        </div>
                        <Categories />
                        {/* <!-- More Btn -->
                <!-- Section Button --> */}

                    </div>
                </div>
                {/* <!-- Our Services End -->
        <!-- Online CV Area Start --> */}
                <div className="online-cv cv-bg section-overly pt-90 pb-120" style={{
                    backgroundImage: `url("assets/img/gallery/cv_bg.jpg")`
                }}>
                    <div className="container">
                        <div className="row justify-content-center">
                            <div className="col-xl-10">
                                <div className="cv-caption text-center">
                                    <p className="pera1">Nhiều công việc đang chờ bạn</p>
                                    <p className="pera2"> Bạn đã hứng thú đã tìm việc chưa ?</p>
                                    <Link to='/job' className="border-btn2 border-btn4">Tìm việc ngay</Link>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                {/* <!-- Online CV Area End-->
        <!-- Featured_job_start --> */}
                <RecommendedJobs />
                <section className="featured-job-area feature-padding">
                    <div className="container">
                        {/* <!-- Section Tittle --> */}
                        <div className="row">
                            <div className="col-lg-12">
                                <div className="section-tittle text-center">

                                    <h2>Công việc nổi bật</h2>
                                </div>
                            </div>
                        </div>
                        <FeatureJobs dataFeature={dataHot} />
                    </div>
                </section>
                <section className="featured-job-area feature-padding">
                    <div className="container">
                        {/* <!-- Section Tittle --> */}
                        <div className="row">
                            <div className="col-lg-12">
                                <div className="section-tittle text-center">

                                    <h2>Công việc mới đăng</h2>
                                </div>
                            </div>
                        </div>
                        <FeatureJobs dataFeature={dataFeature} />
                    </div>
                </section>

                {/* <!-- Featured_job_end -->
        <!-- How  Apply Process Start--> */}
                <div className="apply-process-area apply-bg pt-150 pb-150" style={{
                    backgroundImage: `url("assets/img/gallery/how-applybg.png")`
                }}>
                    <div className="container">
                        {/* <!-- Section Tittle --> */}
                        <div className="row">
                            <div className="col-lg-12">
                                <div className="section-tittle white-text text-center">
                                    <span>Quy trình tìm việc</span>
                                    <h2> Thực hiện như thế nào ?</h2>
                                </div>
                            </div>
                        </div>
                        {/* <!-- Apply Process Caption --> */}
                        <div className="row">
                            <div className="col-lg-4 col-md-6">
                                <div className="single-process text-center mb-30">
                                    <div className="process-ion">
                                        <span className="flaticon-search"></span>
                                    </div>
                                    <div className="process-cap">
                                        <h5>1. Tìm kiếm công việc</h5>

                                    </div>
                                </div>
                            </div>
                            <div className="col-lg-4 col-md-6">
                                <div className="single-process text-center mb-30">
                                    <div className="process-ion">
                                        <span className="flaticon-curriculum-vitae"></span>
                                    </div>
                                    <div className="process-cap">
                                        <h5>2. Ứng tuyển công việc</h5>

                                    </div>
                                </div>
                            </div>
                            <div className="col-lg-4 col-md-6">
                                <div className="single-process text-center mb-30">
                                    <div className="process-ion">
                                        <span className="flaticon-tour"></span>
                                    </div>
                                    <div className="process-cap">
                                        <h5>3. Nhận công việc</h5>

                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>


            </main>
        </>
    )
}

export default Home
