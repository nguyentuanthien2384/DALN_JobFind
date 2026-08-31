import React from "react";
import { useEffect, useState } from "react";
import { getPaymentLinkCv, getAllToSelect } from "../../../service/userService";
import { toast } from "react-toastify";
import { Spinner, Modal } from "reactstrap";
import { readJsonStorage } from "../../../util/storage";
const BuyCv = () => {
    const [inputValues, setInputValues] = useState({
        amount: 1,
        packageCvId: "",
    });
    const [isLoading, setIsLoading] = useState(false);
    const [dataPackage, setDataPackage] = useState([]);
    const [isPackageLoading, setIsPackageLoading] = useState(true);
    const [packageError, setPackageError] = useState("");
    const [price, setPrice] = useState(0);
    const amountValue = Number(inputValues.amount);
    const total = Number.isFinite(amountValue) && amountValue > 0 ? amountValue * price : 0;
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
        } catch (error) {
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
                                            Tổng tiền
                                        </label>
                                        <div className="col-sm-9">
                                            <p className="mt-2">{total} USD</p>
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
