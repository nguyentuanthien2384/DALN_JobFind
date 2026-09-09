import React, { useState, useEffect } from 'react'
import LeftBar from './LeftPage/LeftBar'
import RightContent from './RightPage/RightContent'
import { PAGINATION } from '../../util/constant';
import ReactPaginate from 'react-paginate';
import { loadSearchPage, loadSearchLabels, searchMode } from '../../service/searchWorkspace';
import CommonUtils from '../../util/CommonUtils';
const JobPage = () => {

    const [countPage, setCountPage] = useState(1)
    const [post, setPost] = useState([])
    const [count, setCount] = useState(0)
    const [numberPage, setNumberPage] = useState(0)
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [labels, setLabels] = useState({});
    const mode = searchMode();
    const limit = PAGINATION.pagerow

    const [workType, setWorkType] = useState([])
    const [jobType, setJobType] = useState(() => (
        new URLSearchParams(window.location.search).get('categoryJobCode') || ''
    ))
    const [salary, setSalary] = useState([])
    const [exp, setExp] = useState([])
    const [jobLevel, setJobLevel] = useState([])
    const [jobLocation, setJobLocation] = useState('')
    const [search,setSearch] = useState('')
    const handleSearch = (value) => {
        setNumberPage(0);
        setSearch(value)
    }
    const recieveWorkType = (data) => {
        setNumberPage(0);
        setWorkType(prev => {
            let isCheck = prev.includes(data)
            if (isCheck)
                return prev.filter(item => item !== data)
            else
                return [...prev, data]
        })
    }
    const recieveSalary = (data) => {
        setNumberPage(0);
        setSalary(prev => {
            let isCheck = prev.includes(data)
            if (isCheck)
                return prev.filter(item => item !== data)
            else
                return [...prev, data]
        })
    }
    const recieveExp = (data) => {
        setNumberPage(0);
        setExp(prev => {
            let isCheck = prev.includes(data)
            if (isCheck)
                return prev.filter(item => item !== data)
            else
                return [...prev, data]
        })
    }
    const recieveJobType = (data) => {
        setNumberPage(0);
        jobType === data ? setJobType('') : setJobType(data)
    }
    const recieveJobLevel = (data) => {
        setNumberPage(0);
        setJobLevel(prev => {
            let isCheck = prev.includes(data)
            if (isCheck)
                return prev.filter(item => item !== data)
            else
                return [...prev, data]
        })
    }
    const recieveLocation = (data) => {
        setNumberPage(0);
        jobLocation === data ? setJobLocation('') : setJobLocation(data)
    }
    useEffect(() => {
        let active = true;
        if (mode === 'core') loadSearchLabels().then(data => { if (active) setLabels(data); });
        return () => { active = false; };
    }, [mode]);
    useEffect(() => {
        let active = true;
        setLoading(true); setError(''); setPost([]); setCount(0);
        const params = { limit, offset: numberPage * limit, categoryJobCode: jobType,
            addressCode: jobLocation, salaryJobCode: salary, categoryJoblevelCode: jobLevel,
            categoryWorktypeCode: workType, experienceJobCode: exp,
            search: CommonUtils.removeSpace(search), sortName: undefined };
        loadSearchPage(params, mode, labels).then(result => {
            if (!active) return;
            setPost(result.data); setCount(result.count);
            setCountPage(Math.ceil((mode === 'core' ? Math.min(result.count, 10000) : result.count) / limit));
        }).catch(failure => {
            if (active) { setError(failure.message); setCountPage(0); }
        }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [workType, jobLevel, exp, jobType, jobLocation, salary, search, limit, numberPage, retry, mode, labels]);
    const handleChangePage = (number) => { setNumberPage(number.selected); };
    return (
        <>

            <main>

                {/* <!-- Hero Area Start--> */}
                <div className="slider-area ">
                    <div className="single-slider section-overly slider-height2 d-flex align-items-center" style={{
                        backgroundImage: `url("assets/img/hero/about.jpg")`
                    }}>
                        <div className="container">
                            <div className="row">
                                <div className="col-xl-12">
                                    <div className="hero-cap text-center">
                                        <h2>Tìm việc</h2>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                {/* <!-- Hero Area End -->
        <!-- Job List Area Start --> */}
                <div className="job-listing-area pt-120 pb-120">
                    <div className="container">
                        <div className="row">
                            {/* <!-- Left content --> */}
                            <div className="col-xl-3 col-lg-3 col-md-4">
                                <div className="row">
                                    <div className="col-12">
                                        <div className="small-section-tittle2 mb-45">
                                            <div className="ion"> <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                xmlnsXlink="http://www.w3.org/1999/xlink"
                                                width="20px" height="12px">
                                                <path fillRule="evenodd" fill="rgb(27, 207, 107)"
                                                    d="M7.778,12.000 L12.222,12.000 L12.222,10.000 L7.778,10.000 L7.778,12.000 ZM-0.000,-0.000 L-0.000,2.000 L20.000,2.000 L20.000,-0.000 L-0.000,-0.000 ZM3.333,7.000 L16.667,7.000 L16.667,5.000 L3.333,5.000 L3.333,7.000 Z" />
                                            </svg>
                                            </div>
                                            <h4>Lọc công việc</h4>
                                        </div>
                                    </div>
                                </div>
                                {/* <!-- Job Category Listing start --> */}
                                <LeftBar worktype={recieveWorkType} recieveSalary={recieveSalary} recieveExp={recieveExp}
                                    recieveJobType={recieveJobType} recieveJobLevel={recieveJobLevel} recieveLocation={recieveLocation}
                                />
                                {/* <!-- Job Category Listing End --> */}
                            </div>
                            {/* <!-- Right content --> */}
                            <div className="col-xl-9 col-lg-9 col-md-8">
                            <RightContent handleSearch={handleSearch} count={count} post={post} loading={loading} error={error} />
                            {loading && <p role="status">Đang tìm việc…</p>}
                            {error && <div role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Thử lại</button></div>}
                            {!loading && !error && count === 0 && <p>Không tìm thấy công việc phù hợp. Hãy thử đổi từ khóa hoặc bộ lọc.</p>}
                            {mode === 'core' && count > 10000 && <p>Đang hiển thị tối đa 10.000 kết quả. Hãy thêm bộ lọc để thu hẹp tìm kiếm.</p>}
                            <ReactPaginate
                            forcePage={numberPage}
                            previousLabel={'Quay lại'}
                            nextLabel={'Tiếp'}
                            breakLabel={'...'}
                            pageCount={countPage}
                            marginPagesDisplayed={3}
                            containerClassName={"pagination justify-content-center pb-3"}
                            pageClassName={"page-item"}
                            pageLinkClassName={"page-link"}
                            previousLinkClassName={"page-link"}
                            previousClassName={"page-item"}
                            nextClassName={"page-item"}
                            nextLinkClassName={"page-link"}
                            breakLinkClassName={"page-link"}
                            breakClassName={"page-item"}
                            activeClassName={"active"}
                            onPageChange={handleChangePage}
                        />
                            </div>
                        </div>
                    </div>
                </div>

                {/* <!--Pagination End  --> */}

            </main>

        </>
    )
}

export default JobPage
