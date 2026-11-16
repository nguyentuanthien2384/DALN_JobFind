import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import SessionContext from '../../auth/SessionContext';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';
import { SESSION_USER_UPDATED_EVENT } from '../../auth/sessionUser';
import {
    CANDIDATE_PROFILE_UPDATED_EVENT,
    getJobCompetitionReportService,
    notifyRewardWalletUpdated,
    REWARD_WALLET_UPDATED_EVENT,
    unlockJobCompetitionReportService,
} from '../../service/rewardPaymentService';
import { readJsonStorage } from '../../util/storage';
import { COMPARISON_STATUS, getProfileComparison } from './competitionReport';
import './CandidateRewards.css';

const asNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};
const formatNumber = (value, maximumFractionDigits = 2) =>
    new Intl.NumberFormat('vi-VN', { maximumFractionDigits }).format(value);
const formatTime = (value) => new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
}).format(new Date(value));
const readToken = () => {
    try { return localStorage.getItem('token_user') || ''; } catch { return ''; }
};

// A job/session key also isolates pending requests when navigating cached pages.
const JobCompetitionSection = (props) => {
    const context = useContext(SessionContext);
    const [sessionOverride, setSessionOverride] = useState(null);
    const user = sessionOverride && sessionOverride.context === context
        ? sessionOverride.user
        : context === undefined ? readJsonStorage('userData') : context;
    const token = readToken();

    useEffect(() => {
        const ended = () => setSessionOverride({ context, user: null });
        const updated = () => setSessionOverride({ context, user: readJsonStorage('userData') });
        const stored = (event) => {
            if (event.key === null || ['userData', 'token_user'].includes(event.key)) updated();
        };
        window.addEventListener(SESSION_ENDED_EVENT, ended);
        window.addEventListener(SESSION_USER_UPDATED_EVENT, updated);
        window.addEventListener('storage', stored);
        return () => {
            window.removeEventListener(SESSION_ENDED_EVENT, ended);
            window.removeEventListener(SESSION_USER_UPDATED_EVENT, updated);
            window.removeEventListener('storage', stored);
        };
    }, [context]);

    if (user?.roleCode && user.roleCode !== 'CANDIDATE') return null;
    const identity = `${props.postId}:${user?.id ?? 'guest'}:${user?.roleCode ?? ''}:${token}`;
    return <CompetitionReport key={identity} {...props} user={user} />;
};

