import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
    claimCandidateDailyCheckinService,
    claimCandidateProfileCompletionService,
    getCachedCandidateRewardOverview,
    getCandidateRewardOverviewService,
    notifyRewardWalletUpdated,
    REWARD_WALLET_UPDATED_EVENT,
    setCachedCandidateRewardOverview,
} from '../../service/rewardPaymentService';
import { readJsonStorage } from '../../util/storage';
import './CandidateRewards.css';

const CandidateWalletCard = ({ onOpenTopup, onWalletLoaded }) => {
    const activeUser = readJsonStorage('userData');
    const isForbiddenRole = Boolean(activeUser?.roleCode && activeUser.roleCode !== 'CANDIDATE');
    const [overview, setOverview] = useState(() => (
        activeUser && !isForbiddenRole ? getCachedCandidateRewardOverview() : null
    ));
    const [claimingCheckin, setClaimingCheckin] = useState(false);
    const [claimingProfile, setClaimingProfile] = useState(false);

    const loadWallet = useCallback(async () => {
        const user = readJsonStorage('userData');
        if (!user || (user.roleCode && user.roleCode !== 'CANDIDATE')) {
            setOverview(null);
            return;
        }
        try {
            const res = await getCandidateRewardOverviewService();
            if (res && res.errCode === 0 && res.data) {
                setCachedCandidateRewardOverview(res.data);
                setOverview(res.data);
                if (onWalletLoaded) onWalletLoaded(res.data);
            }
        } catch (_err) {
            // Keep cached state if request fails
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
        const user = readJsonStorage('userData');
        if (!user) {
            toast.warning('Vui lòng đăng nhập để điểm danh nhận +1 điểm.');
            window.location.href = '/login';
            return;
        }
        if (user.roleCode && user.roleCode !== 'CANDIDATE') {
            toast.error('Tính năng điểm danh nhận điểm chỉ dành cho tài khoản Ứng viên.');
            return;
        }
        setClaimingCheckin(true);
        try {
            const res = await claimCandidateDailyCheckinService();
            if (res && res.errCode === 0) {
                toast.success(res.errMessage || 'Điểm danh thành công (+1 điểm).');
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
        const user = readJsonStorage('userData');
        if (!user) {
            toast.warning('Vui lòng đăng nhập để nhận điểm hoàn thiện hồ sơ.');
            window.location.href = '/login';
            return;
        }
        if (user.roleCode && user.roleCode !== 'CANDIDATE') {
            toast.error('Tính năng tích điểm hồ sơ chỉ dành cho tài khoản Ứng viên.');
            return;
        }
        setClaimingProfile(true);
        try {
            const res = await claimCandidateProfileCompletionService();
            if (res && res.errCode === 0) {
                toast.success(res.errMessage || 'Đã nhận +20 điểm hoàn thiện hồ sơ.');
                notifyRewardWalletUpdated();
            } else {
                toast.info(res?.errMessage || 'Bạn đã nhận mục này trước đó.');
            }
        } catch (_err) {
            toast.error('Không thể nhận điểm lúc này.');
        } finally {
            setClaimingProfile(false);
        }
    };

    if (isForbiddenRole) return null;

    const hasUser = Boolean(activeUser);
    const balancePoints = Number(overview?.wallet?.balancePoints ?? 0);
    const balanceXu = Number(overview?.wallet?.balanceXu ?? balancePoints * 1000);
    const tierShort = overview?.wallet?.tierShortLabel || 'Thành viên';
    const checkedInToday = Boolean(overview?.missions?.checkedInToday);
    const profileClaimed = Boolean(overview?.missions?.profileCompletionClaimed);

    return (
        <section className="jf-wallet-sidebar-card" aria-label="Ví điểm ứng viên">
            <div className="jf-wallet-sidebar-card__head">
                <h2 className="jf-wallet-sidebar-card__title">Ví điểm ứng viên</h2>
                {hasUser && <span className="jf-wallet-sidebar-card__tier">{tierShort}</span>}
            </div>

            <dl className="jf-wallet-facts">
                <div>
                    <dt>Số dư hiện tại:</dt>
                    <dd className="jf-wallet-facts__pts">
                        {balancePoints.toLocaleString('vi-VN')} điểm
                    </dd>
                </div>
                <div>
                    <dt>Giá trị quy đổi:</dt>
                    <dd>{balanceXu.toLocaleString('vi-VN')} VNĐ</dd>
                </div>
            </dl>

            <div className="jf-wallet-tasks">
                <p className="jf-wallet-tasks__title">Nhận thêm điểm</p>
                <ul className="jf-wallet-earn-list">
                    <li className="jf-wallet-earn-item">
                        <span>Nộp CV ứng tuyển (+5 điểm)</span>
                        <span className="jf-wallet-earn-tag">Tự động</span>
                    </li>
                    <li className="jf-wallet-earn-item">
                        <span>Hoàn thiện hồ sơ (+20 điểm)</span>
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
                        <span>Điểm danh mỗi ngày (+1 điểm)</span>
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
                    Nạp điểm
                </button>
                <button
                    type="button"
                    className="jf-comp-btn-outline"
                    onClick={() => onOpenTopup && onOpenTopup('history')}
                >
                    Lịch sử điểm
                </button>
            </div>
        </section>
    );
};

export default CandidateWalletCard;
