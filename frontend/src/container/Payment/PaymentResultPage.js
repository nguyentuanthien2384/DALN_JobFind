import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
    notifyRewardWalletUpdated,
    SANDBOX_TEST_CARDS,
    verifyPaymentReturnService,
} from '../../service/rewardPaymentService';
import './PaymentResultPage.css';

const formatVnd = (value) => `${Number(value || 0).toLocaleString('vi-VN')} VNĐ`;

const PROVIDER_META = {
    VNPAY: {
        name: 'Cổng thanh toán VNPAY Sandbox',
        bannerClass: 'jf-pay-result-banner--vnpay',
        qrHint: 'Nhập thẻ nội địa NCB / NAPAS hoặc thẻ quốc tế VISA cấp sẵn miễn phí',
    },
    MOMO: {
        name: 'Cổng thanh toán MoMo Sandbox',
        bannerClass: 'jf-pay-result-banner--momo',
        qrHint: 'Nhập thẻ ATM NAPAS hoặc thẻ quốc tế VISA dùng thử của MoMo Merchant Trial',
    },
    ZALOPAY: {
        name: 'ZaloPay Gateway (Merchant Trial V2)',
        bannerClass: 'jf-pay-result-banner--zalopay',
        qrHint: 'Nhập thẻ ATM nội địa NAPAS hoặc Internet Banking dùng thử của ZaloPay',
    },
    PAYPAL: {
        name: 'Cổng thanh toán quốc tế PayPal Sandbox',
        bannerClass: 'jf-pay-result-banner--paypal',
        qrHint: 'Xác thực thanh toán an toàn qua tài khoản Buyer hoặc thẻ PayPal Sandbox',
    },
};

const detectProviderFromQuery = (queryObject = {}) => {
    if (queryObject.provider) return String(queryObject.provider).toUpperCase();
    if (queryObject.vnp_TxnRef || queryObject.vnp_SecureHash) return 'VNPAY';
    if (queryObject.apptransid || queryObject.appid) return 'ZALOPAY';
    if (queryObject.partnerCode || queryObject.resultCode !== undefined) return 'MOMO';
    if (queryObject.PayerID || queryObject.payerId || queryObject.paymentId) return 'PAYPAL';
    return 'VNPAY';
};

