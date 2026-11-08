import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
    getCachedEmployerRewardOverview,
    getEmployerRewardOverviewService,
    notifyRewardWalletUpdated,
    redeemEmployerPointsService,
    REWARD_WALLET_UPDATED_EVENT,
    setCachedEmployerRewardOverview,
} from '../../../service/rewardPaymentService';
import './EmployerRewardsSection.css';

const DEFAULT_EMPLOYER_CATALOG = [
    {
        code: 'POST_1',
        name: '1 lượt đăng tin thường',
        costPoints: 3,
        rewardField: 'allowPost',
        rewardAmount: 1,
        description: 'Cộng ngay +1 lượt đăng bài tuyển dụng tiêu chuẩn cho công ty.',
    },
    {
        code: 'HOT_POST_1',
        name: '1 lượt đăng tin nổi bật',
        costPoints: 6,
        rewardField: 'allowHotPost',
        rewardAmount: 1,
        description: 'Cộng ngay +1 lượt đăng tin nổi bật ưu tiên hiển thị đầu trang.',
    },
    {
        code: 'CV_5',
        name: '5 lượt xem hồ sơ ứng viên',
        costPoints: 4,
        rewardField: 'allowCv',
        rewardAmount: 5,
        description: 'Cộng ngay +5 lượt xem và tìm kiếm CV ứng viên tiềm năng.',
    },
    {
        code: 'CV_20',
        name: '20 lượt xem hồ sơ ứng viên',
        costPoints: 14,
        rewardField: 'allowCv',
        rewardAmount: 20,
        description: 'Cộng ngay +20 lượt mở khóa CV ứng viên (Tiết kiệm 2 Top Point).',
    },
];

