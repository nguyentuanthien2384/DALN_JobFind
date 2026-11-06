import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
    claimCandidateDailyCheckinService,
    claimCandidateProfileCompletionService,
    getCandidateRewardOverviewService,
    notifyRewardWalletUpdated,
    REWARD_WALLET_UPDATED_EVENT,
} from '../../service/rewardPaymentService';
import './CandidateRewards.css';

const CandidateWalletCard = ({ onOpenTopup, onWalletLoaded }) => {
    const [overview, setOverview] = useState(null);
    const [claimingCheckin, setClaimingCheckin] = useState(false);
    const [claimingProfile, setClaimingProfile] = useState(false);

    const loadWallet = useCallback(async () => {
        const rawUser = localStorage.getItem('userData');
        if (!rawUser) return;
        try {
            const res = await getCandidateRewardOverviewService();
            if (res && res.errCode === 0 && res.data) {
                setOverview(res.data);
                if (onWalletLoaded) onWalletLoaded(res.data);
            }
        } catch (_err) {
            // Keep default display when guest or offline
        }
    }, [onWalletLoaded]);

    useEffect(() => {
        loadWallet();
    }, [loadWallet]);

    useEffect(() => {
        const handleUpdated = () => {
            loadWallet();
        };
        window.addEventListener(REWARD_WALLET_UPDATED_EVENT, handleUpdated);
        return () => {
            window.removeEventListener(REWARD_WALLET_UPDATED_EVENT, handleUpdated);
        };
    }, [loadWallet]);

    const handleDailyCheckin = async () => {
        const rawUser = localStorage.getItem('userData');
        if (!rawUser) {
            toast.warning('Vui lòng đăng nhập để điểm danh nhận +1 Điểm!');
            window.location.href = '/login';
            return;
        }
        setClaimingCheckin(true);
        try {
            const res = await claimCandidateDailyCheckinService();
            if (res && res.errCode === 0) {
                toast.success(res.errMessage || 'Điểm danh thành công (+1 Điểm)!');
                notifyRewardWalletUpdated();
            } else {
                toast.info(res?.errMessage || 'Bạn đã điểm danh hôm nay.');
            }
        } catch (_err) {
            toast.error('Không thể điểm danh lúc này.');
        } finally {
            setClaimingCheckin(false);
        }
    };

    const handleClaimProfileBonus = async () => {
        const rawUser = localStorage.getItem('userData');
        if (!rawUser) {
            toast.warning('Vui lòng đăng nhập để nhận thưởng hoàn thiện hồ sơ!');
            window.location.href = '/login';
            return;
        }
        setClaimingProfile(true);
        try {
            const res = await claimCandidateProfileCompletionService();
            if (res && res.errCode === 0) {
                toast.success(res.errMessage || 'Đã nhận +20 Điểm thưởng hoàn thiện CV!');
                notifyRewardWalletUpdated();
            } else {
                toast.info(res?.errMessage || 'Bạn đã nhận thưởng mục này trước đó.');
            }
        } catch (_err) {
            toast.error('Không thể nhận thưởng lúc này.');
        } finally {
            setClaimingProfile(false);
        }
    };

    const balancePoints = Number(overview?.wallet?.balancePoints ?? 45);
    const balanceXu = Number(overview?.wallet?.balanceXu ?? balancePoints * 1000);
    const tierShort = overview?.wallet?.tierShortLabel || 'Hạng Bạc';
    const checkedInToday = Boolean(overview?.missions?.checkedInToday);
    const profileClaimed = Boolean(overview?.missions?.profileCompletionClaimed);

    return (
        <div className="jf-wallet-sidebar-card" aria-label="Ví Điểm & Xu Ứng Viên">
            <div className="jf-wallet-sidebar-card__head">
                <div className="jf-wallet-sidebar-card__title-wrap">
                    <div className="jf-wallet-sidebar-card__icon">
                        <i className="fas fa-wallet" />
                    </div>
                    <h3 className="jf-wallet-sidebar-card__title">Ví Điểm &amp; Xu Ứng Viên</h3>
                </div>
                <span className="jf-wallet-sidebar-card__tier">{tierShort}</span>
            </div>

            <div className="jf-wallet-balance-box">
                <div className="jf-wallet-balance-box__top">
                    <span style={{ fontSize: '12px', color: '#434655' }}>Số dư khả dụng:</span>
                    <div>
                        <span className="jf-wallet-balance-box__pts">
                            {balancePoints.toLocaleString('vi-VN')}
                        </span>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#b45309' }}>
                            {' '}
                            Điểm thưởng
                        </span>
                    </div>
                </div>
                <div className="jf-wallet-balance-box__sub">
                    <span>Quy đổi tương đương:</span>
                    <strong style={{ color: '#334155' }}>
                        {balanceXu.toLocaleString('vi-VN')} Xu (VNĐ)
                    </strong>
                </div>
            </div>

            <div>
                <div
                    style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#191c1e',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                    }}
                >
                    <i className="fas fa-sparkles" style={{ color: '#f59e0b' }} />
                    <span>Cách nhận thêm điểm miễn phí:</span>
                </div>

                <ul className="jf-wallet-earn-list">
                    <li className="jf-wallet-earn-item">
                        <span>
                            • Nộp CV vào vị trí này:{' '}
                            <strong style={{ color: '#047857' }}>+5 Điểm</strong>
                        </span>
                        <span style={{ fontSize: '10.5px', color: '#059669', fontWeight: 700 }}>
                            Tự động
                        </span>
                    </li>
                    <li className="jf-wallet-earn-item">
                        <span>
                            • Hoàn thiện CV đạt 100%:{' '}
                            <strong style={{ color: '#004ac6' }}>+20 Điểm</strong>
                        </span>
                        <button
                            type="button"
                            className="jf-wallet-claim-btn"
                            disabled={claimingProfile || profileClaimed}
                            onClick={handleClaimProfileBonus}
                        >
                            {profileClaimed ? 'Đã nhận' : claimingProfile ? '...' : 'Nhận +20'}
                        </button>
                    </li>
                    <li className="jf-wallet-earn-item">
                        <span>
                            • Điểm danh hằng ngày:{' '}
                            <strong style={{ color: '#b45309' }}>+1 Điểm</strong>
                        </span>
                        <button
                            type="button"
                            className="jf-wallet-claim-btn"
                            disabled={claimingCheckin || checkedInToday}
                            onClick={handleDailyCheckin}
                        >
                            {checkedInToday ? 'Đã điểm danh' : claimingCheckin ? '...' : 'Điểm danh'}
                        </button>
                    </li>
                </ul>
            </div>

            <div className="jf-wallet-sidebar-actions">
                <button
                    type="button"
                    className="jf-comp-btn-primary"
                    onClick={() => onOpenTopup && onOpenTopup('topup')}
                >
                    + Nạp Thêm Xu
                </button>
                <button
                    type="button"
                    className="jf-comp-btn-outline"
                    style={{ borderColor: '#e0e3e5', color: '#191c1e' }}
                    onClick={() => onOpenTopup && onOpenTopup('history')}
                >
                    Lịch Sử Dùng Điểm
                </button>
            </div>
        </div>
    );
};

export default CandidateWalletCard;