const PaymentResultPage = () => {
    const location = useLocation();
    const [loading, setLoading] = useState(true);
    const [processingAction, setProcessingAction] = useState(false);
    const [resultData, setResultData] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [cardError, setCardError] = useState('');

    const queryObject = useMemo(() => {
        const params = new URLSearchParams(location.search || '');
        const obj = {};
        params.forEach((value, key) => {
            obj[key] = value;
        });
        return obj;
    }, [location.search]);

    const order = resultData?.order || (resultData?.orderCode ? resultData : null);
    const providerKey = String(order?.provider || detectProviderFromQuery(queryObject)).toUpperCase();
    const providerMeta = PROVIDER_META[providerKey] || PROVIDER_META.VNPAY;
    const availableTestCards = useMemo(() => {
        if (Array.isArray(resultData?.testCards) && resultData.testCards.length > 0) {
            return resultData.testCards;
        }
        return SANDBOX_TEST_CARDS[providerKey] || SANDBOX_TEST_CARDS.VNPAY;
    }, [resultData, providerKey]);

    const [cardForm, setCardForm] = useState(() => {
        const initialCard = (SANDBOX_TEST_CARDS[detectProviderFromQuery()] || SANDBOX_TEST_CARDS.VNPAY)[0];
        return {
            bank: initialCard.bank,
            cardNumber: initialCard.cardNumber,
            cardHolder: initialCard.cardHolder,
            issueDate: initialCard.issueDate || initialCard.expiryDate || '07/15',
            otp: initialCard.otp || '123456',
        };
    });

    useEffect(() => {
        const firstCard = availableTestCards[0];
        if (firstCard) {
            setCardForm({
                bank: firstCard.bank,
                cardNumber: firstCard.cardNumber,
                cardHolder: firstCard.cardHolder,
                issueDate: firstCard.issueDate || firstCard.expiryDate || '07/15',
                otp: firstCard.otp || '123456',
            });
        }
    }, [providerKey, availableTestCards]);

    const applyPresetCard = (card) => {
        setCardError('');
        setCardForm({
            bank: card.bank,
            cardNumber: card.cardNumber,
            cardHolder: card.cardHolder || 'NGUYEN VAN A',
            issueDate: card.issueDate || card.expiryDate || '07/15',
            otp: card.otp || '123456',
        });
    };

    const verifyPayment = useCallback(
        async (extraParams = {}) => {
            try {
                const res = await verifyPaymentReturnService({
                    ...queryObject,
                    ...extraParams,
                });
                if (res && res.errCode === 0 && res.data) {
                    setResultData(res.data);
                    setErrorMessage('');
                    setCardError('');
                    const resolvedOrder = res.data.order || res.data;
                    if (res.data.paid || resolvedOrder?.status === 'PAID') {
                        notifyRewardWalletUpdated({ order: resolvedOrder });
                    }
                    return { ok: true, paid: Boolean(res.data.paid || resolvedOrder?.status === 'PAID'), res };
                }
                if (res && res.requireSimulationAction && res.data) {
                    setResultData(res.data);
                    setErrorMessage('');
                    setCardError(res.errMessage || 'Thông tin thẻ dùng thử chưa hợp lệ.');
                    return { ok: false, cardInvalid: true, res };
                }
                if (res && res.data && (res.data.order || res.data.orderCode)) {
                    setResultData(res.data);
                    setErrorMessage('');
                    return { ok: false, res };
                }
                setErrorMessage(res?.errMessage || 'Không tìm thấy thông tin đơn thanh toán.');
                return { ok: false, res };
            } catch (_err) {
                setErrorMessage('Không thể xác thực trạng thái giao dịch. Vui lòng thử lại.');
                return { ok: false };
            } finally {
                setLoading(false);
                setProcessingAction(false);
            }
        },
        [queryObject]
    );

    useEffect(() => {
        setLoading(true);
        verifyPayment();
    }, [verifyPayment]);

    const handleSimulationDecision = async (action) => {
        setProcessingAction(true);
        setCardError('');
        if (action === 'confirm') {
            const outcome = await verifyPayment({
                simulateAction: 'confirm',
                simulateCardNumber: cardForm.cardNumber,
                simulateCardHolder: cardForm.cardHolder,
                simulateIssueDate: cardForm.issueDate,
                simulateOtp: cardForm.otp,
            });
            if (outcome?.paid) {
                toast.success('Thanh toán thành công! Điểm/lượt dịch vụ đã được cộng vào tài khoản.');
            } else if (outcome?.cardInvalid) {
                toast.error(outcome.res?.errMessage || 'Thẻ dùng thử không hợp lệ.');
            }
        } else {
            await verifyPayment({ simulateAction: 'cancel' });
            toast.info('Đã hủy giao dịch thanh toán.');
        }
    };

    const requireSimAction = Boolean(resultData?.requireSimulationAction);
    const isPaid = Boolean(resultData?.paid || order?.status === 'PAID');
    const postId = order?.metadata?.postId || queryObject.postId || null;

    return (
        <div className="jf-pay-result-page">
            <div className="jf-pay-result-card">
                <div className={`jf-pay-result-banner ${providerMeta.bannerClass}`}>
                    <div>
                        <h1 className="jf-pay-result-banner__title">{providerMeta.name}</h1>
                        <p className="jf-pay-result-banner__sub">
                            {requireSimAction
                                ? 'Cổng thanh toán Sandbox (Môi trường kiểm thử tích hợp JobFind)'
                                : 'Biên lai xác nhận giao dịch trực tuyến JobFind'}
                        </p>
                    </div>
                    <span className="jf-pay-result-banner__badge">{providerKey}</span>
                </div>

                <div className="jf-pay-result-body">
                    {loading ? (
                        <div className="jf-pay-status-box">
                            <div className="jf-pay-status-icon jf-pay-status-icon--success">
                                <i className="fas fa-spinner fa-spin" />
                            </div>
                            <h3>Đang đồng bộ kết quả giao dịch...</h3>
                            <p style={{ color: '#64748b', fontSize: '13.5px' }}>
                                Hệ thống đang kiểm tra chữ ký điện tử với cổng {providerKey}.
                            </p>
                        </div>
                    ) : errorMessage ? (
                        <div className="jf-pay-status-box">
                            <div className="jf-pay-status-icon jf-pay-status-icon--failed">
                                <i className="fas fa-exclamation-triangle" />
                            </div>
                            <h3>Không thể xác nhận giao dịch</h3>
                            <p style={{ color: '#64748b', fontSize: '13.5px' }}>{errorMessage}</p>
                            <div className="jf-pay-actions" style={{ justifyContent: 'center', marginTop: '18px' }}>
                                <Link to="/home" className="jf-pay-btn jf-pay-btn--primary">
                                    Về trang chủ
                                </Link>
                            </div>
                        </div>
                    ) : requireSimAction ? (
                        <>
                            <div className="jf-pay-qr-simulator">
                                <div className="jf-pay-qr-box">
                                    <i className="fas fa-credit-card" />
                                    <span>{providerKey} TRIAL</span>
                                </div>
                                <div>
                                    <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a', marginBottom: '6px' }}>
                                        Nhập thông tin thẻ dùng thử — {providerMeta.name}
                                    </div>
                                    <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
                                        {providerMeta.qrHint}. Hệ thống đã điền sẵn thẻ dùng thử hợp lệ của{' '}
                                        <strong>{providerKey}</strong> — bạn có thể chọn thẻ khác, tự nhập số thẻ hoặc bấm xác nhận thanh toán ngay bên dưới.
                                    </div>
                                </div>
                            </div>

                            {order && (
                                <div className="jf-pay-order-table">
                                    <div className="jf-pay-order-row">
                                        <span>Mã đơn hàng:</span>
                                        <strong>{order.orderCode}</strong>
                                    </div>
                                    <div className="jf-pay-order-row">
                                        <span>Nội dung thanh toán:</span>
                                        <strong>{order.itemName}</strong>
                                    </div>
                                    <div className="jf-pay-order-row">
                                        <span>Phương thức:</span>
                                        <strong>{providerMeta.name}</strong>
                                    </div>
                                    {Number(order.discountVnd || 0) > 0 && (
                                        <div className="jf-pay-order-row">
                                            <span>Ưu đãi ({order.promoCode}):</span>
                                            <strong style={{ color: '#059669' }}>
                                                -{formatVnd(order.discountVnd)}
                                            </strong>
                                        </div>
                                    )}
                                    <div className="jf-pay-order-row jf-pay-order-row--highlight">
                                        <span>Số tiền thanh toán:</span>
                                        <strong>{formatVnd(order.finalAmountVnd)}</strong>
                                    </div>
                                </div>
                            )}

                            <div className="jf-pay-card-form">
                                <div className="jf-pay-card-form__head">
                                    <span className="jf-pay-card-form__title">
                                        <i className="fas fa-university" /> Thẻ nội địa / Quốc tế dùng thử miễn phí
                                    </span>
                                    <div className="jf-pay-card-presets">
                                        {availableTestCards.map((card, idx) => (
                                            <button
                                                key={`${card.cardNumber}-${idx}`}
                                                type="button"
                                                className={`jf-pay-card-preset-btn ${
                                                    cardForm.cardNumber === card.cardNumber ? 'is-active' : ''
                                                }`}
                                                onClick={() => applyPresetCard(card)}
                                            >
                                                {card.type === 'VISA' ? 'Thẻ VISA test' : `Thẻ ATM #${idx + 1}`}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            className={`jf-pay-card-preset-btn jf-pay-card-preset-btn--err ${
                                                cardForm.cardNumber === '9704195798459170488' ? 'is-active' : ''
                                            }`}
                                            onClick={() =>
                                                applyPresetCard({
                                                    bank: 'NCB (Thẻ test không đủ số dư)',
                                                    cardNumber: '9704195798459170488',
                                                    cardHolder: 'NGUYEN VAN A',
                                                    issueDate: '07/15',
                                                    otp: '123456',
                                                })
                                            }
                                        >
                                            Thử thẻ lỗi số dư
                                        </button>
                                    </div>
                                </div>

                                <div className="jf-pay-card-grid">
                                    <div className="jf-pay-card-field jf-pay-card-field--full">
                                        <label htmlFor="jf-sim-bank">Ngân hàng phát hành</label>
                                        <input
                                            id="jf-sim-bank"
                                            type="text"
                                            value={cardForm.bank}
                                            onChange={(e) => setCardForm({ ...cardForm, bank: e.target.value })}
                                            placeholder="VD: NCB / NAPAS / VietinBank"
                                        />
                                    </div>
                                    <div className="jf-pay-card-field jf-pay-card-field--full">
                                        <label htmlFor="jf-sim-card-number">Số thẻ</label>
                                        <input
                                            id="jf-sim-card-number"
                                            type="text"
                                            value={cardForm.cardNumber}
                                            onChange={(e) => {
                                                setCardError('');
                                                setCardForm({ ...cardForm, cardNumber: e.target.value });
                                            }}
                                            placeholder="Nhập số thẻ dùng thử (VD: 9704198526191432198)"
                                        />
                                    </div>
                                    <div className="jf-pay-card-field">
                                        <label htmlFor="jf-sim-holder">Tên chủ thẻ (không dấu)</label>
                                        <input
                                            id="jf-sim-holder"
                                            type="text"
                                            value={cardForm.cardHolder}
                                            onChange={(e) =>
                                                setCardForm({ ...cardForm, cardHolder: e.target.value.toUpperCase() })
                                            }
                                            placeholder="NGUYEN VAN A"
                                        />
                                    </div>
                                    <div className="jf-pay-card-field">
                                        <label htmlFor="jf-sim-date">Ngày phát hành / hết hạn (MM/YY)</label>
                                        <input
                                            id="jf-sim-date"
                                            type="text"
                                            value={cardForm.issueDate}
                                            onChange={(e) => setCardForm({ ...cardForm, issueDate: e.target.value })}
                                            placeholder="07/15"
                                        />
                                    </div>
                                    <div className="jf-pay-card-field jf-pay-card-field--full">
                                        <label htmlFor="jf-sim-otp">Mã xác thực OTP (Sandbox)</label>
                                        <input
                                            id="jf-sim-otp"
                                            type="text"
                                            value={cardForm.otp}
                                            onChange={(e) => {
                                                setCardError('');
                                                setCardForm({ ...cardForm, otp: e.target.value });
                                            }}
                                            placeholder="123456 hoặc 000000"
                                        />
                                    </div>
                                </div>

                                {cardError && (
                                    <div className="jf-pay-card-error">
                                        <i className="fas fa-exclamation-circle" />
                                        <span>{cardError}</span>
                                    </div>
                                )}
                            </div>

                            <div className="jf-pay-actions">
                                <button
                                    type="button"
                                    className="jf-pay-btn jf-pay-btn--danger"
                                    disabled={processingAction}
                                    onClick={() => handleSimulationDecision('cancel')}
                                >
                                    <i className="fas fa-times" />
                                    Hủy giao dịch
                                </button>
                                <button
                                    type="button"
                                    className="jf-pay-btn jf-pay-btn--primary"
                                    disabled={processingAction}
                                    onClick={() => handleSimulationDecision('confirm')}
                                >
                                    <i className="fas fa-check-circle" />
                                    {processingAction
                                        ? 'Đang xử lý...'
                                        : 'Xác nhận thanh toán thành công (Sandbox)'}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="jf-pay-status-box">
                                <div
                                    className={`jf-pay-status-icon ${
                                        isPaid ? 'jf-pay-status-icon--success' : 'jf-pay-status-icon--failed'
                                    }`}
                                >
                                    <i className={`fas ${isPaid ? 'fa-check' : 'fa-times'}`} />
                                </div>
                                <h2 style={{ margin: '0 0 6px', fontSize: '20px', fontWeight: 800 }}>
                                    {isPaid
                                        ? 'Thanh toán thành công!'
                                        : 'Giao dịch chưa hoàn tất hoặc đã bị hủy'}
                                </h2>
                                <p style={{ margin: 0, fontSize: '13.5px', color: '#475569' }}>
                                    {isPaid
                                        ? 'Quyền lợi gói dịch vụ và Điểm thưởng đã được kích hoạt tự động vào tài khoản của bạn.'
                                        : 'Chưa phát sinh trừ tiền hoặc đơn hàng đã được hủy theo yêu cầu.'}
                                </p>
                            </div>

                            {order && (
                                <div className="jf-pay-order-table">
                                    <div className="jf-pay-order-row">
                                        <span>Mã giao dịch:</span>
                                        <strong>{order.orderCode}</strong>
                                    </div>
                                    <div className="jf-pay-order-row">
                                        <span>Gói / Dịch vụ:</span>
                                        <strong>{order.itemName}</strong>
                                    </div>
                                    <div className="jf-pay-order-row">
                                        <span>Cổng thanh toán:</span>
                                        <strong>{order.provider}</strong>
                                    </div>
                                    <div className="jf-pay-order-row">
                                        <span>Trạng thái:</span>
                                        <strong style={{ color: isPaid ? '#059669' : '#dc2626' }}>
                                            {isPaid ? 'ĐÃ THANH TOÁN (PAID)' : order.status}
                                        </strong>
                                    </div>
                                    {isPaid && Number(order.pointsGranted || 0) > 0 && (
                                        <div className="jf-pay-order-row">
                                            <span>Điểm / Top Point cộng thêm:</span>
                                            <strong style={{ color: '#003d9b' }}>
                                                +{order.pointsGranted}{' '}
                                                {order.purpose === 'POINT_TOPUP' ? 'Điểm thưởng Ứng viên' : 'Top Point Nhà tuyển dụng'}
                                            </strong>
                                        </div>
                                    )}
                                    <div className="jf-pay-order-row jf-pay-order-row--highlight">
                                        <span>Tổng thanh toán:</span>
                                        <strong>{formatVnd(order.finalAmountVnd)}</strong>
                                    </div>
                                </div>
                            )}

                            <div className="jf-pay-actions">
                                {postId && (
                                    <Link
                                        to={`/detail-job/${postId}`}
                                        className="jf-pay-btn jf-pay-btn--primary"
                                    >
                                        <i className="fas fa-chart-pie" />
                                        Quay lại Tin tuyển dụng &amp; Xem Báo cáo
                                    </Link>
                                )}
                                {order?.purpose === 'PACKAGE_POST' && (
                                    <>
                                        <Link
                                            to="/admin/rewards"
                                            className="jf-pay-btn jf-pay-btn--secondary"
                                        >
                                            <i className="fas fa-gift" />
                                            Đổi quà Top Point
                                        </Link>
                                        <Link
                                            to="/admin/add-post"
                                            className="jf-pay-btn jf-pay-btn--primary"
                                        >
                                            <i className="fas fa-arrow-left" />
                                            Quay lại Quản lý Gói đăng bài
                                        </Link>
                                    </>
                                )}
                                {order?.purpose === 'PACKAGE_CV' && (
                                    <>
                                        <Link
                                            to="/admin/rewards"
                                            className="jf-pay-btn jf-pay-btn--secondary"
                                        >
                                            <i className="fas fa-gift" />
                                            Đổi quà Top Point
                                        </Link>
                                        <Link
                                            to="/admin/buy-cv"
                                            className="jf-pay-btn jf-pay-btn--primary"
                                        >
                                            <i className="fas fa-arrow-left" />
                                            Quay lại Mua lượt tìm ứng viên
                                        </Link>
                                    </>
                                )}
                                <Link to="/home" className="jf-pay-btn jf-pay-btn--secondary">
                                    Về trang chủ
                                </Link>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PaymentResultPage;
