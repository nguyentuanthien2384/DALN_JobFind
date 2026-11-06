import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
    notifyRewardWalletUpdated,
    verifyPaymentReturnService,
} from '../../service/rewardPaymentService';
import './PaymentResultPage.css';

const formatVnd = (value) => `${Number(value || 0).toLocaleString('vi-VN')} VNĐ`;

const PROVIDER_META = {
    VNPAY: {
        name: 'Cổng thanh toán VNPAY-QR',
        bannerClass: 'jf-pay-result-banner--vnpay',
        qrHint: 'Quét mã VNPAY-QR bằng ứng dụng Mobile Banking hoặc Ví VNPAY',
    },
    MOMO: {
        name: 'Ví điện tử MoMo',
        bannerClass: 'jf-pay-result-banner--momo',
        qrHint: 'Mở siêu ứng dụng MoMo trên điện thoại để xác nhận thanh toán',
    },
    ZALOPAY: {
        name: 'Ví điện tử ZaloPay',
        bannerClass: 'jf-pay-result-banner--zalopay',
        qrHint: 'Quét mã QR qua ứng dụng Zalo hoặc ZaloPay để thanh toán tức thì',
    },
    PAYPAL: {
        name: 'Cổng thanh toán quốc tế PayPal',
        bannerClass: 'jf-pay-result-banner--paypal',
        qrHint: 'Xác thực thanh toán an toàn qua tài khoản PayPal hoặc thẻ Visa/Mastercard',
    },
};

const PaymentResultPage = () => {
    const location = useLocation();
    const [loading, setLoading] = useState(true);
    const [processingAction, setProcessingAction] = useState(false);
    const [resultData, setResultData] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');

    const queryObject = useMemo(() => {
        const params = new URLSearchParams(location.search || '');
        const obj = {};
        params.forEach((value, key) => {
            obj[key] = value;
        });
        return obj;
    }, [location.search]);

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
                    if (res.data.paid) {
                        notifyRewardWalletUpdated({ order: res.data.order });
                    }
                } else {
                    setErrorMessage(res?.errMessage || 'Không tìm thấy thông tin đơn thanh toán.');
                }
            } catch (_err) {
                setErrorMessage('Không thể xác thực trạng thái giao dịch. Vui lòng thử lại.');
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
        await verifyPayment({ simulateAction: action });
        if (action === 'confirm') {
            toast.success('Thanh toán thành công! Điểm/lượt dịch vụ đã được cộng vào tài khoản.');
        } else {
            toast.info('Đã hủy giao dịch thanh toán.');
        }
    };

    const order = resultData?.order || null;
    const providerKey = String(order?.provider || queryObject.provider || 'VNPAY').toUpperCase();
    const providerMeta = PROVIDER_META[providerKey] || PROVIDER_META.VNPAY;
    const requireSimAction = Boolean(resultData?.requireSimulationAction);
    const isPaid = Boolean(resultData?.paid || order?.status === 'PAID');
    const postId = order?.metadata?.postId || null;

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
                                    <i className="fas fa-qrcode" />
                                    <span>{providerKey} SANDBOX</span>
                                </div>
                                <div>
                                    <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a', marginBottom: '6px' }}>
                                        Xác nhận thanh toán qua {providerMeta.name}
                                    </div>
                                    <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
                                        {providerMeta.qrHint}. Trong môi trường phát triển (Sandbox), bấm{' '}
                                        <strong>&ldquo;Xác nhận thanh toán thành công&rdquo;</strong> bên dưới để hoàn tất giao dịch và cộng điểm/gói dịch vụ ngay lập tức.
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
                                        : 'Chưa phát sinh扣 tiền hoặc đơn hàng đã được hủy theo yêu cầu.'}
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