const CompetitionReport = ({ postId, applicationCount = null, hiringTarget = 1, onOpenTopup, user }) => {
    const [reportState, setReportState] = useState({ status: 'loading', data: null, loadedAt: null });
    const [unlocking, setUnlocking] = useState(false);
    const [now, setNow] = useState(Date.now);
    const mounted = useRef(false);
    const requestId = useRef(0);
    const unlockOperation = useRef(null);

    const loadCompetitionReport = useCallback(async () => {
        const request = ++requestId.current;
        setReportState({ status: 'loading', data: null, loadedAt: null });
        try {
            if (!postId) throw new Error('Missing job');
            const res = await getJobCompetitionReportService(postId);
            if (!mounted.current || request !== requestId.current) return;
            if (res?.errCode !== 0 || !res.data ||
                (res.data.postId != null && String(res.data.postId) !== String(postId))) {
                throw new Error('Report unavailable');
            }
            const loadedAt = Date.now();
            setNow(loadedAt);
            setReportState({ status: 'ready', data: res.data, loadedAt });
        } catch (_err) {
            if (mounted.current && request === requestId.current) {
                setReportState({ status: 'error', data: null, loadedAt: null });
            }
        }
    }, [postId]);

    useEffect(() => {
        mounted.current = true;
        loadCompetitionReport();
        return () => {
            mounted.current = false;
            requestId.current += 1;
            unlockOperation.current = null;
        };
    }, [loadCompetitionReport]);

    useEffect(() => {
        const updated = (event) => {
            if (event?.detail?.skipCompetitionReload) return;
            loadCompetitionReport();
        };
        const profileUpdated = (event) => {
            if (event?.detail?.userId != null && String(event.detail.userId) !== String(user?.id)) return;
            loadCompetitionReport();
        };
        const storedProfile = (event) => {
            if (event.key !== CANDIDATE_PROFILE_UPDATED_EVENT || !event.newValue) return;
            try { profileUpdated({ detail: JSON.parse(event.newValue) }); } catch { /* Ignore an invalid storage notification. */ }
        };
        window.addEventListener(REWARD_WALLET_UPDATED_EVENT, updated);
        window.addEventListener(CANDIDATE_PROFILE_UPDATED_EVENT, profileUpdated);
        window.addEventListener(SESSION_USER_UPDATED_EVENT, updated);
        window.addEventListener('storage', storedProfile);
        return () => {
            window.removeEventListener(REWARD_WALLET_UPDATED_EVENT, updated);
            window.removeEventListener(CANDIDATE_PROFILE_UPDATED_EVENT, profileUpdated);
            window.removeEventListener(SESSION_USER_UPDATED_EVENT, updated);
            window.removeEventListener('storage', storedProfile);
        };
    }, [loadCompetitionReport, user?.id]);

    const reportData = reportState.data;
    const expiryTime = reportData?.expiresAt ? new Date(reportData.expiresAt).getTime() : null;
    const hasExpiry = Number.isFinite(expiryTime);
    const invalidExpiry = Boolean(reportData?.expiresAt && !hasExpiry);
    const expired = Boolean(reportData?.unlocked && hasExpiry && expiryTime <= now);
    const isUnlocked = Boolean(reportData?.unlocked && !expired && !invalidExpiry);

    useEffect(() => {
        if (!reportData?.unlocked || !hasExpiry) return undefined;
        let timer;
        const tick = () => {
            const current = Date.now();
            setNow(current);
            if (expiryTime > current) timer = window.setTimeout(tick, Math.min(60000, expiryTime - current));
        };
        tick();
        return () => window.clearTimeout(timer);
    }, [reportData?.unlocked, expiryTime, hasExpiry]);

    const unlockCost = asNumber(reportData?.unlockCostPoints ?? reportData?.unlockCost) ?? 10;
    const validDays = asNumber(reportData?.validDays ?? reportData?.unlockTtlDays) ?? 30;
    const currentPoints = asNumber(reportData?.walletBalancePoints ?? reportData?.walletBalance);
    const totalApplicants = asNumber(reportData?.totalApplicants) ?? asNumber(applicationCount);
    const todayApplicants = asNumber(reportData?.todayApplicants);
    const targetPositions = asNumber(reportData?.hiringTarget ?? reportData?.targetAmount ?? hiringTarget);
    const applicantsPerPosition = asNumber(reportData?.applicantsPerPosition) ??
        (totalApplicants !== null && targetPositions > 0 ? totalApplicants / targetPositions : null);
    const salaryRange = reportData?.salaryRange || {};
    const salarySamples = asNumber(salaryRange.sampleCount);
    const salaryDistribution = Array.isArray(salaryRange.distribution) ? salaryRange.distribution : [];
    const experienceRows = Array.isArray(reportData?.experienceBreakdown) ? reportData.experienceBreakdown : [];
    const topSkills = Array.isArray(reportData?.applicantTopSkills) ? reportData.applicantTopSkills : [];
    const profile = reportData?.profileMatch || {};
    const comparison = getProfileComparison(reportData || {});
    const jobSalaryLabel = reportData?.jobOverview?.salaryLabel || (isUnlocked ? salaryRange.jobSalaryLabel : null) || 'Chưa công bố';
    const settingsLink = (section) => `/candidate/usersetting?${section ? `section=${encodeURIComponent(section)}&` : ''}returnTo=${encodeURIComponent(`/detail-job/${postId}`)}`;
    const updateOtherFields = comparison.criteria.find((row) => row.key !== 'skills' && row.requirementStatus === 'identified' && ['missing', 'unmatched', 'partial'].includes(row.status));
    const remainingDays = hasExpiry ? Math.max(0, Math.ceil((expiryTime - now) / 86400000)) : null;

    const handleUnlockReport = async () => {
        if (unlockOperation.current || reportState.status !== 'ready' || isUnlocked) return;
        if (!user) {
            toast.warning('Vui lòng đăng nhập tài khoản ứng viên để mở khóa phân tích.');
            try { localStorage.setItem('lastUrl', window.location.pathname + window.location.search); } catch { /* Login still works. */ }
            window.location.href = '/login';
            return;
        }
        const operation = {};
        unlockOperation.current = operation;
        const unlockRequestGeneration = ++requestId.current;
        setUnlocking(true);
        const current = () => mounted.current && unlockOperation.current === operation;
        try {
            const res = await unlockJobCompetitionReportService(postId);
            if (!current()) return;
            if (res?.errCode === 0) {
                toast.success(res.errMessage || 'Đã mở khóa thống kê chi tiết.');
                // A profile/application refresh started after this POST can be
                // newer than the report bundled in its response. Fetch again
                // rather than replacing those insights with the older snapshot.
                if (requestId.current === unlockRequestGeneration && res.data?.report &&
                    (res.data.report.postId == null || String(res.data.report.postId) === String(postId))) {
                    requestId.current += 1;
                    const loadedAt = Date.now();
                    setNow(loadedAt);
                    setReportState({ status: 'ready', data: res.data.report, loadedAt });
                } else {
                    await loadCompetitionReport();
                }
                if (current()) notifyRewardWalletUpdated({ unlockedPostId: postId, skipCompetitionReload: true });
            } else if (res?.errCode === 2) {
                toast.warning(res.errMessage || 'Số dư điểm không đủ. Vui lòng nạp thêm điểm.');
                if (onOpenTopup) onOpenTopup('topup');
            } else {
                toast.error(res?.errMessage || 'Không thể mở khóa báo cáo lúc này.');
            }
        } catch (_err) {
            if (current()) toast.error('Lỗi kết nối khi mở khóa báo cáo.');
        } finally {
            if (current()) {
                unlockOperation.current = null;
                setUnlocking(false);
            }
        }
    };

    return (
        <section className="jf-competition-card" aria-label="Báo cáo ứng tuyển" aria-busy={reportState.status === 'loading'}>
            <div className="jf-competition-header">
                <div>
                    <h2 className="jf-competition-header__title">Báo cáo ứng tuyển</h2>
                    <p className="jf-competition-header__subtitle">
                        Đối chiếu hồ sơ với công việc và xem thông tin ứng viên đã nộp.
                    </p>
                </div>
                {reportState.status === 'ready' && <div className="jf-comp-access">
                    <span className={`jf-competition-status-pill jf-competition-status-pill--${isUnlocked ? 'unlocked' : 'locked'}`}>
                        {isUnlocked ? hasExpiry ? `Còn ${remainingDays} ngày` : 'Đã mở khóa'
                            : invalidExpiry ? 'Chưa xác minh hạn xem'
                                : expired ? 'Quyền xem đã hết hạn' : `Phí mở khóa: ${formatNumber(unlockCost)} điểm`}
                    </span>
                    {isUnlocked && hasExpiry && <span className="jf-comp-access__expiry">
                        Đến <time dateTime={new Date(expiryTime).toISOString()}>{formatTime(expiryTime)}</time> (giờ Việt Nam)
                    </span>}
                    {isUnlocked && !hasExpiry && <span className="jf-comp-access__expiry">Chưa có thông tin ngày hết hạn.</span>}
                </div>}
            </div>

            {reportState.status === 'loading' && <p className="jf-comp-request-state" role="status">Đang tải báo cáo ứng tuyển…</p>}
            {reportState.status === 'error' && <div className="jf-comp-request-state">
                <p role="alert">Không thể tải báo cáo ứng tuyển. Vui lòng thử lại.</p>
                <button type="button" className="jf-comp-btn-outline" onClick={loadCompetitionReport}>Thử lại</button>
            </div>}

            {reportState.status === 'ready' && <>
                <div className="jf-competition-stats-grid">
                    <div className="jf-comp-stat-box">
                        <div className="jf-comp-stat-box__label">Đã ứng tuyển</div>
                        <div className="jf-comp-stat-box__value">
                            {totalApplicants === null ? 'Chưa có dữ liệu' : <>{formatNumber(totalApplicants)} <span>ứng viên</span></>}
                        </div>
                        <div className="jf-comp-stat-box__sub">
                            {todayApplicants > 0 ? `+${formatNumber(todayApplicants)} trong 24 giờ qua` : 'Mỗi ứng viên chỉ được tính một lần'}
                        </div>
                    </div>
                    <div className="jf-comp-stat-box">
                        <div className="jf-comp-stat-box__label">Số lượng tuyển</div>
                        <div className="jf-comp-stat-box__value">
                            {targetPositions > 0 ? <>{formatNumber(targetPositions)} <span>người</span></> : 'Chưa công bố'}
                        </div>
                        {applicantsPerPosition !== null && <div className="jf-comp-stat-box__sub">
                            {applicantsPerPosition > 0 && applicantsPerPosition < 0.01 ? 'Dưới 0,01' : formatNumber(applicantsPerPosition)} ứng viên cho mỗi vị trí
                        </div>}
                    </div>
                    <div className="jf-comp-stat-box">
                        <div className="jf-comp-stat-box__label">Lương tin đăng</div>
                        <div className="jf-comp-stat-box__value jf-comp-stat-box__value--salary">{jobSalaryLabel}</div>
                        <div className="jf-comp-stat-box__sub">Mức lương nhà tuyển dụng công bố</div>
                    </div>
                </div>

                {user && typeof reportData.hasApplied === 'boolean' && <p className={`jf-comp-application-state${reportData.hasApplied ? ' jf-comp-application-state--submitted' : ''}`}>
                    {reportData.hasApplied ? 'Bạn đã ứng tuyển công việc này.' : 'Bạn chưa ứng tuyển công việc này.'}
                </p>}

                {invalidExpiry ? <div className="jf-comp-request-state">
                    <p role="alert">Không xác định được hạn xem báo cáo. Vui lòng tải lại trước khi mở khóa.</p>
                    <button type="button" className="jf-comp-btn-outline" onClick={loadCompetitionReport}>Thử lại</button>
                </div> : !isUnlocked ? <div className="jf-comp-lock-box">
                    <div className="jf-comp-lock-box__info">
                        <h3 className="jf-comp-lock-box__title">Mở khóa báo cáo chi tiết: {formatNumber(unlockCost)} điểm / {formatNumber(validDays)} ngày</h3>
                        <p className="jf-comp-lock-box__desc">
                            Xem hồ sơ của bạn đáp ứng yêu cầu nào, thông tin cần bổ sung và thống kê ứng viên đã nộp.
                            Quyền xem có hiệu lực {formatNumber(validDays)} ngày kể từ khi mở khóa.
                            {user && currentPoints !== null ? ` Số dư hiện tại: ${formatNumber(currentPoints)} điểm.` : ''}
                            {totalApplicants === 0 ? ' Hiện chưa có dữ liệu ứng viên để thống kê kinh nghiệm và lương mong muốn.' : ''}
                        </p>
                    </div>
                    <div className="jf-comp-lock-box__actions">
                        <button type="button" className="jf-comp-btn-primary" disabled={unlocking} onClick={handleUnlockReport}>
                            {unlocking ? 'Đang xử lý...' : `Mở khóa ngay (-${formatNumber(unlockCost)} điểm)`}
                        </button>
                        <button type="button" className="jf-comp-btn-outline" onClick={() => onOpenTopup && onOpenTopup('topup')}>Nạp điểm</button>
                    </div>
                </div> : <>
                    <section className="jf-comp-profile" aria-label="Hồ sơ của bạn với công việc này">
                        <div className="jf-comp-profile__head">
                            <div>
                                <h3 className="jf-comp-profile__title">Hồ sơ của bạn với công việc này</h3>
                                <p className="jf-comp-profile__summary">
                                    {comparison.metCriteriaCount > 0
                                        ? `${formatNumber(comparison.metCriteriaCount)} tiêu chí đã phù hợp`
                                        : comparison.needsUpdateCount > 0 ? 'Cần cập nhật thông tin hồ sơ' : 'Kiểm tra từng yêu cầu dưới đây'}
                                    {comparison.metCriteriaCount > 0 && comparison.needsUpdateCount > 0 && <span> · {formatNumber(comparison.needsUpdateCount)} mục cần bổ sung</span>}
                                </p>
                            </div>
                        </div>
                        <div className="jf-comp-comparison-wrap">
                            <table className="jf-comp-comparison" aria-label="Đối chiếu hồ sơ với yêu cầu công việc">
                                <thead><tr><th scope="col">Tiêu chí</th><th scope="col">Yêu cầu công việc</th><th scope="col">Hồ sơ của bạn</th><th scope="col">Đối chiếu</th></tr></thead>
                                <tbody>{comparison.criteria.map((item) => {
                                    const status = COMPARISON_STATUS[item.status] || COMPARISON_STATUS.missing;
                                    return <tr key={item.key}>
                                        <th scope="row">{item.label}</th>
                                        <td data-label="Yêu cầu công việc">{item.requiredLabel}</td>
                                        <td data-label="Hồ sơ của bạn">{item.candidateLabel}</td>
                                        <td data-label="Đối chiếu"><span className={`jf-comp-match-status jf-comp-match-status--${status.tone}`}>{status.label}</span></td>
                                    </tr>;
                                })}</tbody>
                            </table>
                        </div>

                        <div className="jf-comp-profile-skills">
                            <div className="jf-comp-profile-skills__head">
                                <h4>Kỹ năng theo tin đăng</h4>
                                {comparison.requiredSkills.length > 0 && comparison.skillComparisonKnown && <span>{formatNumber(comparison.matchedSkills.length)}/{formatNumber(comparison.requiredSkills.length)} kỹ năng đã khớp</span>}
                            </div>
                            {comparison.requiredSkills.length > 0 ? <div className="jf-comp-skill-groups">
                                <SkillGroup label="Đã có trong hồ sơ" skills={comparison.matchedSkills} tone="matched" emptyLabel={comparison.skillComparisonKnown ? 'Chưa ghi nhận kỹ năng phù hợp trong hồ sơ.' : 'Chưa có dữ liệu đối chiếu kỹ năng.'} />
                                <SkillGroup label="Cần kiểm tra / bổ sung" skills={comparison.unrecordedSkills} tone="unrecorded" emptyLabel={comparison.skillComparisonKnown ? 'Không có kỹ năng cần bổ sung trong danh sách đối chiếu.' : 'Chưa có dữ liệu đối chiếu kỹ năng.'} />
                            </div> : <p className="jf-comp-empty">Tin đăng chưa nêu rõ kỹ năng để đối chiếu.</p>}
                            <p className="jf-comp-profile__note">Dựa trên thông tin bạn khai báo; hãy bổ sung kỹ năng bạn thực sự có.</p>
                            {user && <div className="jf-comp-profile-actions">
                                {comparison.unrecordedSkills.length > 0 ? <>
                                    <a className="jf-comp-btn-primary" href={settingsLink('skills')}>Cập nhật kỹ năng</a>
                                    {updateOtherFields && <a className="jf-comp-btn-outline" href={settingsLink(updateOtherFields.key)}>Cập nhật hồ sơ</a>}
                                </> : updateOtherFields
                                    ? <a className="jf-comp-btn-primary" href={settingsLink(updateOtherFields.key)}>Cập nhật hồ sơ</a>
                                    : <a className="jf-comp-link-btn" href={settingsLink()}>Xem hồ sơ</a>}
                            </div>}
                        </div>
                        <details className="jf-comp-method">
                            <summary>Thông tin đối chiếu</summary>
                            <div className="jf-comp-method__content">
                                <p>{profile.sourceLabel || 'Đối chiếu thông tin hiện tại trong tài khoản; chưa phân tích tệp CV đã nộp.'}</p>
                                <p>Kết quả tham khảo không thay thế đánh giá của nhà tuyển dụng.</p>
                            </div>
                        </details>
                    </section>

                    <div className="jf-competition-charts-grid">
                        <section className="jf-comp-panel" aria-label="Ứng viên đã nộp">
                            <div className="jf-comp-panel__head"><h3 className="jf-comp-panel__title">Ứng viên đã nộp</h3></div>
                            {totalApplicants !== null && totalApplicants > 0 && <p className="jf-comp-insight-caption">Số liệu từ {formatNumber(totalApplicants)} ứng viên, mang tính tham khảo.</p>}
                            <h4 className="jf-comp-section-label">Kinh nghiệm</h4>
                            {totalApplicants === 0 ? <p className="jf-comp-empty">Hiện chưa có ứng viên nào nộp hồ sơ vào vị trí này.</p>
                                : experienceRows.length === 0 ? <p className="jf-comp-empty">Chưa có dữ liệu kinh nghiệm để tổng hợp.</p>
                                    : <div className="jf-comp-bars">{experienceRows.map((row) => <div key={row.key || row.label}>
                                        <div className="jf-comp-bar-row__top">
                                            <span className={row.isUserGroup ? 'jf-comp-bar-label--active' : undefined}>{row.label}{row.isUserGroup ? ' (Nhóm của bạn)' : ''}</span>
                                            <strong>{formatNumber(asNumber(row.count) ?? 0)} ứng viên</strong>
                                        </div>
                                        <div className="jf-comp-bar-track"><div className={`jf-comp-bar-fill ${row.isUserGroup ? 'jf-comp-bar-fill--active' : ''}`} style={{ width: `${Math.min(100, Math.max(0, asNumber(row.percent) ?? 0))}%` }} /></div>
                                    </div>)}</div>}
                            {totalApplicants > 0 && <div className="jf-comp-skills-summary">
                                <h4 className="jf-comp-section-label">Kỹ năng đã khai báo</h4>
                                {topSkills.length > 0 ? <div className="jf-comp-skill-tags">{topSkills.map((skill) => <span key={skill.skillId || skill.name} className="jf-comp-skill-tag">{skill.name} · {formatNumber(asNumber(skill.count) ?? 0)} ứng viên</span>)}</div>
                                    : <span className="jf-comp-skills-summary__empty">Chưa ghi nhận kỹ năng chi tiết trong các hồ sơ đã nộp.</span>}
                            </div>}
                        </section>
                        <section className="jf-comp-panel jf-comp-salary-panel" aria-label="Lương mong muốn của ứng viên">
                            <div className="jf-comp-panel__head"><h3 className="jf-comp-panel__title">Lương mong muốn của ứng viên</h3></div>
                            {salarySamples !== null && salarySamples > 0 && <p className="jf-comp-insight-caption">{formatNumber(salarySamples)} ứng viên có thông tin lương.</p>}
                            {salaryDistribution.length > 0 ? <ul className="jf-comp-salary-distribution">{salaryDistribution.map((bucket) => <li key={bucket.label}><span>{bucket.label}</span><strong>{formatNumber(asNumber(bucket.count) ?? 0)} ứng viên</strong></li>)}</ul>
                                : <p className="jf-comp-empty">Chưa có dữ liệu lương mong muốn để hiển thị.</p>}
                            <p className="jf-comp-insight-caption">Mức lương do ứng viên khai báo, không phải đề nghị từ nhà tuyển dụng.</p>
                        </section>
                    </div>
                </>}
                <div className="jf-comp-footer-note">
                    <div>
                        <span>Cập nhật lúc {formatTime(reportState.loadedAt)} (giờ Việt Nam).</span>
                        <span className="jf-comp-footer-note__privacy">Thông tin cá nhân và tệp CV của ứng viên khác được bảo mật.</span>
                    </div>
                    {isUnlocked && <button type="button" className="jf-comp-link-btn" onClick={() => onOpenTopup && onOpenTopup('history')}>Xem lịch sử điểm</button>}
                </div>
            </>}
        </section>
    );
};

const SkillGroup = ({ label, skills, tone, emptyLabel }) => (
    <div className={`jf-comp-skill-group jf-comp-skill-group--${tone}`} role="group" aria-label={label}>
        <h5>{label} <span>({formatNumber(skills.length)})</span></h5>
        {skills.length > 0 ? <div className="jf-comp-skill-tags">{skills.map((skill) => <span key={skill.id ?? skill.skillId ?? skill.name} className="jf-comp-skill-tag">{skill.name}</span>)}</div>
            : <p>{emptyLabel}</p>}
    </div>
);

export default JobCompetitionSection;
