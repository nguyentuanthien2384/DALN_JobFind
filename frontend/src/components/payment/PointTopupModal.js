import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { toast } from 'react-toastify';
import {
    createPaymentCheckoutService,
    DEFAULT_CANDIDATE_TOPUP_PACKAGES,
    getCachedCandidateRewardOverview,
    getCandidateRewardOverviewService,
    setCachedCandidateRewardOverview,
} from '../../service/rewardPaymentService';
import './PointTopupModal.css';

const PROMO_CATALOG = {
    VNPAY5K: { discountVnd: 5000, provider: 'VNPAY', minAmountVnd: 20000, label: 'Giảm 5.000đ qua VNPAY' },
    ARCHITECT5K: { discountVnd: 5000, provider: null, minAmountVnd: 20000, label: 'Giảm 5.000đ' },
    MOMO5K: { discountVnd: 5000, provider: 'MOMO', minAmountVnd: 20000, label: 'Giảm 5.000đ qua MoMo' },
    ZALOPAY5K: { discountVnd: 5000, provider: 'ZALOPAY', minAmountVnd: 20000, label: 'Giảm 5.000đ qua ZaloPay' },
    JOBFIND10K: { discountVnd: 10000, provider: null, minAmountVnd: 50000, label: 'Giảm 10.000đ' },
};

const GATEWAY_METHODS = [
    {
        code: 'VNPAY',
        shortLogo: 'VNPAY',
        title: 'Cổng thanh toán VNPAY',
        desc: 'Thẻ ATM nội địa (NAPAS), Visa/MasterCard hoặc VNPAY-QR',
    },
    {
        code: 'MOMO',
        shortLogo: 'MoMo',
        title: 'Ví điện tử MoMo',
        desc: 'Thanh toán qua ví MoMo hoặc thẻ ngân hàng liên kết',
    },
    {
        code: 'ZALOPAY',
        shortLogo: 'ZaloPay',
        title: 'Ví điện tử ZaloPay',
        desc: 'Thanh toán qua ví ZaloPay hoặc thẻ ATM nội địa',
    },
    {
        code: 'PAYPAL',
        shortLogo: 'PayPal',
        title: 'PayPal / Thẻ Quốc Tế',
        desc: 'Thanh toán quốc tế qua thẻ Visa, MasterCard hoặc PayPal',
    },
];

const formatVnd = (value) => `${Number(value || 0).toLocaleString('vi-VN')} VNĐ`;

