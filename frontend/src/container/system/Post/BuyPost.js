import React, { useEffect, useMemo, useState } from "react";
import { getPackageByType, getPaymentLink } from "../../../service/userService";
import {
    buildPromoCatalogMap,
    createPaymentCheckoutService,
    evaluatePromoRuleClient,
    getRewardConfigService,
    normalizeClientPromoRule,
    previewPromoCodeService,
} from "../../../service/rewardPaymentService";
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
    const [appliedPromo, setAppliedPromo] = useState("");
    const [customPromos, setCustomPromos] = useState({});
    const [serverPromoList, setServerPromoList] = useState(null);
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

    const promoCatalog = useMemo(() => {
        const baseMap = buildPromoCatalogMap(serverPromoList);
        return { ...baseMap, ...customPromos };
    }, [serverPromoList, customPromos]);

    const promoList = useMemo(() => Object.values(promoCatalog), [promoCatalog]);

    const discountInfo = useMemo(() => {
        const code = String(appliedPromo || "").trim().toUpperCase();
        if (!code || totalVnd <= 0) {
            return { discountVnd: 0, label: null, reason: null };
        }
        const rule = promoCatalog[code];
        return evaluatePromoRuleClient(rule, {
            amountVnd: totalVnd,
            provider: selectedGateway,
            purpose: "PACKAGE_POST",
        });
    }, [appliedPromo, promoCatalog, totalVnd, selectedGateway]);

    const finalTotalVnd = useMemo(() => {
        if (totalVnd <= 0) return 0;
        return Math.max(5000, totalVnd - Number(discountInfo.discountVnd || 0));
    }, [totalVnd, discountInfo]);

    const finalTotalUsd = useMemo(() => {
        if (discountInfo.discountVnd > 0 && totalVnd > 0) {
            return Number((finalTotalVnd / 25000).toFixed(2));
        }
        return total;
    }, [discountInfo, finalTotalVnd, total, totalVnd]);

    useEffect(() => {
        if (typeof getRewardConfigService !== "function") return undefined;
        let cancelled = false;
        Promise.resolve(getRewardConfigService())
            .then((res) => {
                if (!cancelled && res && res.errCode === 0 && Array.isArray(res.data?.promoCodes)) {
                    setServerPromoList(res.data.promoCodes);
                }
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const notifyWarning = (msg) => {
        if (typeof toast.warning === "function") {
            toast.warning(msg);
        } else {
            toast.error(msg);
        }
    };

    const applyPromoCodeValue = async (rawCode) => {
        const normalized = String(rawCode !== undefined ? rawCode : promoCode || "").trim().toUpperCase();
        if (!normalized) {
            setAppliedPromo("");
            return true;
        }
        const localRule = promoCatalog[normalized];
        if (localRule) {
            const evalRes = evaluatePromoRuleClient(localRule, {
                amountVnd: totalVnd,
                provider: selectedGateway,
                purpose: "PACKAGE_POST",
            });
            if (!evalRes.valid) {
                notifyWarning(evalRes.reason || "Mã ưu đãi chưa đủ điều kiện áp dụng.");
                return false;
            }
            setPromoCode(normalized);
            setAppliedPromo(normalized);
            toast.success(`Đã áp dụng mã ${normalized} (${evalRes.label}).`);
            return true;
        }
        if (typeof previewPromoCodeService === "function") {
            try {
                const res = await previewPromoCodeService({
                    promoCode: normalized,
                    provider: selectedGateway,
                    amountVnd: totalVnd,
                    purpose: "PACKAGE_POST",
                });
                if (res && res.errCode === 0 && res.data?.valid) {
                    const serverRule = normalizeClientPromoRule(normalized, {
                        ...res.data,
                        discountVnd: res.data.discountAmount,
                        label: res.data.description,
                    });
                    setCustomPromos((prev) => ({ ...prev, [normalized]: serverRule }));
                    setPromoCode(normalized);
                    setAppliedPromo(normalized);
                    toast.success(`Đã áp dụng mã ${normalized} (${serverRule.label}).`);
                    return true;
                }
                if (res && res.errMessage) {
                    notifyWarning(res.errMessage);
                    return false;
                }
            } catch (_error) {
                // ignore
            }
        }
        notifyWarning("Mã giảm giá không tồn tại hoặc đã hết hạn.");
        return false;
    };

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

    const handleRequestBuy = async () => {
        const valid = validateOrderInputs();
        if (!valid) return;
        const typed = String(promoCode || "").trim().toUpperCase();
        if (typed && typed !== appliedPromo) {
            const ok = await applyPromoCodeValue(typed);
            if (!ok) return;
        }
        setShowConfirmModal(true);
    };

    const handleConfirmBuy = async () => {
        const valid = validateOrderInputs();
        if (!valid) {
            setShowConfirmModal(false);
            return;
        }
        const { amount, userData } = valid;
        const effectivePromo = discountInfo.discountVnd > 0 ? appliedPromo : promoCode.trim();
        setShowConfirmModal(false);
        setIsLoading(true);
        try {
            if (selectedGateway === "PAYPAL" && !effectivePromo) {
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
                promoCode: effectivePromo,
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
                                            <div style={{ display: "flex", gap: "8px" }}>
                                                <input
                                                    type="text"
                                                    className="form-control"
                                                    placeholder="Nhập mã giảm giá (nếu có)"
                                                    value={promoCode}
                                                    onChange={(e) => setPromoCode(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                            e.preventDefault();
                                                            void applyPromoCodeValue(promoCode);
                                                        }
                                                    }}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => void applyPromoCodeValue(promoCode)}
                                                    style={{
                                                        border: "1px solid #003d9b",
                                                        background: "#eff6ff",
                                                        color: "#003d9b",
                                                        borderRadius: "6px",
                                                        padding: "0 14px",
                                                        fontWeight: 600,
                                                        fontSize: "13px",
                                                        whiteSpace: "nowrap",
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    Áp dụng
                                                </button>
                                            </div>
                                            {discountInfo.discountVnd > 0 && (
                                                <div
                                                    style={{
                                                        marginTop: "6px",
                                                        padding: "6px 10px",
                                                        borderRadius: "6px",
                                                        background: "#f0fdf4",
                                                        border: "1px solid #bbf7d0",
                                                        color: "#15803d",
                                                        fontSize: "12.5px",
                                                        display: "flex",
                                                        justifyContent: "space-between",
                                                        alignItems: "center",
                                                    }}
                                                >
                                                    <span>
                                                        Đã áp dụng mã <strong>{appliedPromo}</strong> (-
                                                        {discountInfo.discountVnd.toLocaleString("vi-VN")} VNĐ)
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setPromoCode("");
                                                            setAppliedPromo("");
                                                        }}
                                                        style={{
                                                            border: "none",
                                                            background: "none",
                                                            color: "#b91c1c",
                                                            fontSize: "12px",
                                                            cursor: "pointer",
                                                            padding: 0,
                                                        }}
                                                    >
                                                        Bỏ mã
                                                    </button>
                                                </div>
                                            )}
                                            {appliedPromo && discountInfo.discountVnd === 0 && discountInfo.reason && (
                                                <div
                                                    style={{
                                                        marginTop: "6px",
                                                        padding: "6px 10px",
                                                        borderRadius: "6px",
                                                        background: "#fffbeb",
                                                        border: "1px solid #fde68a",
                                                        color: "#b45309",
                                                        fontSize: "12px",
                                                        display: "flex",
                                                        justifyContent: "space-between",
                                                        alignItems: "center",
                                                    }}
                                                >
                                                    <span>{discountInfo.reason}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setPromoCode("");
                                                            setAppliedPromo("");
                                                        }}
                                                        style={{
                                                            border: "none",
                                                            background: "none",
                                                            color: "#b91c1c",
                                                            fontSize: "12px",
                                                            cursor: "pointer",
                                                            padding: 0,
                                                        }}
                                                    >
                                                        Bỏ mã
                                                    </button>
                                                </div>
                                            )}
                                            {promoList.length > 0 && (
                                                <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                                    {promoList.map((item) => {
                                                        const check = evaluatePromoRuleClient(item, {
                                                            amountVnd: totalVnd,
                                                            provider: selectedGateway,
                                                            purpose: "PACKAGE_POST",
                                                        });
                                                        const isApplied =
                                                            appliedPromo === item.code && discountInfo.discountVnd > 0;
                                                        const benefitTag =
                                                            item.discountType === "PERCENT"
                                                                ? `-${item.discountPercent}%`
                                                                : `-${Math.round((Number(item.discountVnd) || 0) / 1000)}k`;
                                                        return (
                                                            <button
                                                                key={item.code}
                                                                type="button"
                                                                title={item.description || item.label}
                                                                onClick={() => {
                                                                    if (isApplied) {
                                                                        setPromoCode("");
                                                                        setAppliedPromo("");
                                                                    } else {
                                                                        void applyPromoCodeValue(item.code);
                                                                    }
                                                                }}
                                                                style={{
                                                                    border: isApplied
                                                                        ? "1px solid #16a34a"
                                                                        : "1px dashed #cbd5e1",
                                                                    background: isApplied
                                                                        ? "#dcfce7"
                                                                        : check.valid
                                                                        ? "#f8fafc"
                                                                        : "#f1f5f9",
                                                                    color: isApplied ? "#14532d" : "#334155",
                                                                    opacity: check.valid || isApplied ? 1 : 0.65,
                                                                    borderRadius: "6px",
                                                                    padding: "3px 8px",
                                                                    fontSize: "11.5px",
                                                                    cursor: "pointer",
                                                                }}
                                                            >
                                                                <strong>{item.code}</strong> ({benefitTag}
                                                                {item.provider ? ` · ${item.provider}` : ""})
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
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
                                            <p className="mt-2">{finalTotalUsd} USD</p>
                                            <small style={{ color: "#003d9b", fontWeight: 700 }}>
                                                Quy đổi: {finalTotalVnd.toLocaleString("vi-VN")} VNĐ
                                                {discountInfo.discountVnd > 0
                                                    ? ` (Đã giảm ${discountInfo.discountVnd.toLocaleString("vi-VN")} VNĐ)`
                                                    : ""}{" "}
                                                • Tích lũy +{estimatedTopPoints} Top Point
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
                    ...((discountInfo.discountVnd > 0 ? appliedPromo : promoCode.trim())
                        ? [
                              {
                                  label: "Mã giảm giá:",
                                  value: (discountInfo.discountVnd > 0
                                      ? `${appliedPromo} (-${discountInfo.discountVnd.toLocaleString("vi-VN")} VNĐ)`
                                      : promoCode.trim().toUpperCase()),
                              },
                          ]
                        : []),
                ]}
                totalLabel="Tổng thanh toán:"
                totalValue={`${finalTotalUsd} USD`}
                subTotalNote={`Quy đổi tương đương: ${finalTotalVnd.toLocaleString("vi-VN")} VNĐ`}
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
