import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { externalAssetUrl, getExternalJob, isExternalJobExpired, loadExternalJobDetails } from '../../service/externalJobs';
import { externalJobDate } from '../../components/Job/ExternalJobCard';
import ExternalJobLogo from '../../components/Job/ExternalJobLogo';
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

// Images come from the source page; hide them quietly if a copy is missing.
const SourceImage = ({ src, alt, className }) => {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [src]);
    if (!src || failed) return null;
    return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
};

const SourceSection = ({ section, href }) => <section>
    <h2>{section.title}</h2>
    <ul>{section.items.map((item, index) => /:$/.test(item)
        ? <li key={index} className="external-job-detail__label">{item}</li>
        : <li key={index}>{item}</li>)}</ul>
    {section.truncated && href && <SourceLink href={href} className="external-job-detail__more">Xem đầy đủ mục này tại tin gốc</SourceLink>}
</section>;

export default function ExternalJobDetail() {
    const { id } = useParams();
    const listing = getExternalJob(id);
    // The index carries what cards need; the source excerpts arrive in a second, lazily loaded file.
    const needsDetails = Boolean(listing) && !Array.isArray(listing.sections);
    const [details, setDetails] = useState({ id: null, data: null, failed: false });
    useEffect(() => { window.scrollTo(0, 0); }, [id]);
    useEffect(() => {
        if (!needsDetails) return undefined;
        let active = true;
        loadExternalJobDetails(id)
            .then(data => { if (active) setDetails({ id, data, failed: false }); })
            .catch(() => { if (active) setDetails({ id, data: null, failed: true }); });
        return () => { active = false; };
    }, [id, needsDetails]);
    const detailsReady = !needsDetails || details.id === id;
    const job = listing && { ...listing, ...(details.id === id ? details.data : null) };
    if (!job) return <main className="external-job-detail"><div className="external-job-detail__shell external-job-detail__empty">
        <h1>Không tìm thấy tin tuyển dụng</h1>
        <p>Tin này không có trong danh sách nguồn đã kiểm tra.</p>
        <Link to="/job" className="external-job-detail__button">Quay lại tìm việc</Link>
    </div></main>;

    const removed = job.sourceStatus === 'removed';
    const expired = !removed && (job.sourceStatus === 'closed' || isExternalJobExpired(job));
    // A removed vacancy's source page returns "not found", so it gets no source links.
    const href = removed ? null : sourceHref(job.sourceUrl);
    const provinces = Array.isArray(job.provinceCodes) ? job.provinceCodes : [];
    const sections = Array.isArray(job.sections) ? job.sections.filter(section => section?.items?.length) : [];
    const facts = Array.isArray(job.facts) ? job.facts.filter(entry => entry?.value && entry.value !== job.employer) : [];
    const cover = externalAssetUrl(job.coverImage);
    const jobImage = job.jobImage && externalAssetUrl(job.jobImage.src);
    const hasImages = Boolean(cover || jobImage || externalAssetUrl(job.logo));
    return <main className="external-job-detail">
        <div className="external-job-detail__shell">
            <Link className="external-job-detail__back" to="/job">← Tất cả việc làm</Link>
            <header className={`external-job-detail__hero${cover ? ' has-cover' : ''}`}>
                {cover && <div className="external-job-detail__cover">
                    <SourceImage src={cover} alt={`Ảnh từ trang tuyển dụng ${job.sourceName}`} />
                </div>}
                <div className="external-job-detail__hero-body">
                    <ExternalJobLogo job={job} size="hero" />
                    <div className="external-job-detail__heading">
                        <span className="external-job-detail__badge">Tin từ nguồn bên ngoài</span>
                        <h1>{job.title}</h1>
                        <p className="external-job-detail__employer">{job.employer}</p>
                        <p className="external-job-detail__location">{provinces.join(' · ') || job.sourceLocation}</p>
                        <ul className="external-job-detail__chips" aria-label="Thông tin chính">
                            {job.salaryText && <li>{job.salaryText}</li>}
                            {job.workTypeText && <li>{job.workTypeText}</li>}
                            {job.quantity && <li>Số lượng: {job.quantity}</li>}
                            {job.deadline && <li>Hạn nộp: {externalJobDate(job.deadline)}</li>}
                        </ul>
                    </div>
                    <div className="external-job-detail__hero-action">
                        {removed ? <button className="external-job-detail__button" disabled>Tin đã bị gỡ khỏi nguồn</button>
                            : expired ? <button className="external-job-detail__button" disabled>Tin đã hết hạn</button>
                                : href ? <SourceLink href={href} className="external-job-detail__button">Xem tin và ứng tuyển tại nguồn</SourceLink>
                                    : <p>Liên kết nguồn chưa khả dụng.</p>}
                        {!removed && <span>Hồ sơ được gửi tại trang tuyển dụng gốc.</span>}
                    </div>
                </div>
            </header>

            <p className="external-job-detail__notice">
                {hasImages ? 'Nội dung và hình ảnh' : 'Nội dung'} được trích từ tin gốc trên {job.sourceName}, kiểm tra ngày {externalJobDate(job.checkedAt)}.
                {href && ' Bấm “Xem bài tuyển dụng gốc” để đọc toàn bộ tin, xác nhận vị trí còn tuyển và cách nộp hồ sơ.'}
            </p>
            {removed && <p className="external-job-detail__expired" role="status">Trang tuyển dụng gốc không còn hiển thị tin này khi kiểm tra. Job Finder đã ẩn tin khỏi kết quả tìm kiếm.</p>}
            {expired && <p className="external-job-detail__expired" role="status">Tin đã qua hạn nộp hồ sơ công bố. Bạn vẫn có thể xem thông tin tại nguồn gốc.</p>}

            <div className="external-job-detail__layout">
                <article className="external-job-detail__content">
                    {!detailsReady ? <section aria-busy="true">
                        <h2>Thông tin tuyển dụng</h2>
                        <p className="external-job-detail__muted" role="status">Đang tải nội dung tin gốc…</p>
                    </section>
                        : sections.length ? sections.map((section, index) => <SourceSection key={`${section.title}-${index}`} section={section} href={href} />)
                            : <section>
                                <h2>Thông tin tuyển dụng</h2>
                                <p>{job.summary || 'Xem nội dung chi tiết trên trang tuyển dụng gốc.'}</p>
                                {details.failed && <p className="external-job-detail__muted">Chưa tải được phần trích dẫn. Vui lòng xem tin gốc hoặc tải lại trang.</p>}
                            </section>}
                    {jobImage && <figure className="external-job-detail__figure">
                        <SourceImage src={jobImage} alt={job.jobImage.alt || `Ảnh tin tuyển dụng ${job.title}`} />
                        <figcaption>Ảnh đăng kèm tin gốc trên {job.sourceName}</figcaption>
                    </figure>}
                    <section>
                        <h2>Địa điểm làm việc</h2>
                        <p>{job.sourceLocation || provinces.join(', ')}</p>
                        {provinces.length > 0 && <p className="external-job-detail__muted">Tỉnh/thành phố theo danh mục hiện tại: {provinces.join(', ')}.</p>}
                    </section>
                    {job.companyIntro && <section>
                        <h2>Về {job.employer}</h2>
                        <p>{job.companyIntro}</p>
                    </section>}
                    {href && <div className="external-job-detail__read-more">
                        <p>Đây là phần trích ngắn. Mô tả đầy đủ, quyền lợi chi tiết và mẫu hồ sơ nằm trên trang tuyển dụng gốc.</p>
                        <SourceLink href={href} className="external-job-detail__source-button">Đọc tin tuyển dụng gốc</SourceLink>
                    </div>}
                </article>
                <aside className="external-job-detail__sidebar">
                    <section className="external-job-detail__panel" aria-labelledby="external-job-facts">
                        <h2 id="external-job-facts">Thông tin từ nguồn</h2>
                        <dl>
                            <Fact label="Đơn vị tuyển dụng">{job.employer}</Fact>
                            <Fact label="Mức lương">{job.salaryText || 'Nguồn chưa công bố'}</Fact>
                            {job.quantity && <Fact label="Số lượng tuyển">{job.quantity}</Fact>}
                            {job.workTypeText && <Fact label="Hình thức làm việc">{job.workTypeText}</Fact>}
                            {facts.map(entry => <Fact key={entry.label} label={entry.label}>{entry.value}</Fact>)}
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
