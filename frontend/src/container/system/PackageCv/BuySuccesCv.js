import React, { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { paymentOrderSuccessServiceCv } from "../../../service/userService";
import { useLocation, useNavigate } from "react-router-dom";
import { readJsonStorage } from "../../../util/storage";

function useQuery() {
    const { search } = useLocation();

    return React.useMemo(() => new URLSearchParams(search), [search]);
}

function PaymentSuccessCv() {
    const query = useQuery();
    const navigate = useNavigate();
    const hasStarted = useRef(false);
    const [status, setStatus] = useState("processing");
    const [message, setMessage] = useState("Đang xử lý thanh toán...");

    useEffect(() => {
        if (hasStarted.current) return;
        hasStarted.current = true;

        // Backend la nguon su that cua don hang; storage co the bi xoa khi
        // nguoi dung doi tab/trinh duyet trong luc quay lai tu PayPal.
        readJsonStorage("orderCvData");
        const paymentId = query.get("paymentId");
        const token = query.get("token");
        const PayerID = query.get("PayerID");

        if (!paymentId || !token || !PayerID) {
            setStatus("invalid");
            setMessage("Phản hồi thanh toán không đầy đủ. Không có thay đổi nào được ghi nhận.");
            return;
        }

        const createNewOrder = async () => {
            try {
                const res = await paymentOrderSuccessServiceCv({
                    paymentId,
                    token,
                    PayerID,
                });
                if (res?.errCode === 0) {
                    toast.success(res.errMessage || "Thanh toán thành công");
                    localStorage.removeItem("orderCvData");
                    setStatus("success");
                    setMessage("Chúc mừng bạn đã mua lượt tìm ứng viên thành công");
                    return;
                }

                const errorMessage = res?.errMessage || "Không thể xác nhận thanh toán";
                toast.error(errorMessage);
                setStatus("error");
                setMessage(`${errorMessage}. Vui lòng kiểm tra lịch sử giao dịch.`);
            } catch (error) {
                const errorMessage =
                    error?.response?.data?.errMessage ||
                    "Không thể kết nối để xác nhận thanh toán";
                toast.error(errorMessage);
                setStatus("error");
                setMessage(`${errorMessage}. Vui lòng kiểm tra lịch sử giao dịch.`);
            }
        };

        createNewOrder();
    }, [query]);

    return (
        <div style={{ minHeight: "50vh", textAlign: "center", paddingTop: "48px" }}>
            <p role={status === "processing" || status === "success" ? "status" : "alert"}>
                {message}
            </p>
            {status === "success" && (
                <div className="mt-5">
                    <button
                        type="button"
                        onClick={() => navigate("/admin/list-candiate")}
                        style={{ backgroundColor: "green" }}
                    >
                        Tìm ứng viên ngay
                    </button>
                </div>
            )}
            {status === "invalid" && (
                <button type="button" className="btn1 btn1-primary1 mt-4" onClick={() => navigate("/admin/buy-cv")}>
                    Quay lại mua gói
                </button>
            )}
            {status === "error" && (
                <button type="button" className="btn1 btn1-primary1 mt-4" onClick={() => navigate("/admin/history-cv")}>
                    Xem lịch sử giao dịch
                </button>
            )}
        </div>
    );
}

export default PaymentSuccessCv;
