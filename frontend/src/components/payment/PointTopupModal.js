import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import {
    createPaymentCheckoutService,
    DEFAULT_CANDIDATE_TOPUP_PACKAGES,
    getCachedCandidateRewardOverview,
    getCandidateRewardOverviewService,
    setCachedCandidateRewardOverview,
} from '../../service/rewardPaymentService';
import SandboxTestCardHint from './SandboxTestCardHint';
import './PointTopupModal.css';

const PROMO_CATALOG = {
    VNPAY5K: { discountVnd: 5000, provider: 'VNPAY', minAmountVnd: 20000, label: 'Khuyến mãi VNPAY-QR (-5.000đ)' },
    ARCHITECT5K: { discountVnd: 5000, provider: null, minAmountVnd: 20000, label: 'Mã ưu đãi ARCHITECT5K (-5.000đ)' },
    MOMO5K: { discountVnd: 5000, provider: 'MOMO', minAmountVnd: 20000, label: 'Ưu đãi Ví MoMo (-5.000đ)' },
    ZALOPAY5K: { discountVnd: 5000, provider: 'ZALOPAY', minAmountVnd: 20000, label: 'Ưu đãi Ví ZaloPay (-5.000đ)' },
    JOBFIND10K: { discountVnd: 10000, provider: null, minAmountVnd: 50000, label: 'Ưu đãi JOBFIND10K (-10.000đ)' },
};

const GATEWAY_METHODS = [
    {
        code: 'VNPAY',
        shortLogo: 'VNPAY',
        logoClass: 'jf-topup-method-logo--vnpay',
        title: 'Cổng thanh toán VNPAY',
        tag: 'Thẻ ATM NCB / Visa / QR',
        desc: 'Nhập thẻ dùng thử NCB nội địa hoặc Visa Sandbox (giảm thêm 5.000đ)',
        defaultPromo: 'VNPAY5K',
    },
    {
        code: 'MOMO',
        shortLogo: 'MoMo',
        logoClass: 'jf-topup-method-logo--momo',
        title: 'Ví điện tử MoMo',
        tag: 'Thẻ ATM NAPAS / Visa',
        desc: 'Cổng MoMo Merchant Trial — hỗ trợ nhập thẻ ATM NAPAS & Visa dùng thử',
        defaultPromo: 'MOMO5K',
    },
    {
        code: 'ZALOPAY',
        shortLogo: 'ZaloPay',
        logoClass: 'jf-topup-method-logo--zalopay',
        title: 'Ví điện tử ZaloPay',
        tag: 'Merchant Trial V2',
        desc: 'Cổng ZaloPay Gateway — nhập trực tiếp thẻ ATM nội địa hoặc Internet Banking',
        defaultPromo: 'ZALOPAY5K',
    },
    {
        code: 'PAYPAL',
        shortLogo: 'PayPal',
        logoClass: 'jf-topup-method-logo--paypal',
        title: 'PayPal / Thẻ Quốc Tế',
        tag: 'Visa / Master / USD',
        desc: 'Cổng PayPal Sandbox quốc tế hỗ trợ tài khoản Buyer & thẻ dùng thử',
        defaultPromo: 'ARCHITECT5K',
    },
];

const formatVnd = (value) => {
    const num = Number(value || 0);
    return `${num.toLocaleString('vi-VN')} VNĐ`;
};

