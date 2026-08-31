import React, { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { paymentOrderSuccessService } from "../../../service/userService";
import { useLocation, useNavigate } from "react-router-dom";
import { readJsonStorage } from "../../../util/storage";

function useQuery() {
    const { search } = useLocation();

    return React.useMemo(() => new URLSearchParams(search), [search]);
}

function PaymentSuccess() {
    const query = useQuery();
    const navigate = useNavigate();
    const hasStarted = useRef(false);
    const [status, setStatus] = useState("processing");
    const [message, setMessage] = useState("Đang xử lý thanh toán...");

    useEffect(() => {
        if (hasStarted.current) return;
        hasStarted.current = true;

        // Don hang duoc rang buoc va doi soat o backend. Local storage chi la
        // du lieu tam cho UX, khong phai dieu kien de xac nhan mot giao dich da tra.
        readJsonStorage("orderData");
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
                const res = await paymentOrderSuccessService({
                    paymentId,
                    token,
                    PayerID,
                });
                if (res?.errCode === 0) {
                    toast.success(res.errMessage || "Thanh toán thành công");
                    localStorage.removeItem("orderData");
                    setStatus("success");
                    setMessage("Chúc mừng bạn đã mua lượt đăng bài thành công");
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
                        onClick={() => navigate("/admin/add-post")}
                        style={{ backgroundColor: "green" }}
                    >
                        Đăng bài ngay
                    </button>
                </div>
            )}
            {status === "invalid" && (
                <button type="button" className="btn1 btn1-primary1 mt-4" onClick={() => navigate("/admin/buy-post")}>
                    Quay lại mua gói
                </button>
            )}
            {status === "error" && (
                <button type="button" className="btn1 btn1-primary1 mt-4" onClick={() => navigate("/admin/history-post")}>
                    Xem lịch sử giao dịch
                </button>
            )}
        </div>
    );
}

export default PaymentSuccess;
