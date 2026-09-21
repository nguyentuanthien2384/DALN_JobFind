import React, { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom';
import LeftBar from './LeftPage/LeftBar'
import RightContent from './RightPage/RightContent'
import { PAGINATION } from '../../util/constant';
import ReactPaginate from 'react-paginate';
import { loadSearchPage, loadSearchLabels, searchMode } from '../../service/searchWorkspace';
import CommonUtils from '../../util/CommonUtils';
import { SEARCH_SNAPSHOT_TTL, useJobSearchHistory } from './jobSearchHistory';
import useListQuery, { clampListPage } from '../../util/useListQuery';
const JobSearchPage = ({ historyKey }) => {
    const [restored, remember] = useJobSearchHistory(historyKey);
    const saved = restored || {};
    const loadedQuery = useRef(saved.loadedQuery);

    const [countPage, setCountPage] = useState(saved.countPage ?? 0)
    const [post, setPost] = useState(saved.post || [])
    const [count, setCount] = useState(saved.count ?? 0)
    const [query, setQuery] = useListQuery({ page: 0, search: '', categoryJobCode: '', addressCode: '',
        categoryWorktypeCode: [], salaryJobCode: [], experienceJobCode: [], categoryJoblevelCode: [] });
    const { page: numberPage, search, categoryJobCode: jobType, addressCode: jobLocation,
        categoryWorktypeCode: workType, salaryJobCode: salary, experienceJobCode: exp, categoryJoblevelCode: jobLevel } = query;
    const [loading, setLoading] = useState(!saved.loadedQuery);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(saved.retry || 0);
    const [labels, setLabels] = useState(saved.labels || {});
    const mode = searchMode();
    const [labelsReady, setLabelsReady] = useState(mode === 'legacy' || Boolean(saved.labelsReady));
    const limit = PAGINATION.pagerow

    // Every history entry shows the keyword that produced its results.
    const [searchDraft, setSearchDraft] = useState(search);
    const [renderedEntry, setRenderedEntry] = useState(historyKey);
    if (renderedEntry !== historyKey) {
        setRenderedEntry(historyKey);
        setSearchDraft(search);
        setError('');
        setRetry(saved.retry || 0);
        if (restored) {
            loadedQuery.current = saved.loadedQuery;
            setPost(saved.post || []); setCount(saved.count || 0); setCountPage(saved.countPage || 0);
            setLabels(saved.labels || {}); setLabelsReady(mode === 'legacy' || Boolean(saved.labelsReady));
            setLoading(!saved.loadedQuery);
        } else { loadedQuery.current = null; setLoading(true); }
    }
    remember({ countPage, post, count, numberPage, labels, labelsReady, workType, jobType, salary, exp,
        jobLevel, jobLocation, search, searchDraft, retry, loadedQuery: loadedQuery.current });
    const handleSearch = value => setQuery({ page: 0, search: value });
    const toggleFilter = (key, value) => setQuery(current => ({ page: 0,
        [key]: Array.isArray(current[key]) ? (current[key].includes(value)
            ? current[key].filter(item => item !== value) : [...current[key], value])
            : (current[key] === value ? '' : value) }));
    const recieveWorkType = value => toggleFilter('categoryWorktypeCode', value);
    const recieveSalary = value => toggleFilter('salaryJobCode', value);
    const recieveExp = value => toggleFilter('experienceJobCode', value);
    const recieveJobType = value => toggleFilter('categoryJobCode', value);
    const recieveJobLevel = value => toggleFilter('categoryJoblevelCode', value);
    const recieveLocation = value => toggleFilter('addressCode', value);
    useEffect(() => {
        let active = true;
        if (mode === 'core') loadSearchLabels().then(data => {
            if (active) {
                setLabels(previous => JSON.stringify(previous) === JSON.stringify(data) ? previous : data);
                setLabelsReady(true);
            }
        });
        return () => { active = false; };
    }, [mode]);
    useEffect(() => {
        if (!labelsReady) return;
        let active = true;
        const params = { limit, offset: numberPage * limit, categoryJobCode: jobType,
            addressCode: jobLocation, salaryJobCode: salary, categoryJoblevelCode: jobLevel,
            categoryWorktypeCode: workType, experienceJobCode: exp,
            search: CommonUtils.removeSpace(search), sortName: undefined };
        const queryKey = JSON.stringify({ params, mode, labels, retry });
        const sameQuery = loadedQuery.current?.key === queryKey;
        if (sameQuery && loadedQuery.current.expiresAt > Date.now()) return;
        setError('');
        if (!sameQuery) {
            loadedQuery.current = null;
            setLoading(true);
        }
        loadSearchPage(params, mode, labels).then(result => {
            if (!active) return;
            const available = mode === 'core' ? Math.min(result.count, 10000) : result.count;
            const validPage = clampListPage(numberPage, available, limit);
            if (validPage !== numberPage) { setQuery({ page: validPage }, { replace: true }); return; }
            loadedQuery.current = { key: queryKey, expiresAt: Date.now() + SEARCH_SNAPSHOT_TTL };
            setPost(result.data); setCount(result.count);
            setCountPage(Math.ceil((mode === 'core' ? Math.min(result.count, 10000) : result.count) / limit));
        }).catch(failure => {
            if (active) {
                setError(failure.message);
                if (!sameQuery) { loadedQuery.current = null; setPost([]); setCount(0); setCountPage(0); }
            }
        }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [workType, jobLevel, exp, jobType, jobLocation, salary, search, limit, numberPage, retry, mode, labels, labelsReady, setQuery, historyKey]);
    const handleChangePage = (number) => { setQuery({ page: number.selected }); };
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
                                <LeftBar selected={{ workType, salary, exp, jobType, jobLevel, jobLocation }}
                                    worktype={recieveWorkType} recieveSalary={recieveSalary} recieveExp={recieveExp}
                                    recieveJobType={recieveJobType} recieveJobLevel={recieveJobLevel} recieveLocation={recieveLocation}
                                />
                                {/* <!-- Job Category Listing End --> */}
                            </div>
                            {/* <!-- Right content --> */}
                            <div className="col-xl-9 col-lg-9 col-md-8">
                            <RightContent handleSearch={handleSearch} searchDraft={searchDraft} onSearchDraftChange={setSearchDraft} count={count} post={post} loading={loading} error={error}
                                resetKey={JSON.stringify({ workType, jobLevel, exp, jobType, jobLocation, salary, search })} />
                            {error && <div role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Thử lại</button></div>}
                            {!loading && !error && count === 0 && <p>Không tìm thấy công việc phù hợp. Hãy thử đổi từ khóa hoặc bộ lọc.</p>}
                            {mode === 'core' && count > 10000 && <p>Đang hiển thị tối đa 10.000 kết quả. Hãy thêm bộ lọc để thu hẹp tìm kiếm.</p>}
                            {countPage > 0 && <ReactPaginate
                            forcePage={numberPage}
                            previousLabel={'Quay lại'}
                            nextLabel={'Tiếp'}
                            breakLabel={'...'}
                            pageCount={Math.max(numberPage + 1, countPage)}
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
                        />}
                            </div>
                        </div>
                    </div>
                </div>

                {/* <!--Pagination End  --> */}

            </main>

        </>
    )
}

const JobPage = () => {
    const location = useLocation();
    const historyKey = `${searchMode()}:${location.key}:${location.search}`;
    return <JobSearchPage key={`${searchMode()}:${localStorage.getItem('token_user') || ''}`} historyKey={historyKey} />;
};

export default JobPage
