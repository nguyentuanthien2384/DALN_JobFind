import React, { useEffect, useState } from "react";
import { getPaymentLinkCv, getAllToSelect } from "../../../service/userService";
import { createPaymentCheckoutService } from "../../../service/rewardPaymentService";
import { toast } from "react-toastify";
import { Spinner, Modal } from "reactstrap";
import { readJsonStorage } from "../../../util/storage";
import EmployerRewardsSection from "../Rewards/EmployerRewardsSection";

const GATEWAY_CHOICES = [
    { code: "PAYPAL", label: "PayPal / Thẻ Quốc Tế (USD)" },
    { code: "VNPAY", label: "VNPAY-QR / Ngân hàng nội địa (VNĐ)" },
    { code: "MOMO", label: "Ví điện tử MoMo (VNĐ)" },
    { code: "ZALOPAY", label: "Ví điện tử ZaloPay (VNĐ)" },
];

const BuyCv = () => {
    const [inputValues, setInputValues] = useState({
        amount: 1,
        packageCvId: "",
    });
    const [selectedGateway, setSelectedGateway] = useState("PAYPAL");
    const [promoCode, setPromoCode] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [dataPackage, setDataPackage] = useState([]);
    const [isPackageLoading, setIsPackageLoading] = useState(true);
    const [packageError, setPackageError] = useState("");
    const [price, setPrice] = useState(0);
    const amountValue = Number(inputValues.amount);
    const total = Number.isFinite(amountValue) && amountValue > 0 ? amountValue * price : 0;
    const totalVnd = total <= 1000 ? total * 24000 : total;
    const estimatedTopPoints = totalVnd > 0 ? Math.max(1, Math.round(totalVnd / 100000)) : 0;

    const handleOnChangePackage = (event) => {
        const { value } = event.target;
        let item = dataPackage.find((item) => String(item.id) === value);
        if (!item) return;
        setPrice(item.price);
        setInputValues({
            ...inputValues,
            packageCvId: item.id,
        });
    };
    const handleOnChangeAmount = (event) => {
        const { value } = event.target;
        setInputValues({
            ...inputValues,
            amount: value,
        });
    };

    const handleBuy = async () => {
        if (!inputValues.packageCvId) {
            toast.error("Hiện chưa có gói tìm ứng viên phù hợp");
            return;
        }
        const amount = Number(inputValues.amount);
        if (!Number.isInteger(amount) || amount < 1) {
            toast.error("Số lượng phải là số nguyên lớn hơn 0");
            return;
        }
        const userData = readJsonStorage("userData");
        if (!userData?.id) {
            toast.error("Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại");
            return;
        }
        setIsLoading(true);
        try {
            if (selectedGateway === "PAYPAL" && !promoCode.trim()) {
                const res = await getPaymentLinkCv(inputValues.packageCvId, amount);
                if (res?.errCode === 0 && res.link) {
                    const data = {
                        packageCvId: inputValues.packageCvId,
                        amount,
                        userId: userData.id,
                    };
                    localStorage.setItem("orderCvData", JSON.stringify(data));
                    window.location.href = res.link;
                    return;
                }
                toast.error(res?.errMessage || "Không thể tạo liên kết thanh toán");
                return;
            }

            const checkoutRes = await createPaymentCheckoutService({
                purpose: "PACKAGE_CV",
                itemCode: inputValues.packageCvId,
                quantity: amount,
                provider: selectedGateway,
                promoCode: promoCode.trim(),
                returnUrl: `${window.location.origin}/payment/result`,
            });
            if (checkoutRes?.errCode === 0 && checkoutRes.data?.paymentUrl) {
                window.location.href = checkoutRes.data.paymentUrl;
                return;
            }
            toast.error(checkoutRes?.errMessage || "Không thể tạo liên kết thanh toán");
        } catch (error) {
            toast.error(
                error?.response?.data?.errMessage ||
                    "Không thể kết nối cổng thanh toán. Vui lòng thử lại"
            );
        } finally {
            setIsLoading(false);
        }
    };
    const fetchPackagePost = async () => {
        setIsPackageLoading(true);
        setPackageError("");
        try {
            const res = await getAllToSelect();
            if (!res || res.errCode !== 0) {
                setPackageError(res?.errMessage || "Không thể tải danh sách gói tìm ứng viên");
                return;
            }
            const packages = Array.isArray(res.data) ? res.data : [];
            const firstPackage = packages[0];
            setDataPackage(packages);
            setInputValues((current) => ({
                ...current,
                packageCvId: firstPackage?.id || "",
            }));
            setPrice(firstPackage?.price || 0);
        } catch (_error) {
            setDataPackage([]);
            setInputValues((current) => ({ ...current, packageCvId: "" }));
            setPrice(0);
            setPackageError("Không thể tải danh sách gói tìm ứng viên. Vui lòng thử lại");
        } finally {
            setIsPackageLoading(false);
        }
    };
    useEffect(() => {
        fetchPackagePost();
    }, []);
    return (
        <div className="">
            <div className="col-12 grid-margin">
                <div className="card">
                    <div className="card-body">
                        <h4 className="card-title">Mua lượt tìm ứng viên</h4>
                        <br></br>
                        <form className="form-sample">
                            <div className="row">
                                <div className="col-md-8">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Các gói tìm ứng viên
                                        </label>
                                        <div className="col-sm-9">
                                            <select
                                                style={{ color: "black" }}
                                                className="form-control"
                                                name="addressCode"
                                                value={inputValues.packageCvId}
                                                onChange={(event) =>
                                                    handleOnChangePackage(event)
                                                }
                                                disabled={isPackageLoading || !!packageError || dataPackage.length === 0}
                                            >
                                                {dataPackage &&
                                                    dataPackage.length > 0 &&
                                                    dataPackage.map(
                                                        (item, index) => {
                                                            return (
                                                                <option
                                                                    key={index}
                                                                    value={
                                                                        item.id
                                                                    }
                                                                >
                                                                    {item.name}
                                                                </option>
                                                            );
                                                        }
                                                    )}
                                            </select>
                                            {isPackageLoading && (
                                                <p className="mt-2 text-muted" role="status">
                                                    Đang tải danh sách gói...
                                                </p>
                                            )}
                                            {!isPackageLoading && packageError && (
                                                <p className="mt-2 text-danger" role="alert">
                                                    {packageError}
                                                </p>
                                            )}
                                            {!isPackageLoading && !packageError && dataPackage.length === 0 && (
                                                <p className="mt-2 text-muted" role="status">
                                                    Hiện chưa có gói tìm ứng viên phù hợp.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="row">
                                <div className="col-md-8">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Đơn giá
                                        </label>
                                        <div className="col-sm-9">
                                            <p className="mt-2">{price} USD</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="row">
                                <div className="col-md-8">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Số lượng
                                        </label>
                                        <div className="col-sm-9">
                                            <input
                                                onChange={handleOnChangeAmount}
                                                value={inputValues.amount}
                                                className="mt-2"
                                                type={"number"}
                                                min="1"
                                                step="1"
                                            ></input>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="row">
                                <div className="col-md-8">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Phương thức thanh toán
                                        </label>
                                        <div className="col-sm-9">
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "6px" }}>
                                                {GATEWAY_CHOICES.map((gw) => (
                                                    <button
                                                        key={gw.code}
                                                        type="button"
                                                        onClick={() => setSelectedGateway(gw.code)}
                                                        style={{
                                                            border:
                                                                selectedGateway === gw.code
                                                                    ? "2px solid #003d9b"
                                                                    : "1px solid #cbd5e1",
                                                            background:
                                                                selectedGateway === gw.code ? "#eff6ff" : "#ffffff",
                                                            color:
                                                                selectedGateway === gw.code ? "#003d9b" : "#334155",
                                                            borderRadius: "8px",
                                                            padding: "6px 12px",
                                                            fontSize: "12.5px",
                                                            fontWeight: 700,
                                                            cursor: "pointer",
                                                        }}
                                                    >
                                                        {gw.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="row">
                                <div className="col-md-8">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Mã ưu đãi
                                        </label>
                                        <div className="col-sm-9">
                                            <input
                                                type="text"
                                                className="form-control"
                                                placeholder="Nhập mã khuyến mãi (VD: VNPAY5K, ARCHITECT5K, JOBFIND10K)"
                                                value={promoCode}
                                                onChange={(e) => setPromoCode(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="row">
                                <div className="col-md-8">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Tổng tiền
                                        </label>
                                        <div className="col-sm-9">
                                            <p className="mt-2">{total} USD</p>
                                            <small style={{ color: "#003d9b", fontWeight: 700 }}>
                                                Quy đổi: {totalVnd.toLocaleString("vi-VN")} VNĐ • Tích lũy ngay +{estimatedTopPoints} Top Point thưởng Nhà tuyển dụng
                                            </small>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                className="btn1 btn1-primary1 btn1-icon-text"
                                onClick={() => handleBuy()}
                                disabled={isPackageLoading || !!packageError || dataPackage.length === 0 || isLoading}
                            >
                                <i className="ti-file btn1-icon-prepend"></i>
                                Mua
                            </button>
                        </form>
                    </div>
                </div>

                <EmployerRewardsSection compact />
            </div>
            {isLoading && (
                <Modal isOpen centered contentClassName="closeBorder">
                    <div
                        style={{
                            position: "absolute",
                            right: "50%",
                            justifyContent: "center",
                            alignItems: "center",
                        }}
                    >
                        <Spinner animation="border"></Spinner>
                    </div>
                </Modal>
            )}
        </div>
    );
};

export default BuyCv;