const EmployerRewardsSection = ({ compact = false }) => {
    const [overview, setOverview] = useState(() => getCachedEmployerRewardOverview());
    const [redeemingCode, setRedeemingCode] = useState('');

    const loadEmployerRewards = useCallback(async () => {
        try {
            const res = await getEmployerRewardOverviewService();
            if (res && res.errCode === 0 && res.data) {
                setCachedEmployerRewardOverview(res.data);
                setOverview(res.data);
            }
        } catch (_err) {
            // Keep default catalog when offline or in unit test mocks
        }
    }, []);

    useEffect(() => {
        loadEmployerRewards();
    }, [loadEmployerRewards]);

    useEffect(() => {
        const onUpdated = () => {
            loadEmployerRewards();
        };
        window.addEventListener(REWARD_WALLET_UPDATED_EVENT, onUpdated);
        return () => {
            window.removeEventListener(REWARD_WALLET_UPDATED_EVENT, onUpdated);
        };
    }, [loadEmployerRewards]);

    const handleRedeem = async (rewardCode) => {
        setRedeemingCode(rewardCode);
        try {
            const res = await redeemEmployerPointsService(rewardCode);
            if (res && res.errCode === 0) {
                toast.success(res.errMessage || 'Đổi quà Top Point thành công!');
                await loadEmployerRewards();
                const nextAllowances = res.data?.allowances;
                notifyRewardWalletUpdated({
                    redeemed: rewardCode,
                    allowances: nextAllowances,
                    allowance: nextAllowances
                        ? {
                            free: Number(nextAllowances.allowCvFree ?? overview?.allowances?.allowCvFree ?? 0),
                            paid: Number(nextAllowances.allowCv ?? 0),
                        }
                        : undefined,
                });
            } else {
                toast.warning(res?.errMessage || 'Số dư Top Point chưa đủ để đổi phần quà này.');
            }
        } catch (_err) {
            toast.error('Không thể thực hiện đổi quà lúc này.');
        } finally {
            setRedeemingCode('');
        }
    };

    const balancePoints = Number(overview?.wallet?.balancePoints ?? 0);
    const lifetimeEarned = Number(overview?.wallet?.lifetimeEarned ?? 0);
    const tierLabel = overview?.wallet?.tierLabel || 'Thành viên (Member)';
    const multiplier = overview?.wallet?.multiplier ?? 1.0;
    const allowances = overview?.allowances || {
        allowPost: 0,
        allowHotPost: 0,
        allowCv: 0,
    };
    const catalog =
        Array.isArray(overview?.redemptionCatalog) && overview.redemptionCatalog.length > 0
            ? overview.redemptionCatalog
            : DEFAULT_EMPLOYER_CATALOG;
    const transactions = Array.isArray(overview?.transactions) ? overview.transactions : [];

    return (
        <section className="jf-emp-rewards" aria-label="JobFind Rewards - Tích điểm Nhà tuyển dụng">
            <div className="jf-emp-rewards__hero">
                <div className="jf-emp-rewards__hero-left">
                    <div className="jf-emp-rewards__badge-row">
                        <span className="jf-emp-rewards__tier-pill">
                            <i className="fas fa-crown" />
                            {tierLabel} (x{multiplier})
                        </span>
                        <span style={{ fontSize: '12px', color: '#93c5fd', fontWeight: 700 }}>
                            Chương trình ưu đãi khách hàng doanh nghiệp
                        </span>
                    </div>
                    <h2 className="jf-emp-rewards__title">
                        Chương trình Tích Điểm &amp; Đổi Quà Nhà Tuyển Dụng (Top Point)
                    </h2>
                    <p className="jf-emp-rewards__desc">
                        Mỗi <strong>100.000 VNĐ</strong> thanh toán gói đăng tin hoặc gói mở khóa CV tự động tích lũy{' '}
                        <strong>+1 Top Point</strong> (nhân hệ số hạng thành viên). Dùng Top Point để đổi miễn phí lượt đăng tin VIP và lượt xem hồ sơ ứng viên!
                    </p>
                </div>

                <div className="jf-emp-rewards__balance-box">
                    <div className="jf-emp-rewards__balance-label">Số dư Top Point khả dụng</div>
                    <div className="jf-emp-rewards__balance-pts">
                        {balancePoints.toLocaleString('vi-VN')} <small style={{ fontSize: '14px' }}>Top Point</small>
                    </div>
                    <div className="jf-emp-rewards__balance-sub">
                        Tổng điểm tích lũy: {lifetimeEarned.toLocaleString('vi-VN')} Top Point
                    </div>
                </div>
            </div>

            {/* Company Allowances */}
            <div className="jf-emp-allowances-grid">
                <div className="jf-emp-allowance-card">
                    <span className="jf-emp-allowance-card__label">Lượt đăng tin tiêu chuẩn:</span>
                    <span className="jf-emp-allowance-card__value">{allowances.allowPost ?? 0}</span>
                </div>
                <div className="jf-emp-allowance-card">
                    <span className="jf-emp-allowance-card__label">Lượt đăng tin nổi bật (Hot):</span>
                    <span className="jf-emp-allowance-card__value">{allowances.allowHotPost ?? 0}</span>
                </div>
                <div className="jf-emp-allowance-card">
                    <span className="jf-emp-allowance-card__label">Lượt xem CV ứng viên:</span>
                    <span className="jf-emp-allowance-card__value">{allowances.allowCv ?? 0}</span>
                </div>
            </div>

            {/* Redemption Catalog */}
            <div className="jf-emp-catalog-head">
                <h3 className="jf-emp-catalog-title">
                    <i className="fas fa-gift" style={{ color: '#003d9b', marginRight: '8px' }} />
                    Cửa hàng Đổi quà bằng Top Point
                </h3>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                    Cộng trực tiếp vào quỹ lượt của công ty ngay sau khi đổi
                </span>
            </div>

            <div className="jf-emp-catalog-grid">
                {catalog.map((item) => {
                    const canAfford = balancePoints >= Number(item.costPoints || 0);
                    return (
                        <div key={item.code} className="jf-emp-gift-card">
                            <div>
                                <span className="jf-emp-gift-card__badge">
                                    +{item.rewardAmount}{' '}
                                    {item.rewardField === 'allowCv'
                                        ? 'Lượt xem CV'
                                        : item.rewardField === 'allowHotPost'
                                        ? 'Tin Hot VIP'
                                        : 'Tin tiêu chuẩn'}
                                </span>
                                <h4 className="jf-emp-gift-card__name">{item.name}</h4>
                                <p className="jf-emp-gift-card__desc">{item.description}</p>
                            </div>

                            <div className="jf-emp-gift-card__footer">
                                <span className="jf-emp-gift-card__cost">
                                    <i className="fas fa-coins" style={{ marginRight: '5px' }} />
                                    {item.costPoints} Top Point
                                </span>
                                <button
                                    type="button"
                                    className="jf-emp-redeem-btn"
                                    disabled={redeemingCode === item.code || !canAfford}
                                    onClick={() => handleRedeem(item.code)}
                                >
                                    {redeemingCode === item.code
                                        ? 'Đang đổi...'
                                        : canAfford
                                        ? 'Đổi ngay'
                                        : 'Chưa đủ điểm'}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {!compact && transactions.length > 0 && (
                <div style={{ marginTop: '24px' }}>
                    <h3 className="jf-emp-catalog-title" style={{ marginBottom: '12px' }}>
                        Lịch sử tích điểm &amp; đổi quà gần đây
                    </h3>
                    <div className="jf-topup-history-list">
                        {transactions.slice(0, 8).map((tx) => {
                            const delta = Number(tx.pointsDelta || 0);
                            return (
                                <div key={tx.id} className="jf-topup-history-item">
                                    <div>
                                        <div className="jf-topup-history-item__title">
                                            {tx.description || tx.transactionType}
                                        </div>
                                        <div className="jf-topup-history-item__meta">
                                            {tx.createdAt
                                                ? new Date(tx.createdAt).toLocaleString('vi-VN')
                                                : 'Vừa xong'}{' '}
                                            • Số dư sau GD: {Number(tx.balanceAfter || 0)} Top Point
                                        </div>
                                    </div>
                                    <div
                                        className={`jf-topup-history-item__amount ${
                                            delta >= 0 ? 'is-plus' : 'is-minus'
                                        }`}
                                    >
                                        {delta >= 0 ? `+${delta}` : delta} Top Point
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </section>
    );
};

export default EmployerRewardsSection;
