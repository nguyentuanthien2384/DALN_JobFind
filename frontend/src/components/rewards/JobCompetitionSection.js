import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
    getJobCompetitionReportService,
    notifyRewardWalletUpdated,
    REWARD_WALLET_UPDATED_EVENT,
    unlockJobCompetitionReportService,
} from '../../service/rewardPaymentService';
import { readJsonStorage } from '../../util/storage';
import './CandidateRewards.css';

const JobCompetitionSection = ({
    postId,
    applicationCount = 0,
    hiringTarget = 1,
    onOpenTopup,
}) => {
    const activeUser = readJsonStorage('userData');
    const isForbiddenRole = Boolean(activeUser?.roleCode && activeUser.roleCode !== 'CANDIDATE');
    const [reportData, setReportData] = useState(null);
    const [unlocking, setUnlocking] = useState(false);

    const loadCompetitionReport = useCallback(async () => {
        if (!postId) return;
        const user = readJsonStorage('userData');
        if (user?.roleCode && user.roleCode !== 'CANDIDATE') return;
        try {
            const res = await getJobCompetitionReportService(postId);
            if (res && res.errCode === 0 && res.data) {
                setReportData(res.data);
            }
        } catch (_err) {
            // Keep prop-derived basic counts if request fails
        }
    }, [postId]);

    useEffect(() => {
        loadCompetitionReport();
    }, [loadCompetitionReport]);

    useEffect(() => {
        const onWalletUpdated = (event) => {
            if (event?.detail?.skipCompetitionReload) return;
            loadCompetitionReport();
        };
        window.addEventListener(REWARD_WALLET_UPDATED_EVENT, onWalletUpdated);
        return () => {
            window.removeEventListener(REWARD_WALLET_UPDATED_EVENT, onWalletUpdated);
        };
    }, [loadCompetitionReport]);

    const hasUser = Boolean(localStorage.getItem('userData'));
    const isUnlocked = Boolean(reportData?.unlocked);
    const unlockCost = Number(reportData?.unlockCostPoints || 10);
    const currentPoints =
        reportData?.walletBalancePoints != null ? Number(reportData.walletBalancePoints) : null;
    const totalApplicants = Number(reportData?.totalApplicants ?? applicationCount ?? 0);
    const todayApplicants = Number(reportData?.todayApplicants ?? 0);
    const targetPositions = Math.max(1, Number(reportData?.hiringTarget ?? hiringTarget ?? 1));
    const defaultRatioRight =
        totalApplicants === 0 ? 0 : Math.max(1, Math.round(totalApplicants / targetPositions));
    const competitionRatio = reportData?.competitionRatio || `1 : ${defaultRatioRight}`;
    const experienceRows = Array.isArray(reportData?.experienceBreakdown)
        ? reportData.experienceBreakdown
        : [];
    const topSkills = Array.isArray(reportData?.applicantTopSkills)
        ? reportData.applicantTopSkills
        : [];
    const aiRows = Array.isArray(reportData?.aiCorrelation) ? reportData.aiCorrelation : [];

    const handleUnlockReport = async () => {
        const user = readJsonStorage('userData');
        if (!user) {
            toast.warning('Vui lòng đăng nhập tài khoản ứng viên để mở khóa phân tích.');
            window.location.href = '/login';
            return;
        }
        if (user.roleCode && user.roleCode !== 'CANDIDATE') {
            toast.error('Tính năng mở khóa báo cáo cạnh tranh chỉ dành cho tài khoản Ứng viên.');
            return;
        }
        setUnlocking(true);
        try {
            const res = await unlockJobCompetitionReportService(postId);
            if (res && res.errCode === 0) {
                toast.success(res.errMessage || 'Đã mở khóa thống kê chi tiết.');
                if (res.data?.report) {
                    setReportData(res.data.report);
                    notifyRewardWalletUpdated({ unlockedPostId: postId, skipCompetitionReload: true });
                } else {
                    await loadCompetitionReport();
                    notifyRewardWalletUpdated({ unlockedPostId: postId, skipCompetitionReload: true });
                }
                return;
            }
            if (res && res.errCode === 3) {
                toast.error(res.errMessage || 'Tài khoản này không có quyền mở khóa báo cáo ứng viên.');
                return;
            }
            if (res && res.errCode === 2) {
                toast.warning(res.errMessage || 'Số dư điểm không đủ. Vui lòng nạp thêm điểm.');
                if (onOpenTopup) onOpenTopup('topup');
                return;
            }
            toast.error(res?.errMessage || 'Không thể mở khóa báo cáo lúc này.');
        } catch (_err) {
            toast.error('Lỗi kết nối khi mở khóa báo cáo.');
        } finally {
            setUnlocking(false);
        }
    };

    if (isForbiddenRole) return null;

    return (
        <section
            className="jf-competition-card"
            aria-label="Báo cáo ứng tuyển và tỉ lệ cạnh tranh"
        >
            <div className="jf-competition-header">
                <div>
                    <h2 className="jf-competition-header__title">
                        Báo cáo ứng tuyển &amp; tỉ lệ cạnh tranh
                    </h2>
                    <p className="jf-competition-header__subtitle">
                        Số liệu tổng hợp trực tiếp từ hồ sơ đã nộp và yêu cầu của tin tuyển dụng
                    </p>
                </div>

                <span
                    className={`jf-competition-status-pill ${
                        isUnlocked
                            ? 'jf-competition-status-pill--unlocked'
                            : 'jf-competition-status-pill--locked'
                    }`}
                >
                    {isUnlocked
                        ? `Đã mở khóa (${reportData?.unlockTtlDays || 30} ngày)`
                        : `Phí mở khóa: ${unlockCost} điểm`}
                </span>
            </div>

            <div className="jf-competition-stats-grid">
                <div className="jf-comp-stat-box">
                    <div className="jf-comp-stat-box__label">Hồ sơ đã nộp</div>
                    <div className="jf-comp-stat-box__value">{totalApplicants}</div>
                    <div className="jf-comp-stat-box__sub">
                        {todayApplicants > 0 ? `+${todayApplicants} trong 24 giờ qua` : 'Tổng lượt nộp CV'}
                    </div>
                </div>

                <div className="jf-comp-stat-box">
                    <div className="jf-comp-stat-box__label">Tỉ lệ cạnh tranh</div>
                    <div className="jf-comp-stat-box__value">{competitionRatio}</div>
                    <div className="jf-comp-stat-box__sub">Chỉ tiêu: {targetPositions} vị trí</div>
                </div>

                <div className="jf-comp-stat-box">
                    <div className="jf-comp-stat-box__label">Mức lương kỳ vọng</div>
                    <div className="jf-comp-stat-box__value">
                        {isUnlocked
                            ? reportData?.expectedSalaryAvgMillion != null
                                ? `${reportData.expectedSalaryAvgMillion} triệu`
                                : 'Thỏa thuận'
                            : 'Đang khóa'}
                    </div>
                    <div className="jf-comp-stat-box__sub">
                        {isUnlocked
                            ? reportData?.expectedSalaryRangeLabel || 'Theo tin đăng'
                            : 'Mở khóa để xem chi tiết'}
                    </div>
                </div>

                <div className="jf-comp-stat-box">
                    <div className="jf-comp-stat-box__label">Độ phù hợp hồ sơ</div>
                    <div className="jf-comp-stat-box__value">
                        {isUnlocked
                            ? reportData?.profileMatchPercent != null
                                ? `${reportData.profileMatchPercent}%`
                                : '--'
                            : 'Đang khóa'}
                    </div>
                    <div className="jf-comp-stat-box__sub">
                        {isUnlocked
                            ? reportData?.profileRankLabel || 'Đối chiếu với yêu cầu công việc'
                            : 'Đối chiếu với tin đăng'}
                    </div>
                </div>
            </div>

            {!isUnlocked ? (
                <div className="jf-comp-lock-box">
                    <div className="jf-comp-lock-box__info">
                        <h3 className="jf-comp-lock-box__title">
                            Mở khóa phân tích chi tiết đối thủ ({unlockCost} điểm)
                        </h3>
                        <p className="jf-comp-lock-box__desc">
                            Xem thống kê thực tế từ hệ thống: cơ cấu năm kinh nghiệm, kỹ năng của{' '}
                            {totalApplicants} hồ sơ đã nộp, mức lương kỳ vọng và đối chiếu hồ sơ của bạn với
                            tin tuyển dụng này.
                            {hasUser && currentPoints !== null
                                ? ` Số dư hiện tại: ${currentPoints} điểm.`
                                : ''}
                        </p>
                    </div>
                    <div className="jf-comp-lock-box__actions">
                        <button
                            type="button"
                            className="jf-comp-btn-primary"
                            disabled={unlocking}
                            onClick={handleUnlockReport}
                        >
                            {unlocking ? 'Đang xử lý...' : `Mở khóa ngay (-${unlockCost} điểm)`}
                        </button>
                        <button
                            type="button"
                            className="jf-comp-btn-outline"
                            onClick={() => onOpenTopup && onOpenTopup('topup')}
                        >
                            Nạp điểm
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="jf-competition-charts-grid">
                        <div className="jf-comp-panel">
                            <div>
                                <div className="jf-comp-panel__head">
                                    <h3 className="jf-comp-panel__title">
                                        Phân bổ kinh nghiệm ứng viên
                                    </h3>
                                    <span className="jf-comp-panel__meta">
                                        {totalApplicants} hồ sơ
                                    </span>
                                </div>

                                {totalApplicants === 0 ? (
                                    <p className="jf-comp-empty">
                                        Hiện chưa có ứng viên nào nộp hồ sơ vào vị trí này.
                                    </p>
                                ) : (
                                    <div className="jf-comp-bars">
                                        {experienceRows.map((row) => (
                                            <div key={row.key || row.label}>
                                                <div className="jf-comp-bar-row__top">
                                                    <span
                                                        className={
                                                            row.isUserGroup || row.highlight
                                                                ? 'jf-comp-bar-label--active'
                                                                : undefined
                                                        }
                                                    >
                                                        {row.label}
                                                        {row.isUserGroup ? ' (Nhóm của bạn)' : ''}
                                                    </span>
                                                    <strong>
                                                        {row.count} hồ sơ ({row.percent}%)
                                                    </strong>
                                                </div>
                                                <div className="jf-comp-bar-track">
                                                    <div
                                                        className={`jf-comp-bar-fill ${
                                                            row.isUserGroup || row.highlight
                                                                ? 'jf-comp-bar-fill--active'
                                                                : ''
                                                        }`}
                                                        style={{
                                                            width: `${Math.min(
                                                                100,
                                                                Math.max(0, Number(row.percent || 0))
                                                            )}%`,
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {totalApplicants > 0 && (
                                <div className="jf-comp-skills-summary">
                                    <span className="jf-comp-skills-summary__label">
                                        Kỹ năng ứng viên đã nộp:
                                    </span>
                                    {topSkills.length > 0 ? (
                                        <div className="jf-comp-skill-tags">
                                            {topSkills.map((skill) => (
                                                <span
                                                    key={skill.skillId || skill.name}
                                                    className="jf-comp-skill-tag"
                                                >
                                                    {skill.name} ({skill.count})
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="jf-comp-skills-summary__empty">
                                            Các ứng viên đã nộp chưa cập nhật kỹ năng chi tiết.
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="jf-comp-panel">
                            <div>
                                <div className="jf-comp-panel__head">
                                    <h3 className="jf-comp-panel__title">
                                        Đối chiếu hồ sơ của bạn
                                    </h3>
                                </div>

                                <div className="jf-comp-ai-list">
                                    {aiRows.map((item, idx) => (
                                        <div key={idx} className="jf-comp-ai-item">
                                            <span>{item.label}</span>
                                            <strong
                                                className={`jf-comp-tone jf-comp-tone--${
                                                    item.tone || 'neutral'
                                                }`}
                                            >
                                                {item.status}
                                            </strong>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {reportData?.tacticalTip && (
                                <p className="jf-comp-note">{reportData.tacticalTip}</p>
                            )}
                        </div>
                    </div>

                    <div className="jf-comp-footer-note">
                        <span>
                            Thông tin cá nhân và tệp CV của các ứng viên khác được bảo mật ẩn danh.
                        </span>
                        <button
                            type="button"
                            className="jf-comp-link-btn"
                            onClick={() => onOpenTopup && onOpenTopup('history')}
                        >
                            Xem lịch sử điểm
                        </button>
                    </div>
                </>
            )}
        </section>
    );
};

export default JobCompetitionSection;
