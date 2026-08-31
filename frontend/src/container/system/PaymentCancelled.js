import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const PaymentCancelled = ({ storageKey, buyPath, packageLabel }) => {
    const navigate = useNavigate();

    useEffect(() => {
        localStorage.removeItem(storageKey);
    }, [storageKey]);

    return (
        <div style={{ minHeight: "50vh", textAlign: "center", paddingTop: "48px" }}>
            <h4>Thanh toán đã được hủy</h4>
            <p className="text-muted mt-3" role="status">
                Bạn chưa bị ghi nhận giao dịch. Có thể quay lại chọn {packageLabel} khi sẵn sàng.
            </p>
            <button
                type="button"
                className="btn1 btn1-primary1 mt-4"
                onClick={() => navigate(buyPath)}
            >
                Quay lại mua gói
            </button>
        </div>
    );
};

export default PaymentCancelled;

