import React, { useEffect, useMemo, useState } from 'react';
import { Select, Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import ReactPaginate from 'react-paginate';
import { getFilterCv, getCandidateSearchJobs } from '../../../service/cvService';
import { getAllSkillByJobCode } from '../../../service/userService';
import { useFetchAllcode } from '../../../util/fetch';
import { PAGINATION } from '../../../util/constant';
import './FilterCv.css';
import useListQuery, { clampListPage } from '../../../util/useListQuery';
import StableList from '../../../components/common/StableList';

const emptyFilters = () => ({ keyword: '', categoryJobCode: '', experienceJobCode: '',
    provinceCode: '', salaryCode: '', listSkills: [], skillMode: 'any', minMatch: 0, sort: 'match' });
const hasCriteria = filters => Boolean(filters.categoryJobCode || filters.experienceJobCode ||
    filters.provinceCode || filters.salaryCode || filters.listSkills.length);
const criterionLabels = { categoryJobCode: 'Ngành nghề', experienceJobCode: 'Kinh nghiệm',
    provinceCode: 'Địa điểm', salaryCode: 'Mức lương' };
const filterOption = (input, option) => (option?.label || '').toLocaleLowerCase('vi').includes(input.toLocaleLowerCase('vi'));

const FilterCv = () => {
    const navigate = useNavigate();
    const [user] = useState(() => {
        try { return JSON.parse(localStorage.getItem('userData')) || {}; } catch { return {}; }
    });
    const [query, setQuery] = useListQuery({ ...emptyFilters(), page: 0 });
    const { page } = query;
    const filters = useMemo(() => {
        const { page: unusedPage, ...criteria } = query;
        return criteria;
    }, [query]);
    const [result, setResult] = useState({ data: [], count: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [settledRequest, setSettledRequest] = useState('');
    const filterKey = JSON.stringify(filters);
    const requestKey = JSON.stringify([filterKey, page, retry]);
    const busy = loading || settledRequest !== requestKey;
    const [skills, setSkills] = useState([]);
    const [skillError, setSkillError] = useState('');
    const [allowance, setAllowance] = useState(null);
    const [jobs, setJobs] = useState([]);
    const [jobSearch, setJobSearch] = useState('');
    const [jobLoading, setJobLoading] = useState(false);
    const [jobError, setJobError] = useState('');
    const [selectedJob, setSelectedJob] = useState(null);
    const [jobCount, setJobCount] = useState(0);
    const { data: provinces } = useFetchAllcode('PROVINCE');
    const { data: experiences } = useFetchAllcode('EXPTYPE');
    const { data: salaries } = useFetchAllcode('SALARYTYPE');
    const { data: categories } = useFetchAllcode('JOBTYPE');

    useEffect(() => {
        let active = true;
        setLoading(true); setError('');
        const timer = setTimeout(async () => {
            try {
                const response = await getFilterCv({ ...filters, limit: PAGINATION.pagerow,
                    offset: page * PAGINATION.pagerow,
                    listSkills: filters.listSkills.filter(value => typeof value === 'number'),
                    otherSkills: filters.listSkills.filter(value => typeof value === 'string'),
                });
                if (!active) return;
                if (!response || response.errCode !== 0 || !Array.isArray(response.data)) {
                    throw new Error(response?.errMessage || 'Không tải được ứng viên. Vui lòng thử lại.');
                }
                const validPage = clampListPage(page, response.count, PAGINATION.pagerow);
                if (validPage !== page) { setQuery({ page: validPage }, { replace: true }); return; }
                setResult(response);
                setAllowance(response.allowance || null);
            } catch (failure) {
                if (active) { setResult({ data: [], count: 0 }); setError(failure.message || 'Không tải được ứng viên. Vui lòng thử lại.'); }
            } finally { if (active) { setLoading(false); setSettledRequest(requestKey); } }
        }, 250);
        return () => { active = false; clearTimeout(timer); };
    }, [filters, page, retry, requestKey, setQuery]);

    useEffect(() => {
        let active = true;
        setSkills([]); setSkillError('');
        if (filters.categoryJobCode) {
            (async () => {
                try {
                    const response = await getAllSkillByJobCode(filters.categoryJobCode);
                    if (response?.errCode !== 0) throw new Error();
                    if (active) setSkills((response.data || []).map(skill => ({ value: Number(skill.id), label: skill.name })));
                } catch { if (active) setSkillError('Chưa tải được gợi ý kỹ năng. Bạn vẫn có thể nhập tên kỹ năng.'); }
            })();
        }
        return () => { active = false; };
    }, [filters.categoryJobCode, retry]);

    useEffect(() => {
        if (!user.companyId) return;
        let active = true;
        setJobLoading(true); setJobError('');
        const timer = setTimeout(async () => {
            try {
                const response = await getCandidateSearchJobs({ search: jobSearch });
                if (response?.errCode !== 0) throw new Error(response?.errMessage);
                if (active) { setJobs(response.data || []); setJobCount(response.count || 0); }
            } catch { if (active) { setJobs([]); setJobError('Chưa tải được tin tuyển dụng. Bạn có thể tự chọn tiêu chí bên dưới.'); } }
            finally { if (active) setJobLoading(false); }
        }, 250);
        return () => { active = false; clearTimeout(timer); };
    }, [jobSearch, user.companyId, retry]);

    const change = (key, value) => {
        setQuery(current => {
            const next = { ...current, page: 0, [key]: value ?? '', ...(key === 'categoryJobCode' ? { listSkills: [] } : {}) };
            if (!hasCriteria(next)) next.minMatch = 0;
            return next;
        }, { replace: key === 'keyword' });
    };
    const reset = () => { setQuery({ ...emptyFilters(), page: 0 }); setSelectedJob(null); setJobSearch(''); };
    const applyJob = id => {
        const job = jobs.find(item => item.id === id);
        if (!job) { setSelectedJob(null); return; }
        setSelectedJob(job);
        setQuery({ ...emptyFilters(), ...job.criteria, page: 0, listSkills: job.criteria.listSkills.map(skill => Number(skill.id)) });
    };
    const openCandidate = id => {
        const open = () => navigate(`/admin/candiate/${id}/`);
        if (user.roleCode === 'ADMIN') { open(); return; }
        Modal.confirm({ title: 'Xem CV và thông tin liên hệ', icon: <ExclamationCircleOutlined />,
            content: 'Công ty sẽ dùng 1 lượt xem nếu chưa mở quyền với ứng viên này. Xem lại hồ sơ đã mở không trừ thêm lượt.',
            okText: 'Xem hồ sơ', cancelText: 'Hủy', onOk: open });
    };
    const select = (key, label, values) => <div className="cv-search-field" key={key}>
        <label htmlFor={`cv-filter-${key}`}>{label}</label>
        <Select id={`cv-filter-${key}`} aria-label={label} placeholder={`Tất cả ${label.toLocaleLowerCase('vi')}`}
            allowClear showSearch filterOption={filterOption} value={filters[key] || undefined}
            onChange={value => change(key, value)} options={(values || []).map(item => ({ value: item.code, label: item.value }))} />
    </div>;
    const selectedSkillOptions = (selectedJob?.criteria.listSkills || []).map(skill => ({ value: Number(skill.id), label: skill.name }));
    const skillOptions = [...new Map([...selectedSkillOptions, ...skills].map(skill => [skill.value, skill])).values()];
    const activeCount = Object.keys(criterionLabels).filter(key => filters[key]).length + filters.listSkills.length + (filters.keyword ? 1 : 0);

    return <div className="cv-search">
        <header className="cv-search-header">
            <div><span className="cv-search-eyebrow">KHÔNG GIAN TUYỂN DỤNG</span><h1>Tìm ứng viên phù hợp</h1>
                <p>Khám phá hồ sơ đang tìm việc và đối chiếu với nhu cầu tuyển dụng của công ty.</p></div>
            {allowance && <div className="cv-search-allowance"><strong>Lượt xem CV</strong>
                <span>Số lượt xem miễn phí: {allowance.free}</span><span>Số lượt xem: {allowance.paid}</span></div>}
        </header>
        {user.companyId && <section className="cv-search-job" aria-label="Gợi ý từ tin tuyển dụng">
            <div><h2>Bắt đầu từ tin tuyển dụng</h2><p>Lấy ngành nghề, kinh nghiệm, lương, địa điểm và gợi ý kỹ năng từ tin của công ty.</p></div>
            <div><Select aria-label="Chọn tin tuyển dụng" placeholder="Tìm tên tin tuyển dụng của công ty"
                showSearch allowClear filterOption={false} loading={jobLoading} onSearch={setJobSearch}
                value={selectedJob?.id} onChange={applyJob}
                options={[...new Map([...(selectedJob ? [selectedJob] : []), ...jobs].map(job => [job.id, job])).values()]
                    .map(job => ({ value: job.id, label: `#${job.id} · ${job.name}` }))}
                notFoundContent={jobLoading ? 'Đang tải tin...' : 'Không có tin phù hợp'} />
                {jobCount > jobs.length && <small>Nhập tên để tìm trong {jobCount} tin tuyển dụng.</small>}
                {jobError && <small role="status">{jobError}</small>}
                {selectedJob && <small>Đã lấy gợi ý từ “{selectedJob.name}”. Bạn có thể điều chỉnh tiêu chí bên dưới.</small>}
            </div>
        </section>}
        <div className="cv-search-layout">
            <aside className="cv-search-filters" aria-label="Bộ lọc ứng viên">
                <div className="cv-search-filter-heading"><h2>Bộ lọc {activeCount > 0 && <span>{activeCount}</span>}</h2>
                    <button type="button" className="cv-search-text-button" onClick={reset}>Xóa bộ lọc</button></div>
                <div className="cv-search-field"><label htmlFor="cv-keyword">Từ khóa</label>
                    <input id="cv-keyword" type="search" placeholder="Tên ứng viên hoặc kỹ năng" maxLength={120}
                        value={filters.keyword} onChange={event => change('keyword', event.target.value)} /></div>
                {select('categoryJobCode', 'Ngành nghề', categories)}
                {select('provinceCode', 'Địa điểm', provinces)}
                {select('experienceJobCode', 'Kinh nghiệm', experiences)}
                {select('salaryCode', 'Mức lương', salaries)}
                <div className="cv-search-field"><label htmlFor="cv-skills">Kỹ năng cần có</label>
                    <Select id="cv-skills" aria-label="Kỹ năng cần có" mode="tags" allowClear showSearch
                        placeholder="Chọn hoặc nhập kỹ năng" filterOption={filterOption} value={filters.listSkills}
                        options={skillOptions} onChange={value => change('listSkills', value.slice(0, 30))} tokenSeparators={[',']} />
                    <small>Chọn ngành để xem gợi ý. Có thể nhập C++, C#, .NET hoặc kỹ năng khác rồi nhấn Enter.</small>
                    {skillError && <small role="status">{skillError}</small>}</div>
                <div className="cv-search-field"><label htmlFor="cv-skill-mode">Cách khớp kỹ năng</label>
                    <Select id="cv-skill-mode" aria-label="Cách khớp kỹ năng" value={filters.skillMode}
                        onChange={value => change('skillMode', value)} options={[
                            { value: 'any', label: 'Có ít nhất một kỹ năng' }, { value: 'all', label: 'Có tất cả kỹ năng' },
                            { value: 'rank', label: 'Chỉ xếp hạng, không loại hồ sơ' }]} /></div>
                <div className="cv-search-field"><label htmlFor="cv-min-match">Điểm phù hợp tối thiểu</label>
                    <Select id="cv-min-match" aria-label="Điểm phù hợp tối thiểu" disabled={!hasCriteria(filters)}
                        value={filters.minMatch} onChange={value => change('minMatch', value)}
                        options={[0, 50, 70, 90, 100].map(value => ({ value, label: value ? `Từ ${value}%` : 'Không giới hạn' }))} /></div>
                <p className="cv-search-help">Ngành, địa điểm, kinh nghiệm và mức lương được lọc theo đúng lựa chọn. Chỉ hiển thị ứng viên đang tìm việc và đã có CV.</p>
            </aside>
            <section className="cv-search-results" aria-label="Kết quả tìm ứng viên" aria-busy={busy}>
                <div className="cv-search-toolbar"><h2>{busy ? 'Đang tìm ứng viên…' : `${result.count} ứng viên`}</h2>
                    <div><label htmlFor="cv-sort">Sắp xếp</label><Select id="cv-sort" aria-label="Sắp xếp"
                        value={filters.sort} onChange={value => change('sort', value)} options={[
                            { value: 'match', label: 'Phù hợp nhất' }, { value: 'name', label: 'Tên A–Z' }]} /></div></div>
                <p className="cv-search-method">Điểm = số tiêu chí khớp / số tiêu chí đã chọn. Mỗi kỹ năng tính một lần, dựa trên hồ sơ khai báo; chưa phân tích nội dung tệp PDF. Điểm hỗ trợ sàng lọc, không tự quyết định tuyển dụng.</p>
                <StableList busy={busy} resetKey={filterKey} label="Đang đối chiếu hồ sơ với bộ lọc…">
                {!busy && error && <div className="cv-search-state" role="alert"><h3>Chưa tải được kết quả</h3><p>{error}</p>
                    <button type="button" className="cv-search-primary" onClick={() => setRetry(value => value + 1)}>Thử lại</button></div>}
                {!busy && !error && result.data.length === 0 && <div className="cv-search-state"><h3>Chưa có ứng viên phù hợp</h3>
                    <p>Thử bớt tiêu chí, giảm điểm tối thiểu hoặc đổi cách khớp kỹ năng.</p>
                    <button type="button" className="cv-search-primary" onClick={reset}>Xóa bộ lọc</button></div>}
                {!error && result.data.map(candidate => {
                    const name = [candidate.userSettingData?.firstName, candidate.userSettingData?.lastName].filter(Boolean).join(' ') || 'Ứng viên';
                    const scored = candidate.matchScore !== null && candidate.matchScore !== undefined;
                    return <article className="cv-search-candidate" key={candidate.userId}>
                        <div className="cv-search-candidate-top"><div className="cv-search-identity"><div className="cv-search-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>
                            <div><h3>{name}</h3><p>{candidate.jobTypeSettingData?.value || 'Chưa cập nhật ngành nghề'}</p></div></div>
                            {scored && <div className="cv-search-score"><strong>{candidate.matchScore}%</strong><span>khớp tiêu chí</span></div>}
                        </div>
                        <dl className="cv-search-facts"><div><dt>Địa điểm</dt><dd>{candidate.provinceSettingData?.value || 'Chưa cập nhật'}</dd></div>
                            <div><dt>Kinh nghiệm</dt><dd>{candidate.expTypeSettingData?.value || 'Chưa cập nhật'}</dd></div>
                            <div><dt>Lương mong muốn</dt><dd>{candidate.salaryTypeSettingData?.value || 'Chưa cập nhật'}</dd></div></dl>
                        <div className="cv-search-skills" aria-label={`Kỹ năng của ${name}`}>
                            {(candidate.skills || []).map(skill => <span key={skill.id}>{skill.name}</span>)}
                            {!candidate.skills?.length && <small>Chưa khai báo kỹ năng</small>}</div>
                        {scored && <details className="cv-search-explanation"><summary>Vì sao có điểm này?</summary>
                            <p>Tiêu chí khớp: {(candidate.matchedCriteria || []).map(key => criterionLabels[key]).join(', ') || 'Chưa chọn tiêu chí ngoài kỹ năng'}.</p>
                            {!!candidate.matchedSkills?.length && <p><strong>Kỹ năng khớp:</strong> {candidate.matchedSkills.join(', ')}</p>}
                            {!!candidate.missingSkills?.length && <p><strong>Chưa thấy khai báo:</strong> {candidate.missingSkills.join(', ')}</p>}
                        </details>}
                        <footer><span>Thông tin liên hệ hiển thị sau khi mở hồ sơ</span>
                            <button type="button" className="cv-search-primary" onClick={() => openCandidate(candidate.userId)}>Xem chi tiết ứng viên</button></footer>
                    </article>;
                })}
                </StableList>
                {!error && result.count > PAGINATION.pagerow && <nav aria-label="Phân trang ứng viên">
                    <ReactPaginate forcePage={page} previousLabel="Trước" nextLabel="Sau" breakLabel="…"
                        pageCount={Math.max(page + 1, Math.ceil(result.count / PAGINATION.pagerow))} pageRangeDisplayed={3} marginPagesDisplayed={1}
                        onPageChange={({ selected }) => setQuery({ page: selected })} containerClassName="cv-search-pagination" activeClassName="is-active" />
                </nav>}
            </section>
        </div>
    </div>;
};

export default FilterCv;
