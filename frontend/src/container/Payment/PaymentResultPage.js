import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
    notifyRewardWalletUpdated,
    verifyPaymentReturnService,
} from '../../service/rewardPaymentService';
import { readJsonStorage } from '../../util/storage';
import './PaymentResultPage.css';

const formatVnd = (value) => `${Number(value || 0).toLocaleString('vi-VN')} VNĐ`;

const PROVIDER_META = {
    VNPAY: {
        name: 'Cổng thanh toán VNPAY',
        bannerClass: 'jf-pay-result-banner--vnpay',
    },
    MOMO: {
        name: 'Ví điện tử MoMo',
        bannerClass: 'jf-pay-result-banner--momo',
    },
    ZALOPAY: {
        name: 'Ví điện tử ZaloPay',
        bannerClass: 'jf-pay-result-banner--zalopay',
    },
    PAYPAL: {
        name: 'PayPal / Thẻ Quốc Tế',
        bannerClass: 'jf-pay-result-banner--paypal',
    },
};

const BANK_OPTIONS = [
    'Vietcombank (Ngân hàng Ngoại thương VN)',
    'VietinBank (Ngân hàng Công thương VN)',
    'BIDV (Ngân hàng Đầu tư và Phát triển VN)',
    'Agribank (Ngân hàng NN & PTNT)',
    'Techcombank (Ngân hàng Kỹ thương VN)',
    'MBBank (Ngân hàng Quân Đội)',
    'ACB (Ngân hàng Á Châu)',
    'Sacombank (Ngân hàng Sài Gòn Thương Tín)',
    'VPBank (Ngân hàng Việt Nam Thịnh Vượng)',
    'TPBank (Ngân hàng Tiên Phong)',
    'NCB (Ngân hàng Quốc Dân)',
    'Thẻ Quốc tế VISA / MasterCard / JCB',
];

const detectProviderFromQuery = (queryObject = {}) => {
    if (queryObject.provider) return String(queryObject.provider).toUpperCase();
    if (queryObject.vnp_TxnRef || queryObject.vnp_SecureHash) return 'VNPAY';
    if (queryObject.apptransid || queryObject.appid) return 'ZALOPAY';
    if (queryObject.partnerCode || queryObject.resultCode !== undefined) return 'MOMO';
    if (queryObject.PayerID || queryObject.payerId || queryObject.paymentId) return 'PAYPAL';
    return 'VNPAY';
};

const maskCardNumber = (raw) => {
    const digits = String(raw || '').replace(/[\s-]+/g, '');
    if (digits.length < 8) return digits;
    return `${digits.slice(0, 4)} **** **** ${digits.slice(-4)}`;
};