const PointTopupModal = ({
    isOpen,
    onClose,
    initialTab = 'topup',
    walletData = null,
    postId = null,
}) => {
    const [activeTab, setActiveTab] = useState(initialTab || 'topup');
    const [localWallet, setLocalWallet] = useState(() => walletData || getCachedCandidateRewardOverview());
    const [selectedPkgCode, setSelectedPkgCode] = useState('STANDARD');
    const [selectedProvider, setSelectedProvider] = useState('VNPAY');
    const [promoInput, setPromoInput] = useState('VNPAY5K');
    const [appliedPromo, setAppliedPromo] = useState('VNPAY5K');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab || 'topup');
        }
    }, [isOpen, initialTab]);

    useEffect(() => {
        if (walletData) {
            setLocalWallet(walletData);
        }
    }, [walletData]);

    useEffect(() => {
        if (!isOpen) return undefined;
        let cancelled = false;
        const rawUser = localStorage.getItem('userData');
        if (!rawUser) return undefined;

        const fetchOverview = async () => {
            try {
                const res = await getCandidateRewardOverviewService();
                if (!cancelled && res && res.errCode === 0 && res.data) {
                    setCachedCandidateRewardOverview(res.data);
                    setLocalWallet(res.data);
                }
            } catch (_err) {
                // Keep existing wallet state if unauthenticated or offline
            }
        };
        fetchOverview();
        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    const packages = useMemo(() => {
        if (Array.isArray(localWallet?.topupPackages) && localWallet.topupPackages.length > 0) {
            return localWallet.topupPackages;
        }
        return DEFAULT_CANDIDATE_TOPUP_PACKAGES;
    }, [localWallet]);

    const selectedPkg = useMemo(() => {
        const found = packages.find((pkg) => pkg.code === selectedPkgCode) || packages[1] || packages[0];
        if (!found) return DEFAULT_CANDIDATE_TOPUP_PACKAGES[1];
        const totalPoints = Number(found.totalPoints ?? found.points ?? 0);
        const priceVnd = Number(found.priceVnd ?? found.price ?? 0);
        return {
            ...found,
            points: totalPoints,
            xu: Number(found.xu || totalPoints * 1000),
            priceVnd,
            originalPriceVnd: Number(found.originalPriceVnd || totalPoints * 1000 || priceVnd),
        };
    }, [packages, selectedPkgCode]);

    const discountInfo = useMemo(() => {
        const code = String(appliedPromo || '').trim().toUpperCase();
        if (!code || !PROMO_CATALOG[code]) {
            return { discountVnd: 0, label: null };
        }
        const rule = PROMO_CATALOG[code];
        if (rule.provider && rule.provider !== selectedProvider) {
            return { discountVnd: 0, label: null };
        }
        const basePrice = Number(selectedPkg?.priceVnd || 0);
        if (rule.minAmountVnd && basePrice < rule.minAmountVnd) {
            return { discountVnd: 0, label: null };
        }
        return {
            discountVnd: Math.min(rule.discountVnd, Math.max(0, basePrice - 5000)),
            label: rule.label,
        };
    }, [appliedPromo, selectedProvider, selectedPkg]);

    const finalAmountVnd = useMemo(() => {
        const basePrice = Number(selectedPkg?.priceVnd || 0);
        return Math.max(5000, basePrice - Number(discountInfo.discountVnd || 0));
    }, [selectedPkg, discountInfo]);

    if (!isOpen) return null;

    const walletBalance = Number(localWallet?.wallet?.balancePoints ?? 45);
    const walletXu = Number(localWallet?.wallet?.balanceXu ?? walletBalance * 1000);
    const tierLabel = localWallet?.wallet?.tierLabel || 'Hạng Bạc (Silver Member)';
    const transactions = Array.isArray(localWallet?.transactions) ? localWallet.transactions : [];

    const handleSelectProvider = (providerCode) => {
        setSelectedProvider(providerCode);
        const gateway = GATEWAY_METHODS.find((item) => item.code === providerCode);
        if (gateway?.defaultPromo) {
            setPromoInput(gateway.defaultPromo);
            setAppliedPromo(gateway.defaultPromo);
        }
    };

    const handleApplyPromo = () => {
        const normalized = String(promoInput || '').trim().toUpperCase();
        if (!normalized) {
            setAppliedPromo('');
            toast.info('Đã xóa mã khuyến mãi.');
            return;
        }
        const rule = PROMO_CATALOG[normalized];
        if (!rule) {
            toast.warning('Mã ưu đãi không tồn tại. Gợi ý: VNPAY5K, ARCHITECT5K, MOMO5K, ZALOPAY5K, JOBFIND10K');
            return;
        }
        if (rule.provider && rule.provider !== selectedProvider) {
            toast.warning(`Mã ${normalized} chỉ áp dụng cho phương thức ${rule.provider}.`);
            return;
        }
        if (rule.minAmountVnd && Number(selectedPkg?.priceVnd || 0) < rule.minAmountVnd) {
            toast.warning(`Mã ${normalized} áp dụng cho gói từ ${formatVnd(rule.minAmountVnd)}.`);
            return;
        }
        setAppliedPromo(normalized);
        toast.success(`Đã áp dụng ${rule.label}!`);
    };

    const handleConfirmCheckout = async () => {
        const rawUser = localStorage.getItem('userData');
        if (!rawUser) {
            toast.warning('Vui lòng đăng nhập tài khoản Ứng viên để nạp điểm!');
            window.location.href = '/login';
            return;
        }
        setSubmitting(true);
        try {
            const returnUrl = `${window.location.origin}/payment/result`;
            const res = await createPaymentCheckoutService({
                purpose: 'POINT_TOPUP',
                itemCode: selectedPkg.code,
                provider: selectedProvider,
                promoCode: appliedPromo,
                postId,
                returnUrl,
            });
            const paymentUrl =
                res?.data?.paymentUrl || res?.data?.checkoutUrl || res?.link;
            if (res && res.errCode === 0 && paymentUrl) {
                if (process.env.NODE_ENV !== 'test') {
                    window.location.assign(paymentUrl);
                }
                return;
            }
            toast.error(res?.errMessage || 'Không thể khởi tạo giao dịch thanh toán.');
        } catch (_error) {
            toast.error('Lỗi kết nối cổng thanh toán. Vui lòng thử lại.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="jf-topup-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Nạp Điểm & Mua Xu Ứng Viên"
            onClick={(e) => {
                if (e.target === e.currentTarget && onClose) onClose();
            }}
        >
            <div className="jf-topup-modal">
                {/* Modal Header */}
                <div className="jf-topup-header">
                    <div className="jf-topup-header__left">
                        <div className="jf-topup-header__icon">
                            <i className="fas fa-coins" />
                        </div>
                        <div>
                            <div className="jf-topup-header__title-row">
                                <h2 className="jf-topup-header__title">Nạp Điểm &amp; Mua Xu Ứng Viên</h2>
                                <span className="jf-topup-header__promo-pill">
                                    <i className="fas fa-fire" />
                                    Ưu đãi +20% hôm nay
                                </span>
                            </div>
                            <p className="jf-topup-header__subtitle">
                                Dùng điểm để mở khóa báo cáo cạnh tranh ứng viên, đẩy Top CV và xem phân tích chuyên sâu
                            </p>
                        </div>
                    </div>

                    <div className="jf-topup-header__actions">
                        <div className="jf-topup-tab-switch">
                            <button
                                type="button"
                                className={`jf-topup-tab-btn ${activeTab === 'topup' ? 'is-active' : ''}`}
                                onClick={() => setActiveTab('topup')}
                            >
                                Nạp Điểm
                            </button>
                            <button
                                type="button"
                                className={`jf-topup-tab-btn ${activeTab === 'history' ? 'is-active' : ''}`}
                                onClick={() => setActiveTab('history')}
                            >
                                Lịch sử dùng điểm
                            </button>
                        </div>
                        <button
                            type="button"
                            className="jf-topup-close-btn"
                            aria-label="Đóng modal"
                            onClick={onClose}
                        >
                            <i className="fas fa-times" />
                        </button>
                    </div>
                </div>

                {/* Modal Body */}
                <div className="jf-topup-body">
                    {/* Candidate Current Balance Card */}
                    <div className="jf-topup-balance-card">
                        <div className="jf-topup-balance-card__left">
                            <div className="jf-topup-balance-card__icon">
                                <i className="fas fa-wallet" />
                            </div>
                            <div>
                                <div className="jf-topup-balance-card__label">Số dư khả dụng hiện tại</div>
                                <div className="jf-topup-balance-card__value">
                                    <span>{walletBalance.toLocaleString('vi-VN')} Điểm thưởng</span>
                                    <span className="jf-topup-balance-card__xu">
                                        (Tương đương {walletXu.toLocaleString('vi-VN')} Xu)
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="jf-topup-balance-card__tier">
                            <i className="fas fa-shield-alt" style={{ color: '#003d9b' }} />
                            <span>{tierLabel}</span>
                        </div>
                    </div>

                    {activeTab === 'history' ? (
                        <div>
                            <div className="jf-topup-section-head">
                                <h3 className="jf-topup-section-title">
                                    <span className="jf-topup-step-num">
                                        <i className="fas fa-history" />
                                    </span>
                                    Lịch sử biến động Điểm &amp; Xu gần đây
                                </h3>
                            </div>
                            {transactions.length === 0 ? (
                                <div className="jf-topup-history-item">
                                    <div>
                                        <div className="jf-topup-history-item__title">
                                            Chưa có giao dịch điểm nào được ghi nhận
                                        </div>
                                        <div className="jf-topup-history-item__meta">
                                            Bạn có thể nộp CV (+5 Điểm), điểm danh hằng ngày (+1 Điểm) hoặc nạp Xu trực tiếp.
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="jf-topup-history-list">
                                    {transactions.map((tx) => {
                                        const pts = Number(tx.pointsDelta || 0);
                                        const isPlus = pts >= 0;
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
                                                        • Số dư sau GD: {Number(tx.balanceAfter || 0).toLocaleString('vi-VN')} Điểm
                                                    </div>
                                                </div>
                                                <div
                                                    className={`jf-topup-history-item__amount ${
                                                        isPlus ? 'is-plus' : 'is-minus'
                                                    }`}
                                                >
                                                    {isPlus ? `+${pts}` : pts} Điểm
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* Step 1: Choose Package */}
                            <div>
                                <div className="jf-topup-section-head">
                                    <h3 className="jf-topup-section-title">
                                        <span className="jf-topup-step-num">1</span>
                                        Chọn gói nạp điểm tối ưu
                                    </h3>
                                    <span style={{ fontSize: '12px', color: '#0058be', fontWeight: 600 }}>
                                        1 Điểm = 1.000 Xu = 1.000 VNĐ
                                    </span>
                                </div>

                                <div className="jf-topup-pkg-grid">
                                    {packages.map((pkg) => {
                                        const isSelected = pkg.code === selectedPkg.code;
                                        return (
                                            <button
                                                key={pkg.code}
                                                type="button"
                                                className={`jf-topup-pkg-card ${isSelected ? 'is-selected' : ''}`}
                                                onClick={() => setSelectedPkgCode(pkg.code)}
                                            >
                                                {pkg.badge && (
                                                    <span className="jf-topup-pkg-badge">{pkg.badge}</span>
                                                )}
                                                <div>
                                                    <div className="jf-topup-pkg-card__top">
                                                        <span className="jf-topup-pkg-card__name">{pkg.name}</span>
                                                        <i
                                                            className={`fas ${
                                                                isSelected ? 'fa-check-circle' : 'fa-circle'
                                                            } jf-topup-pkg-card__check`}
                                                        />
                                                    </div>
                                                    <div className="jf-topup-pkg-card__price">
                                                        {Number(pkg.priceVnd || 0).toLocaleString('vi-VN')}{' '}
                                                        <small>VNĐ</small>
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="jf-topup-pkg-card__points">
                                                        <i className="fas fa-check-circle" />
                                                        Nhận {pkg.points} Điểm ({Number(pkg.xu || pkg.points * 1000).toLocaleString('vi-VN')} Xu)
                                                    </div>
                                                    <div className="jf-topup-pkg-card__bonus">
                                                        {pkg.discountPercent > 0
                                                            ? `Tiết kiệm ${pkg.discountPercent}% (${formatVnd(pkg.originalPriceVnd - pkg.priceVnd)})`
                                                            : 'Mở ngay 02 báo cáo cạnh tranh'}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Step 2 & 3: Payment Methods + Order Summary */}
                            <div className="jf-topup-split">
                                {/* Col Left: Payment methods */}
                                <div>
                                    <div className="jf-topup-section-head">
                                        <h3 className="jf-topup-section-title">
                                            <span className="jf-topup-step-num">2</span>
                                            Phương thức thanh toán (VNPAY, MoMo, ZaloPay, PayPal)
                                        </h3>
                                    </div>

                                    <div className="jf-topup-methods">
                                        {GATEWAY_METHODS.map((method) => {
                                            const isSelected = selectedProvider === method.code;
                                            return (
                                                <div
                                                    key={method.code}
                                                    role="radio"
                                                    aria-checked={isSelected}
                                                    tabIndex={0}
                                                    className={`jf-topup-method-card jf-topup-method-card--${method.code.toLowerCase()} ${
                                                        isSelected ? 'is-selected' : ''
                                                    }`}
                                                    onClick={() => handleSelectProvider(method.code)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            handleSelectProvider(method.code);
                                                        }
                                                    }}
                                                >
                                                    <div className="jf-topup-method-card__left">
                                                        <div className={`jf-topup-method-logo ${method.logoClass}`}>
                                                            {method.shortLogo}
                                                        </div>
                                                        <div>
                                                            <div className="jf-topup-method-card__title">
                                                                <span>{method.title}</span>
                                                                <span className="jf-topup-method-card__tag">
                                                                    {method.tag}
                                                                </span>
                                                            </div>
                                                            <p className="jf-topup-method-card__desc">{method.desc}</p>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <i
                                                            className={`fas ${
                                                                isSelected ? 'fa-check-circle' : 'fa-circle'
                                                            }`}
                                                            style={{
                                                                color: isSelected ? '#003d9b' : '#c3c6d7',
                                                                fontSize: '18px',
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Promo code box */}
                                    <div className="jf-topup-promo-box">
                                        <input
                                            type="text"
                                            className="jf-topup-promo-input"
                                            placeholder="Nhập mã ưu đãi (VD: VNPAY5K, ARCHITECT5K)"
                                            value={promoInput}
                                            onChange={(e) => setPromoInput(e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            className="jf-topup-promo-btn"
                                            onClick={handleApplyPromo}
                                        >
                                            Áp dụng
                                        </button>
                                    </div>

                                    <SandboxTestCardHint provider={selectedProvider} compact />
                                </div>

                                {/* Col Right: Payment Summary */}
                                <div className="jf-topup-summary-card">
                                    <div>
                                        <div className="jf-topup-section-head">
                                            <h3 className="jf-topup-section-title">
                                                <span className="jf-topup-step-num">3</span>
                                                Chi tiết thanh toán
                                            </h3>
                                        </div>

                                        <div className="jf-topup-summary-rows">
                                            <div className="jf-topup-summary-row">
                                                <span>Gói đã chọn:</span>
                                                <strong>{selectedPkg.name}</strong>
                                            </div>
                                            <div className="jf-topup-summary-row">
                                                <span>Cổng thanh toán:</span>
                                                <strong>{selectedProvider}</strong>
                                            </div>
                                            <div className="jf-topup-summary-row">
                                                <span>Giá niêm yết gói nạp:</span>
                                                <strong>{formatVnd(selectedPkg.priceVnd)}</strong>
                                            </div>
                                            <div className="jf-topup-summary-row jf-topup-summary-row--points">
                                                <span>Điểm nhận được:</span>
                                                <strong>
                                                    +{selectedPkg.points} Điểm ({Number(selectedPkg.xu || selectedPkg.points * 1000).toLocaleString('vi-VN')} Xu)
                                                </strong>
                                            </div>
                                            {discountInfo.discountVnd > 0 && (
                                                <div className="jf-topup-summary-row jf-topup-summary-row--discount">
                                                    <span>{discountInfo.label}:</span>
                                                    <span>-{formatVnd(discountInfo.discountVnd)}</span>
                                                </div>
                                            )}

                                            <div className="jf-topup-summary-total">
                                                <div>
                                                    <div style={{ fontWeight: 700, color: '#191c1e' }}>
                                                        Tổng thanh toán:
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                                                        Đã bao gồm thuế VAT
                                                    </div>
                                                </div>
                                                <div className="jf-topup-summary-total__price">
                                                    {formatVnd(finalAmountVnd)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="jf-topup-summary-guarantee">
                                        <div className="jf-topup-summary-guarantee__title">
                                            <i className="fas fa-user-shield" />
                                            Bảo vệ hoàn tiền 100% nếu phát sinh lỗi
                                        </div>
                                        <div>
                                            Điểm thưởng được cộng tự động vào ví ứng viên ngay sau khi xác nhận giao dịch thành công.
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Modal Footer */}
                <div className="jf-topup-footer">
                    <div className="jf-topup-security">
                        <span>
                            <i className="fas fa-lock" />
                            Mã hóa SSL 256-bit
                        </span>
                        <span>|</span>
                        <span>
                            <i className="fas fa-shield-alt" />
                            Chứng chỉ PCI-DSS
                        </span>
                    </div>

                    <div className="jf-topup-footer__cta">
                        <button type="button" className="jf-topup-btn-cancel" onClick={onClose}>
                            Hủy bỏ
                        </button>
                        {activeTab === 'topup' ? (
                            <button
                                type="button"
                                className="jf-topup-btn-submit"
                                disabled={submitting}
                                onClick={handleConfirmCheckout}
                            >
                                <span>
                                    {submitting ? 'Đang kết nối cổng thanh toán...' : 'Xác Nhận Thanh Toán Ngay'}
                                </span>
                                <i className="fas fa-arrow-right" />
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="jf-topup-btn-submit"
                                onClick={() => setActiveTab('topup')}
                            >
                                <span>Chuyển sang Nạp Điểm</span>
                                <i className="fas fa-plus" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PointTopupModal;
