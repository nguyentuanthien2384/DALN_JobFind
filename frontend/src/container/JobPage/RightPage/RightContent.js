import React from 'react'
import { Link } from 'react-router-dom'
import Job from '../../../components/Job/Job'
import ExternalJobCard from '../../../components/Job/ExternalJobCard'
import JobSearchAutocomplete from './JobSearchAutocomplete'
import { prefetchJobDetail } from '../../JobDetail/jobDetailResource'
import { PAGINATION } from '../../../util/constant'
import './JobResults.css';
import StableList from '../../../components/common/StableList';

const JobPlaceholders = () => Array.from({ length: PAGINATION.pagerow }, (_, index) => (
    <div
        key={`job-placeholder-${index}`}
        className="single-job-items mb-30 is-placeholder stable-list__placeholder"
        aria-hidden="true"
    >
        <div className="job-items">
            <div className="company-img">
                <div className="job-placeholder__logo" />
            </div>
            <div className="job-tittle job-tittle2">
                <div className="job-placeholder__title" />
                <div className="job-placeholder__meta">
                    <span />
                    <span />
                    <span />
                </div>
            </div>
        </div>
        <div className="items-link items-link2 f-right job-placeholder__side">
            <span className="job-placeholder__badge" />
            <span className="job-placeholder__time" />
        </div>
    </div>
));

const RightContent = (props) => {
    const posts = props.post || [];
    const showPlaceholders = Boolean(props.loading && posts.length === 0 && !props.error);
    return (
        <>
                {/* <!-- Featured_job_start --> */}
                <section className="featured-job-area">
                    <div className="container">
                        {/* <!-- Count of Job list Start --> */}
                        <div className="row">
                            <div className="col-lg-12">
                                <div className="count-job mb-35">
                                    <span>{props.loading ? 'Đang tìm việc…' : props.error ? 'Chưa tải được kết quả' : `${props.count} công việc được tìm thấy`}</span>
                                    <JobSearchAutocomplete onSearch={props.handleSearch} value={props.searchDraft} onValueChange={props.onSearchDraftChange} />
                                </div>
                            </div>
                        </div>
                        <StableList busy={props.loading} resetKey={props.resetKey} label="Đang tìm việc…">
                        {showPlaceholders && <JobPlaceholders />}
                        {posts.map((data) => {
                            if (data.listingSource === 'external') return <Link key={data.id}
                                className="job-result-link" to={`/external-job/${encodeURIComponent(data.id)}`}
                                aria-label={`${data.title} — ${data.employer}`}>
                                <ExternalJobCard data={data} />
                            </Link>;
                            return (
                                <Link
                                    key={data.id}
                                    className="job-result-link"
                                    to={`/detail-job/${data.id}`}
                                    onMouseEnter={() => prefetchJobDetail(data.id)}
                                    onFocus={() => prefetchJobDetail(data.id)}
                                    onTouchStart={() => prefetchJobDetail(data.id)}
                                >
                                    <div className="single-job-items mb-30">
                                        <Job data={data} />
                                    </div>
                                </Link>
                            )
                        })}
                        </StableList>
                    </div>
                </section>
                {/* <!-- Featured_job_end --> */}
        </>
    )
}

export default RightContent