const PaymentResultPage = () => {
    const location = useLocation();
    const [loading, setLoading] = useState(true);
    const [processingAction, setProcessingAction] = useState(false);
    const [resultData, setResultData] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [cardError, setCardError] = useState('');
    const [gatewayStep, setGatewayStep] = useState('card');
    const [cardForm, setCardForm] = useState({
        bank: '',
        cardNumber: '',
        cardHolder: '',
        issueDate: '',
        otp: '',
    });

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

    const verifyPayment = useCallback(
        async (extraParams = {}) => {
            const activeUser = readJsonStorage('userData');
            if (!activeUser?.id) {
                setErrorMessage('Vui lòng đăng nhập tài khoản đã khởi tạo giao dịch để xác thực thanh toán.');
                setLoading(false);
                setProcessingAction(false);
                return { ok: false, unauthenticated: true };
            }
            if (activeUser.roleCode && activeUser.roleCode !== 'CANDIDATE' && activeUser.roleCode !== 'COMPANY') {
                setErrorMessage('Tài khoản hiện tại không có quyền thực hiện giao dịch thanh toán dịch vụ.');
                setLoading(false);
                setProcessingAction(false);
                return { ok: false, forbidden: true };
            }
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
                    setCardError(res.errMessage || 'Thông tin thẻ hoặc mã OTP chưa hợp lệ.');
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

    const handleProceedToOtp = (event) => {
        if (event) event.preventDefault();
        setCardError('');
        if (!cardForm.bank.trim()) {
            setCardError('Vui lòng chọn ngân hàng hoặc loại thẻ thanh toán.');
            return;
        }
        const digits = String(cardForm.cardNumber || '').replace(/[\s-]+/g, '');
        if (!/^\d{15,19}$/.test(digits) || !/^(9704|4|5|35)/.test(digits)) {
            setCardError(
                'Số thẻ không hợp lệ. Vui lòng nhập thẻ ATM nội địa (9704...) hoặc thẻ quốc tế Visa/MasterCard/JCB (15 - 19 chữ số).'
            );
            return;
        }
        if (cardForm.cardHolder.trim().length < 3) {
            setCardError('Vui lòng nhập họ tên chủ thẻ (không dấu).');
            return;
        }
        if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(cardForm.issueDate.trim())) {
            setCardError('Vui lòng nhập ngày phát hành / hết hạn đúng định dạng MM/YY (VD: 08/27).');
            return;
        }
        setGatewayStep('otp');
    };

    const handleConfirmPayment = async (event) => {
        if (event) event.preventDefault();
        setCardError('');
        const rawOtp = String(cardForm.otp || '').trim();
        if (rawOtp.length < 4) {
            setCardError('Vui lòng nhập mã xác thực OTP (từ 4 - 6 chữ số).');
            return;
        }
        setProcessingAction(true);
        const digits = String(cardForm.cardNumber || '').replace(/[\s-]+/g, '');
        const outcome = await verifyPayment({
            simulateAction: 'confirm',
            simulateCardNumber: digits,
            simulateCardHolder: cardForm.cardHolder.trim(),
            simulateIssueDate: cardForm.issueDate.trim(),
            simulateOtp: rawOtp,
        });
        if (outcome?.paid) {
            toast.success('Thanh toán thành công! Quyền lợi đã được cập nhật vào tài khoản.');
        } else if (outcome?.cardInvalid) {
            toast.error(outcome.res?.errMessage || 'Không thể xác thực giao dịch thanh toán.');
        }
    };

    const handleCancelPayment = async () => {
        setProcessingAction(true);
        setCardError('');
        await verifyPayment({ simulateAction: 'cancel' });
        toast.info('Đã hủy giao dịch thanh toán.');
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
                                ? 'Xác thực thông tin thẻ và thanh toán đơn hàng'
                                : 'Thông tin kết quả giao dịch thanh toán'}
                        </p>
                    </div>
                    <span className="jf-pay-result-banner__badge">{providerKey}</span>
                </div>

                <div className="jf-pay-result-body">
                    {loading ? (
                        <div className="jf-pay-status-box">
                            <div className="jf-pay-status-icon jf-pay-status-icon--pending">
                                <i className="fas fa-spinner fa-spin" />
                            </div>
                            <h3>Đang kiểm tra thông tin đơn hàng...</h3>
                            <p className="jf-pay-status-sub">
                                Vui lòng đợi trong giây lát, hệ thống đang kết nối cổng {providerKey}.
                            </p>
                        </div>
                    ) : errorMessage ? (
                        <div className="jf-pay-status-box">
                            <div className="jf-pay-status-icon jf-pay-status-icon--failed">
                                <i className="fas fa-exclamation-triangle" />
                            </div>
                            <h3>Không thể xác nhận giao dịch</h3>
                            <p className="jf-pay-status-sub">{errorMessage}</p>
                            <div className="jf-pay-actions" style={{ justifyContent: 'center', marginTop: '18px' }}>
                                {!readJsonStorage('userData')?.id && (
                                    <Link
                                        to="/login"
                                        className="jf-pay-btn jf-pay-btn--primary"
                                        onClick={() => {
                                            localStorage.setItem('lastUrl', `${location.pathname}${location.search || ''}`);
                                        }}
                                    >
                                        Đăng nhập
                                    </Link>
                                )}
                                <Link
                                    to="/"
                                    className={`jf-pay-btn ${readJsonStorage('userData')?.id ? 'jf-pay-btn--primary' : 'jf-pay-btn--secondary'}`}
                                >
                                    Về trang chủ
                                </Link>
                            </div>
                        </div>
                    ) : requireSimAction ? (
                        <>
                            <div className="jf-pay-stepper" aria-label="Các bước thanh toán">
                                <div
                                    className={`jf-pay-step ${
                                        gatewayStep === 'card' ? 'is-active' : 'is-done'
                                    }`}
                                >
                                    <span className="jf-pay-step__num">1</span>
                                    <span>Nhập thông tin thẻ</span>
                                </div>
                                <span className="jf-pay-step__divider">&rarr;</span>
                                <div
                                    className={`jf-pay-step ${
                                        gatewayStep === 'otp' ? 'is-active' : ''
                                    }`}
                                >
                                    <span className="jf-pay-step__num">2</span>
                                    <span>Xác thực OTP</span>
                                </div>
                                <span className="jf-pay-step__divider">&rarr;</span>
                                <div className="jf-pay-step">
                                    <span className="jf-pay-step__num">3</span>
                                    <span>Hoàn tất</span>
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
                                            <span>Giảm giá ({order.promoCode}):</span>
                                            <strong style={{ color: '#15803d' }}>
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

                            {gatewayStep === 'card' ? (
                                <form onSubmit={handleProceedToOtp} noValidate>
                                    <div className="jf-pay-card-form">
                                        <div className="jf-pay-card-form__head">
                                            <span className="jf-pay-card-form__title">
                                                Thông tin thẻ thanh toán
                                            </span>
                                        </div>

                                        <div className="jf-pay-card-grid">
                                            <div className="jf-pay-card-field jf-pay-card-field--full">
                                                <label htmlFor="jf-sim-bank">Ngân hàng / Loại thẻ</label>
                                                <select
                                                    id="jf-sim-bank"
                                                    value={cardForm.bank}
                                                    onChange={(e) => {
                                                        setCardError('');
                                                        setCardForm({ ...cardForm, bank: e.target.value });
                                                    }}
                                                >
                                                    <option value="">-- Chọn ngân hàng hoặc loại thẻ --</option>
                                                    {BANK_OPTIONS.map((bankName) => (
                                                        <option key={bankName} value={bankName}>
                                                            {bankName}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="jf-pay-card-field jf-pay-card-field--full">
                                                <label htmlFor="jf-sim-card-number">Số thẻ</label>
                                                <input
                                                    id="jf-sim-card-number"
                                                    type="text"
                                                    inputMode="numeric"
                                                    autoComplete="off"
                                                    value={cardForm.cardNumber}
                                                    onChange={(e) => {
                                                        setCardError('');
                                                        setCardForm({ ...cardForm, cardNumber: e.target.value });
                                                    }}
                                                    placeholder="Nhập 16 - 19 chữ số in trên mặt thẻ"
                                                />
                                            </div>

                                            <div className="jf-pay-card-field">
                                                <label htmlFor="jf-sim-holder">Tên chủ thẻ (không dấu)</label>
                                                <input
                                                    id="jf-sim-holder"
                                                    type="text"
                                                    autoComplete="off"
                                                    value={cardForm.cardHolder}
                                                    onChange={(e) => {
                                                        setCardError('');
                                                        setCardForm({
                                                            ...cardForm,
                                                            cardHolder: e.target.value.toUpperCase(),
                                                        });
                                                    }}
                                                    placeholder="VD: NGUYEN VAN A"
                                                />
                                            </div>

                                            <div className="jf-pay-card-field">
                                                <label htmlFor="jf-sim-date">Ngày phát hành / hết hạn (MM/YY)</label>
                                                <input
                                                    id="jf-sim-date"
                                                    type="text"
                                                    autoComplete="off"
                                                    maxLength={5}
                                                    value={cardForm.issueDate}
                                                    onChange={(e) => {
                                                        setCardError('');
                                                        setCardForm({ ...cardForm, issueDate: e.target.value });
                                                    }}
                                                    placeholder="MM/YY"
                                                />
                                            </div>
                                        </div>

                                        {cardError && (
                                            <div className="jf-pay-card-error" role="alert">
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
                                            onClick={handleCancelPayment}
                                        >
                                            Hủy giao dịch
                                        </button>
                                        <button
                                            type="submit"
                                            className="jf-pay-btn jf-pay-btn--primary"
                                            disabled={processingAction}
                                        >
                                            Tiếp tục
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <form onSubmit={handleConfirmPayment} noValidate>
                                    <div className="jf-pay-card-form">
                                        <div className="jf-pay-card-form__head">
                                            <span className="jf-pay-card-form__title">
                                                Xác nhận thông tin thẻ &amp; nhập mã OTP
                                            </span>
                                        </div>

                                        <div className="jf-pay-card-review">
                                            <div className="jf-pay-order-row">
                                                <span>Ngân hàng / Loại thẻ:</span>
                                                <strong>{cardForm.bank}</strong>
                                            </div>
                                            <div className="jf-pay-order-row">
                                                <span>Số thẻ thanh toán:</span>
                                                <strong>{maskCardNumber(cardForm.cardNumber)}</strong>
                                            </div>
                                            <div className="jf-pay-order-row">
                                                <span>Tên chủ thẻ:</span>
                                                <strong>{cardForm.cardHolder}</strong>
                                            </div>
                                            <div className="jf-pay-order-row">
                                                <span>Ngày thẻ (MM/YY):</span>
                                                <strong>{cardForm.issueDate}</strong>
                                            </div>
                                        </div>

                                        <div className="jf-pay-card-field jf-pay-card-field--full">
                                            <label htmlFor="jf-sim-otp">Mã xác thực OTP</label>
                                            <input
                                                id="jf-sim-otp"
                                                type="text"
                                                inputMode="numeric"
                                                autoComplete="one-time-code"
                                                maxLength={8}
                                                value={cardForm.otp}
                                                onChange={(e) => {
                                                    setCardError('');
                                                    setCardForm({ ...cardForm, otp: e.target.value });
                                                }}
                                                placeholder="Nhập mã OTP xác thực giao dịch"
                                            />
                                            <small className="jf-pay-otp-note">
                                                Nhập mã xác thực OTP gửi tới số điện thoại đăng ký thẻ để xác nhận trừ tiền.
                                            </small>
                                        </div>

                                        {cardError && (
                                            <div className="jf-pay-card-error" role="alert">
                                                <i className="fas fa-exclamation-circle" />
                                                <span>{cardError}</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="jf-pay-actions">
                                        <button
                                            type="button"
                                            className="jf-pay-btn jf-pay-btn--secondary"
                                            disabled={processingAction}
                                            onClick={() => {
                                                setCardError('');
                                                setGatewayStep('card');
                                            }}
                                        >
                                            Quay lại sửa thẻ
                                        </button>
                                        <button
                                            type="button"
                                            className="jf-pay-btn jf-pay-btn--danger"
                                            disabled={processingAction}
                                            onClick={handleCancelPayment}
                                        >
                                            Hủy giao dịch
                                        </button>
                                        <button
                                            type="submit"
                                            className="jf-pay-btn jf-pay-btn--primary"
                                            disabled={processingAction}
                                        >
                                            {processingAction ? 'Đang xử lý...' : 'Xác nhận thanh toán'}
                                        </button>
                                    </div>
                                </form>
                            )}
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
                                <h2 className="jf-pay-status-title">
                                    {isPaid
                                        ? 'Thanh toán thành công!'
                                        : 'Giao dịch chưa hoàn tất hoặc đã bị hủy'}
                                </h2>
                                <p className="jf-pay-status-sub">
                                    {isPaid
                                        ? 'Quyền lợi gói dịch vụ và điểm tài khoản đã được cập nhật.'
                                        : 'Đơn hàng đã được hủy theo yêu cầu và chưa phát sinh trừ tiền.'}
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
                                        <strong style={{ color: isPaid ? '#15803d' : '#dc2626' }}>
                                            {isPaid ? 'Đã thanh toán' : 'Đã hủy'}
                                        </strong>
                                    </div>
                                    {isPaid && Number(order.pointsGranted || 0) > 0 && (
                                        <div className="jf-pay-order-row">
                                            <span>Điểm cộng thêm:</span>
                                            <strong style={{ color: '#252b60' }}>
                                                +{order.pointsGranted}{' '}
                                                {order.purpose === 'POINT_TOPUP' ? 'điểm' : 'Top Point'}
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
                                {postId && (!order?.purpose || order.purpose === 'POINT_TOPUP') && (
                                    <Link
                                        to={`/detail-job/${postId}`}
                                        className="jf-pay-btn jf-pay-btn--primary"
                                    >
                                        Quay lại Tin tuyển dụng &amp; Xem Báo cáo
                                    </Link>
                                )}
                                {!postId && order?.purpose === 'POINT_TOPUP' && (
                                    <Link
                                        to="/job"
                                        className="jf-pay-btn jf-pay-btn--primary"
                                    >
                                        Tìm việc làm ngay
                                    </Link>
                                )}
                                {order?.purpose === 'PACKAGE_POST' && (
                                    <>
                                        <Link
                                            to="/admin/rewards"
                                            className="jf-pay-btn jf-pay-btn--secondary"
                                        >
                                            Đổi quà Top Point
                                        </Link>
                                        <Link
                                            to={isPaid ? '/admin/add-post' : '/admin/buy-post'}
                                            className="jf-pay-btn jf-pay-btn--primary"
                                        >
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
                                            Đổi quà Top Point
                                        </Link>
                                        <Link
                                            to="/admin/buy-cv"
                                            className="jf-pay-btn jf-pay-btn--primary"
                                        >
                                            Quay lại Mua lượt tìm ứng viên
                                        </Link>
                                    </>
                                )}
                                <Link to="/" className="jf-pay-btn jf-pay-btn--secondary">
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
