import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getExternalJob, isExternalJobExpired } from '../../service/externalJobs';
import { externalJobDate } from '../../components/Job/ExternalJobCard';
import './ExternalJobDetail.css';

const sourceHref = value => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch { return null; }
};

const SourceLink = ({ href, children, className }) => <a href={href} className={className}
    target="_blank" rel="noopener noreferrer">{children}<span className="external-job-detail__new-tab"> (mở tab mới)</span></a>;

const Fact = ({ label, children }) => <div><dt>{label}</dt><dd>{children}</dd></div>;

export default function ExternalJobDetail() {
    const { id } = useParams();
    const job = getExternalJob(id);
    useEffect(() => { window.scrollTo(0, 0); }, [id]);
    if (!job) return <main className="external-job-detail"><div className="external-job-detail__shell external-job-detail__empty">
        <h1>Không tìm thấy tin tuyển dụng</h1>
        <p>Tin này không có trong danh sách nguồn đã kiểm tra.</p>
        <Link to="/job" className="external-job-detail__button">Quay lại tìm việc</Link>
    </div></main>;

    const expired = isExternalJobExpired(job);
    const href = sourceHref(job.sourceUrl);
    const provinces = Array.isArray(job.provinceCodes) ? job.provinceCodes : [];
    return <main className="external-job-detail">
        <div className="external-job-detail__shell">
            <Link className="external-job-detail__back" to="/job">← Tất cả việc làm</Link>
            <header className="external-job-detail__hero">
                <div>
                    <span className="external-job-detail__badge">Tin từ nguồn bên ngoài</span>
                    <h1>{job.title}</h1>
                    <p className="external-job-detail__employer">{job.employer}</p>
                    <p className="external-job-detail__location">{provinces.join(' · ') || job.sourceLocation}</p>
                </div>
                <div className="external-job-detail__hero-action">
                    {expired ? <button className="external-job-detail__button" disabled>Tin đã hết hạn</button>
                        : href ? <SourceLink href={href} className="external-job-detail__button">Xem tin và ứng tuyển tại nguồn</SourceLink>
                            : <p>Liên kết nguồn chưa khả dụng.</p>}
                    <span>Hồ sơ được gửi tại trang tuyển dụng gốc.</span>
                </div>
            </header>

            <p className="external-job-detail__notice">
                Job Finder tổng hợp thông tin từ {job.sourceName}, kiểm tra ngày {externalJobDate(job.checkedAt)}.
                {' '}Vui lòng xem tin gốc để xác nhận vị trí còn tuyển và cách nộp hồ sơ.
            </p>
            {expired && <p className="external-job-detail__expired" role="status">Tin đã qua hạn nộp hồ sơ công bố. Bạn vẫn có thể xem thông tin tại nguồn gốc.</p>}

            <div className="external-job-detail__layout">
                <article className="external-job-detail__content">
                    <section>
                        <h2>Thông tin tuyển dụng</h2>
                        <p>{job.summary || 'Xem nội dung chi tiết trên trang tuyển dụng gốc.'}</p>
                    </section>
                    {job.responsibilities?.length > 0 && <section>
                        <h2>Công việc chính</h2>
                        <ul>{job.responsibilities.map((text, index) => <li key={index}>{text}</li>)}</ul>
                    </section>}
                    {job.requirements?.length > 0 && <section>
                        <h2>Yêu cầu ứng viên</h2>
                        <ul>{job.requirements.map((text, index) => <li key={index}>{text}</li>)}</ul>
                    </section>}
                    <section>
                        <h2>Địa điểm làm việc</h2>
                        <p>{job.sourceLocation || provinces.join(', ')}</p>
                        {provinces.length > 0 && <p className="external-job-detail__muted">Tỉnh/thành phố theo danh mục hiện tại: {provinces.join(', ')}.</p>}
                    </section>
                </article>
                <aside className="external-job-detail__sidebar">
                    <section className="external-job-detail__panel" aria-labelledby="external-job-facts">
                        <h2 id="external-job-facts">Thông tin từ nguồn</h2>
                        <dl>
                            <Fact label="Đơn vị tuyển dụng">{job.employer}</Fact>
                            <Fact label="Mức lương">{job.salaryText || 'Nguồn chưa công bố'}</Fact>
                            <Fact label="Hạn nộp hồ sơ">{job.deadline ? externalJobDate(job.deadline) : 'Nguồn chưa công bố'}</Fact>
                            {job.postedAt && <Fact label="Ngày đăng tại nguồn">{externalJobDate(job.postedAt)}</Fact>}
                            <Fact label="Ngày kiểm tra nguồn">{externalJobDate(job.checkedAt)}</Fact>
                        </dl>
                    </section>
                    <section className="external-job-detail__panel external-job-detail__source" aria-labelledby="external-job-source">
                        <h2 id="external-job-source">Nguồn tuyển dụng</h2>
                        <p>{job.sourceName}</p>
                        {href && <SourceLink href={href} className="external-job-detail__source-link">Xem bài tuyển dụng gốc ↗</SourceLink>}
                        {!job.deadline && <p className="external-job-detail__muted">Nguồn chưa nêu hạn nộp. Hãy xác nhận trạng thái tuyển dụng trên trang gốc trước khi gửi hồ sơ.</p>}
                    </section>
                </aside>
            </div>
        </div>
    </main>;
}
