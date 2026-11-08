import React, { useEffect, useState } from "react";
import { getPackageByType, getPaymentLink } from "../../../service/userService";
import { createPaymentCheckoutService } from "../../../service/rewardPaymentService";
import { toast } from "react-toastify";
import { Spinner, Modal } from "reactstrap";
import { readJsonStorage } from "../../../util/storage";
import EmployerRewardsSection from "../Rewards/EmployerRewardsSection";
import OrderConfirmModal from "../../../components/payment/OrderConfirmModal";

const GATEWAY_CHOICES = [
    { code: "PAYPAL", label: "PayPal / Thẻ Quốc Tế (USD)" },
    { code: "VNPAY", label: "Cổng thanh toán VNPAY (VNĐ)" },
    { code: "MOMO", label: "Ví điện tử MoMo (VNĐ)" },
    { code: "ZALOPAY", label: "Ví điện tử ZaloPay (VNĐ)" },
];

const cachedPostPackagesByType = {};
const readWarmPostPackages = (isHot = 0) => {
    if (process.env.NODE_ENV === "test") return null;
    const list = cachedPostPackagesByType[Number(isHot)];
    return Array.isArray(list) && list.length > 0 ? list : null;
};

const BuyPost = () => {
    const warmPackages = readWarmPostPackages(0);
    const [inputValues, setInputValues] = useState({
        amount: 1,
        packageId: warmPackages ? warmPackages[0]?.id || "" : "",
        isHot: 0,
    });
    const [selectedGateway, setSelectedGateway] = useState("PAYPAL");
    const [promoCode, setPromoCode] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [dataPackage, setDataPackage] = useState(() => warmPackages || []);
    const [isPackageLoading, setIsPackageLoading] = useState(() => !warmPackages);
    const [packageError, setPackageError] = useState("");
    const [price, setPrice] = useState(() => (warmPackages ? warmPackages[0]?.price || 0 : 0));
    const amountValue = Number(inputValues.amount);
    const total = Number.isFinite(amountValue) && amountValue > 0 ? amountValue * price : 0;
    const totalVnd = Math.round(total * 25000);
    const estimatedTopPoints = totalVnd > 0 ? Math.max(1, Math.round(totalVnd / 100000)) : 0;

    const handleOnChangePackage = (event) => {
        const { value } = event.target;
        let item = dataPackage.find((item) => String(item.id) === value);
        if (!item) return;
        setPrice(item.price);
        setInputValues({
            ...inputValues,
            packageId: item.id,
        });
    };
    const handleOnChangeAmount = (event) => {
        const { value } = event.target;
        setInputValues({
            ...inputValues,
            amount: value,
        });
    };
    const handleOnChangeType = (event) => {
        const { value } = event.target;
        fetchPackagePost(value);
    };

    const validateOrderInputs = () => {
        if (!inputValues.packageId) {
            toast.error("Hiện chưa có gói đăng bài phù hợp");
            return null;
        }
        const amount = Number(inputValues.amount);
        if (!Number.isInteger(amount) || amount < 1) {
            toast.error("Số lượng phải là số nguyên lớn hơn 0");
            return null;
        }
        const userData = readJsonStorage("userData");
        if (!userData?.id) {
            toast.error("Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại");
            return null;
        }
        return { amount, userData };
    };

    const handleRequestBuy = () => {
        const valid = validateOrderInputs();
        if (!valid) return;
        setShowConfirmModal(true);
    };

    const handleConfirmBuy = async () => {
        const valid = validateOrderInputs();
        if (!valid) {
            setShowConfirmModal(false);
            return;
        }
        const { amount, userData } = valid;
        setShowConfirmModal(false);
        setIsLoading(true);
        try {
            if (selectedGateway === "PAYPAL" && !promoCode.trim()) {
                const res = await getPaymentLink(inputValues.packageId, amount);
                if (res?.errCode === 0 && res.link) {
                    const data = {
                        packageId: inputValues.packageId,
                        amount,
                        userId: userData.id,
                    };
                    localStorage.setItem("orderData", JSON.stringify(data));
                    window.location.href = res.link;
                    return;
                }
                if (!(res?.errCode === -1 && process.env.NODE_ENV !== "test")) {
                    toast.error(res?.errMessage || "Không thể tạo liên kết thanh toán");
                    return;
                }
            }

            const checkoutRes = await createPaymentCheckoutService({
                purpose: "PACKAGE_POST",
                itemCode: inputValues.packageId,
                quantity: amount,
                provider: selectedGateway,
                promoCode: promoCode.trim(),
                returnUrl: `${window.location.origin}/payment/result`,
            });
            const paymentUrl =
                checkoutRes?.data?.paymentUrl ||
                checkoutRes?.data?.checkoutUrl ||
                checkoutRes?.link;
            if (checkoutRes?.errCode === 0 && paymentUrl) {
                window.location.href = paymentUrl;
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
    const fetchPackagePost = async (isHot) => {
        const hotKey = Number(isHot);
        const warm = readWarmPostPackages(hotKey);
        if (warm) {
            setDataPackage(warm);
            setInputValues((current) => ({
                ...current,
                isHot: hotKey,
                packageId: warm[0]?.id || "",
            }));
            setPrice(warm[0]?.price || 0);
            setIsPackageLoading(false);
        } else {
            setIsPackageLoading(true);
            setInputValues((current) => ({ ...current, isHot: hotKey }));
        }
        setPackageError("");
        try {
            const res = await getPackageByType(isHot);
            if (!res || res.errCode !== 0) {
                setDataPackage([]);
                setInputValues((current) => ({ ...current, isHot: hotKey, packageId: "" }));
                setPrice(0);
                setPackageError(res?.errMessage || "Không thể tải danh sách gói đăng bài");
                return;
            }
            const packages = Array.isArray(res.data) ? res.data : [];
            if (process.env.NODE_ENV !== "test") {
                cachedPostPackagesByType[hotKey] = packages;
            }
            const firstPackage = packages[0];
            setDataPackage(packages);
            setInputValues((current) => ({
                ...current,
                isHot: hotKey,
                packageId: firstPackage?.id || "",
            }));
            setPrice(firstPackage?.price || 0);
        } catch (_error) {
            setDataPackage([]);
            setInputValues((current) => ({ ...current, isHot: hotKey, packageId: "" }));
            setPrice(0);
            setPackageError("Không thể tải danh sách gói đăng bài. Vui lòng thử lại");
        } finally {
            setIsPackageLoading(false);
        }
    };
    useEffect(() => {
        fetchPackagePost(0);
    }, []);
    return (
        <div className="">
            <div className="col-12 grid-margin">
                <div className="card">
                    <div className="card-body">
                        <h4 className="card-title">Mua lượt đăng bài viết</h4>
                        <br></br>
                        <form className="form-sample">
                            <div className="row">
                                <div className="col-md-8">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Loại lượt đăng bài viết
                                        </label>
                                        <div className="col-sm-9">
                                            <select
                                                style={{ color: "black" }}
                                                className="form-control"
                                                value={inputValues.isHot}
                                                name="typePost"
                                                onChange={(event) =>
                                                    handleOnChangeType(event)
                                                }
                                            >
                                                <option value={0}>
                                                    Bài viết bình thường
                                                </option>
                                                <option value={1}>
                                                    Bài viết nổi bật
                                                </option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="row">
                                <div className="col-md-8">
                                    <div className="form-group row">
                                        <label className="col-sm-3 col-form-label">
                                            Các gói bài viết
                                        </label>
                                        <div className="col-sm-9">
                                            <select
                                                style={{ color: "black" }}
                                                className="form-control"
                                                name="addressCode"
                                                value={inputValues.packageId}
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
                                                    Hiện chưa có gói đăng bài phù hợp.
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
                                                placeholder="Nhập mã giảm giá (nếu có)"
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
                                                Quy đổi: {totalVnd.toLocaleString("vi-VN")} VNĐ • Tích lũy +{estimatedTopPoints} Top Point
                                            </small>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                className="btn1 btn1-primary1 btn1-icon-text"
                                onClick={handleRequestBuy}
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
            <OrderConfirmModal
                isOpen={showConfirmModal}
                title="Xác nhận mua gói đăng tin"
                rows={[
                    {
                        label: "Loại bài viết:",
                        value: Number(inputValues.isHot) === 1 ? "Bài viết nổi bật" : "Bài viết bình thường",
                    },
                    {
                        label: "Gói dịch vụ:",
                        value:
                            dataPackage.find((item) => String(item.id) === String(inputValues.packageId))?.name ||
                            "—",
                    },
                    { label: "Đơn giá:", value: `${price} USD` },
                    { label: "Số lượng:", value: String(inputValues.amount) },
                    {
                        label: "Phương thức thanh toán:",
                        value: GATEWAY_CHOICES.find((gw) => gw.code === selectedGateway)?.label || selectedGateway,
                    },
                    ...(promoCode.trim()
                        ? [{ label: "Mã giảm giá:", value: promoCode.trim().toUpperCase() }]
                        : []),
                ]}
                totalLabel="Tổng thanh toán:"
                totalValue={`${total} USD`}
                subTotalNote={`Quy đổi tương đương: ${totalVnd.toLocaleString("vi-VN")} VNĐ`}
                isSubmitting={isLoading}
                onCancel={() => setShowConfirmModal(false)}
                onConfirm={handleConfirmBuy}
            />
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

export default BuyPost;
