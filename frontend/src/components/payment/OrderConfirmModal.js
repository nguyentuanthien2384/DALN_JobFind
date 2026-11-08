import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import './PointTopupModal.css';

const OrderConfirmModal = ({
    isOpen,
    title = 'Xác nhận thông tin thanh toán',
    rows = [],
    totalLabel = 'Tổng thanh toán',
    totalValue = '',
    subTotalNote = '',
    isSubmitting = false,
    onCancel,
    onConfirm,
}) => {
    useEffect(() => {
        if (!isOpen) return undefined;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && !isSubmitting && onCancel) {
                onCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, isSubmitting, onCancel]);

    if (!isOpen) return null;

    const modalNode = (
        <div
            className="jf-topup-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => {
                if (e.target === e.currentTarget && !isSubmitting && onCancel) {
                    onCancel();
                }
            }}
        >
            <div className="jf-topup-modal jf-confirm-modal">
                <div className="jf-topup-header">
                    <div>
                        <h2 className="jf-topup-header__title">{title}</h2>
                        <p className="jf-topup-header__subtitle">
                            Vui lòng kiểm tra kỹ thông tin đơn hàng trước khi chuyển sang bước thanh toán
                        </p>
                    </div>
                    <button
                        type="button"
                        className="jf-topup-close-btn"
                        aria-label="Đóng cửa sổ xác nhận"
                        disabled={isSubmitting}
                        onClick={onCancel}
                    >
                        &times;
                    </button>
                </div>

                <div className="jf-topup-body">
                    <div className="jf-topup-confirm-box">
                        {rows.map((row) => (
                            <div key={row.label} className="jf-topup-confirm-row">
                                <span>{row.label}</span>
                                <strong>{row.value}</strong>
                            </div>
                        ))}
                        <div className="jf-topup-confirm-row jf-topup-confirm-row--total">
                            <span>{totalLabel}</span>
                            <strong>{totalValue}</strong>
                        </div>
                        {subTotalNote && (
                            <div className="jf-topup-confirm-subnote">{subTotalNote}</div>
                        )}
                    </div>

                    <p className="jf-topup-confirm-hint">
                        Ở bước tiếp theo, bạn sẽ tự nhập thông tin thẻ ngân hàng và xác thực mã OTP trên cổng thanh toán để hoàn tất giao dịch.
                    </p>
                </div>

                <div className="jf-topup-footer">
                    <button
                        type="button"
                        className="jf-topup-btn jf-topup-btn--secondary"
                        disabled={isSubmitting}
                        onClick={onCancel}
                    >
                        Quay lại
                    </button>
                    <button
                        type="button"
                        className="jf-topup-btn jf-topup-btn--primary"
                        disabled={isSubmitting}
                        onClick={onConfirm}
                    >
                        {isSubmitting ? 'Đang xử lý...' : 'Xác nhận thanh toán'}
                    </button>
                </div>
            </div>
        </div>
    );

    if (typeof document !== 'undefined' && document.body) {
        return ReactDOM.createPortal(modalNode, document.body);
    }
    return modalNode;
};

export default React.memo(OrderConfirmModal);