const PointTopupModal = ({
    isOpen,
    onClose,
    initialTab = 'topup',
    walletData = null,
    postId = null,
}) => {
    const [activeTab, setActiveTab] = useState(initialTab || 'topup');
    const [step, setStep] = useState('select');
    const [localWallet, setLocalWallet] = useState(() => walletData || getCachedCandidateRewardOverview());
    const [selectedPkgCode, setSelectedPkgCode] = useState('STANDARD');
    const [selectedProvider, setSelectedProvider] = useState('VNPAY');
    const [promoInput, setPromoInput] = useState('');
    const [appliedPromo, setAppliedPromo] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab || 'topup');
            setStep('select');
        }
    }, [isOpen, initialTab]);

    useEffect(() => {
        if (walletData) {
            setLocalWallet(walletData);
        }
    }, [walletData]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && !submitting && onClose) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, submitting, onClose]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const rawUser = localStorage.getItem('userData');
        if (!rawUser) return undefined;
        if (process.env.NODE_ENV !== 'test' && getCachedCandidateRewardOverview()) {
            return undefined;
        }

        let cancelled = false;
        getCandidateRewardOverviewService()
            .then((res) => {
                if (!cancelled && res && res.errCode === 0 && res.data) {
                    setCachedCandidateRewardOverview(res.data);
                    setLocalWallet(res.data);
                }
            })
            .catch(() => {
                // Keep existing wallet state if offline
            });

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
        const bonusPoints = Number(found.bonusPoints ?? found.bonus ?? 0);
        const basePoints = Number(found.basePoints ?? Math.max(0, totalPoints - bonusPoints));
        const priceVnd = Number(found.priceVnd ?? found.price ?? 0);
        return {
            ...found,
            basePoints,
            bonusPoints,
            points: totalPoints,
            priceVnd,
        };
    }, [packages, selectedPkgCode]);

    const selectedGateway = useMemo(
        () => GATEWAY_METHODS.find((item) => item.code === selectedProvider) || GATEWAY_METHODS[0],
        [selectedProvider]
    );

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

    const walletBalance = Number(localWallet?.wallet?.balancePoints ?? 0);
    const transactions = Array.isArray(localWallet?.transactions) ? localWallet.transactions : [];

    const handleApplyPromo = () => {
        const normalized = String(promoInput || '').trim().toUpperCase();
        if (!normalized) {
            setAppliedPromo('');
            return;
        }
        const rule = PROMO_CATALOG[normalized];
        if (!rule) {
            toast.warning('Mã giảm giá không tồn tại hoặc đã hết hạn.');
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
        toast.success(`Đã áp dụng mã ${normalized} (${rule.label}).`);
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
                promoCode: discountInfo.discountVnd > 0 ? appliedPromo : '',
                postId,
                returnUrl,
            });
            const paymentUrl = res?.data?.paymentUrl || res?.data?.checkoutUrl || res?.link;
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

    const modalNode = (
        <div
            className="jf-topup-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Nạp điểm tài khoản"
            onClick={(e) => {
                if (e.target === e.currentTarget && !submitting && onClose) onClose();
            }}
        >
            <div className="jf-topup-modal">
                <div className="jf-topup-header">
                    <div>
                        <h2 className="jf-topup-header__title">Nạp điểm tài khoản</h2>
                        <p className="jf-topup-header__subtitle">
                            Nạp điểm để mở khóa thống kê ứng tuyển và các tiện ích dành cho ứng viên
                        </p>
                    </div>
                    <button
                        type="button"
                        className="jf-topup-close-btn"
                        aria-label="Đóng modal"
                        disabled={submitting}
                        onClick={onClose}
                    >
                        &times;
                    </button>
                </div>

                <div className="jf-topup-tabs">
                    <button
                        type="button"
                        className={`jf-topup-tab-btn ${activeTab === 'topup' ? 'is-active' : ''}`}
                        onClick={() => setActiveTab('topup')}
                    >
                        Nạp điểm
                    </button>
                    <button
                        type="button"
                        className={`jf-topup-tab-btn ${activeTab === 'history' ? 'is-active' : ''}`}
                        onClick={() => setActiveTab('history')}
                    >
                        Lịch sử dùng điểm
                    </button>
                </div>

                <div className="jf-topup-body">
                    <div className="jf-topup-balance-bar">
                        <span>
                            Số dư hiện tại: <strong>{walletBalance.toLocaleString('vi-VN')} điểm</strong>
                        </span>
                        <span className="jf-topup-balance-rate">Quy đổi: 1 điểm = 1.000 VNĐ</span>
                    </div>

                    {activeTab === 'history' ? (
                        transactions.length === 0 ? (
                            <div className="jf-topup-history-item">
                                <div>
                                    <div className="jf-topup-history-item__title">
                                        Chưa có giao dịch điểm nào
                                    </div>
                                    <div className="jf-topup-history-item__meta">
                                        Lịch sử cộng hoặc trừ điểm sẽ hiển thị tại đây.
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
                                                    • Số dư: {Number(tx.balanceAfter || 0).toLocaleString('vi-VN')} điểm
                                                </div>
                                            </div>
                                            <div
                                                className={`jf-topup-history-item__amount ${
                                                    isPlus ? 'is-plus' : 'is-minus'
                                                }`}
                                            >
                                                {isPlus ? `+${pts}` : pts} điểm
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    ) : (
                        <>
                            <div className="jf-topup-stepper">
                                <span
                                    className={`jf-topup-step-item ${
                                        step === 'select' ? 'is-active' : 'is-done'
                                    }`}
                                >
                                    <span className="jf-topup-step-badge">1</span>
                                    Chọn gói &amp; phương thức
                                </span>
                                <span className="jf-topup-step-sep">/</span>
                                <span
                                    className={`jf-topup-step-item ${
                                        step === 'confirm' ? 'is-active' : ''
                                    }`}
                                >
                                    <span className="jf-topup-step-badge">2</span>
                                    Xác nhận đơn nạp
                                </span>
                            </div>

                            {step === 'select' ? (
                                <>
                                    <div className="jf-topup-section">
                                        <label className="jf-topup-label">1. Chọn gói điểm</label>
                                        <div className="jf-topup-pkg-grid">
                                            {packages.map((pkg) => {
                                                const isSelected = pkg.code === selectedPkg.code;
                                                const totalPts = Number(pkg.totalPoints ?? pkg.points ?? 0);
                                                const bonusPts = Number(pkg.bonusPoints ?? pkg.bonus ?? 0);
                                                const priceVal = Number(pkg.priceVnd ?? pkg.price ?? 0);
                                                return (
                                                    <button
                                                        key={pkg.code}
                                                        type="button"
                                                        className={`jf-topup-pkg-card ${
                                                            isSelected ? 'is-selected' : ''
                                                        }`}
                                                        onClick={() => setSelectedPkgCode(pkg.code)}
                                                    >
                                                        <div className="jf-topup-pkg-card__head">
                                                            <span className="jf-topup-pkg-card__name">
                                                                {pkg.name}
                                                            </span>
                                                            <span className="jf-topup-radio" />
                                                        </div>
                                                        <div className="jf-topup-pkg-card__price">
                                                            {formatVnd(priceVal)}
                                                        </div>
                                                        <div className="jf-topup-pkg-card__pts">
                                                            Nhận <strong>{totalPts} điểm</strong>
                                                            {bonusPts > 0 ? ` (đã cộng ${bonusPts} điểm thưởng)` : ''}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="jf-topup-section">
                                        <label className="jf-topup-label">2. Phương thức thanh toán</label>
                                        <div className="jf-topup-method-list">
                                            {GATEWAY_METHODS.map((method) => {
                                                const isSelected = method.code === selectedProvider;
                                                return (
                                                    <button
                                                        key={method.code}
                                                        type="button"
                                                        className={`jf-topup-method-item ${
                                                            isSelected ? 'is-selected' : ''
                                                        }`}
                                                        onClick={() => setSelectedProvider(method.code)}
                                                    >
                                                        <div className="jf-topup-method-item__left">
                                                            <span className="jf-topup-method-tag">
                                                                {method.shortLogo}
                                                            </span>
                                                            <div>
                                                                <div className="jf-topup-method-title">
                                                                    {method.title}
                                                                </div>
                                                                <div className="jf-topup-method-desc">
                                                                    {method.desc}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <span className="jf-topup-radio" />
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="jf-topup-section">
                                        <label className="jf-topup-label" htmlFor="jf-topup-promo-input">
                                            Mã giảm giá (không bắt buộc)
                                        </label>
                                        <div className="jf-topup-promo-row">
                                            <input
                                                id="jf-topup-promo-input"
                                                type="text"
                                                className="jf-topup-promo-input"
                                                placeholder="Nhập mã giảm giá (nếu có)"
                                                value={promoInput}
                                                onChange={(e) => setPromoInput(e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                className="jf-topup-btn jf-topup-btn--secondary"
                                                onClick={handleApplyPromo}
                                            >
                                                Áp dụng
                                            </button>
                                        </div>
                                        {discountInfo.discountVnd > 0 && (
                                            <div className="jf-topup-promo-applied">
                                                <span>
                                                    Đã áp dụng mã <strong>{appliedPromo}</strong> (-
                                                    {formatVnd(discountInfo.discountVnd)})
                                                </span>
                                                <button
                                                    type="button"
                                                    style={{
                                                        border: 'none',
                                                        background: 'none',
                                                        color: '#b91c1c',
                                                        fontSize: '12px',
                                                        cursor: 'pointer',
                                                        padding: 0,
                                                    }}
                                                    onClick={() => {
                                                        setPromoInput('');
                                                        setAppliedPromo('');
                                                    }}
                                                >
                                                    Bỏ mã
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="jf-topup-confirm-box">
                                        <div className="jf-topup-confirm-row">
                                            <span>Gói nạp đã chọn:</span>
                                            <strong>{selectedPkg.name}</strong>
                                        </div>
                                        <div className="jf-topup-confirm-row">
                                            <span>Số điểm nhận được:</span>
                                            <strong>+{selectedPkg.points} điểm</strong>
                                        </div>
                                        <div className="jf-topup-confirm-row">
                                            <span>Số dư dự kiến sau khi nạp:</span>
                                            <strong>
                                                {(walletBalance + selectedPkg.points).toLocaleString('vi-VN')} điểm
                                            </strong>
                                        </div>
                                        <div className="jf-topup-confirm-row">
                                            <span>Phương thức thanh toán:</span>
                                            <strong>{selectedGateway.title}</strong>
                                        </div>
                                        <div className="jf-topup-confirm-row">
                                            <span>Giá gói:</span>
                                            <strong>{formatVnd(selectedPkg.priceVnd)}</strong>
                                        </div>
                                        {discountInfo.discountVnd > 0 && (
                                            <div className="jf-topup-confirm-row">
                                                <span>Giảm giá ({appliedPromo}):</span>
                                                <strong style={{ color: '#15803d' }}>
                                                    -{formatVnd(discountInfo.discountVnd)}
                                                </strong>
                                            </div>
                                        )}
                                        <div className="jf-topup-confirm-row jf-topup-confirm-row--total">
                                            <span>Tổng thanh toán:</span>
                                            <strong>{formatVnd(finalAmountVnd)}</strong>
                                        </div>
                                    </div>

                                    <p className="jf-topup-confirm-hint">
                                        Sau khi nhấn <strong>Xác nhận thanh toán</strong>, hệ thống sẽ chuyển sang trang cổng thanh toán để bạn nhập thông tin thẻ ngân hàng và xác thực mã OTP.
                                    </p>
                                </>
                            )}
                        </>
                    )}
                </div>

                <div className="jf-topup-footer">
                    {activeTab === 'history' ? (
                        <div className="jf-topup-footer__actions">
                            <button
                                type="button"
                                className="jf-topup-btn jf-topup-btn--secondary"
                                onClick={() => setActiveTab('topup')}
                            >
                                Chuyển sang Nạp điểm
                            </button>
                            <button
                                type="button"
                                className="jf-topup-btn jf-topup-btn--primary"
                                onClick={onClose}
                            >
                                Đóng
                            </button>
                        </div>
                    ) : step === 'select' ? (
                        <>
                            <div className="jf-topup-footer__summary">
                                Tổng cộng: <strong>{formatVnd(finalAmountVnd)}</strong>
                            </div>
                            <div className="jf-topup-footer__actions">
                                <button
                                    type="button"
                                    className="jf-topup-btn jf-topup-btn--secondary"
                                    onClick={onClose}
                                >
                                    Hủy
                                </button>
                                <button
                                    type="button"
                                    className="jf-topup-btn jf-topup-btn--primary"
                                    onClick={() => setStep('confirm')}
                                >
                                    Tiếp tục
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="jf-topup-footer__actions">
                            <button
                                type="button"
                                className="jf-topup-btn jf-topup-btn--secondary"
                                disabled={submitting}
                                onClick={() => setStep('select')}
                            >
                                Quay lại
                            </button>
                            <button
                                type="button"
                                className="jf-topup-btn jf-topup-btn--primary"
                                disabled={submitting}
                                onClick={handleConfirmCheckout}
                            >
                                {submitting ? 'Đang khởi tạo...' : 'Xác nhận thanh toán'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    if (typeof document !== 'undefined' && document.body) {
        return ReactDOM.createPortal(modalNode, document.body);
    }
    return modalNode;
};

export default React.memo(PointTopupModal);
