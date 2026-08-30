import React from "react";
import { useEffect, useState } from "react";
import { getPaymentLinkCv, getAllToSelect } from "../../../service/userService";
import { toast } from "react-toastify";
import { Spinner, Modal } from "reactstrap";
const BuyCv = () => {
    const [inputValues, setInputValues] = useState({
        amount: 1,
        packageCvId: "",
    });
    const [isLoading, setIsLoading] = useState(false);
    const [dataPackage, setDataPackage] = useState([]);
    const [price, setPrice] = useState(0);
    const [total, setTotal] = useState(0);
    const handleOnChangePackage = (event) => {
        const { value } = event.target;
        let item = dataPackage.find((item) => String(item.id) === value);
        if (!item) return;
        setPrice(item.price);
        setTotal(item.price * inputValues.amount);
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
        setTotal(value * price);
    };

    const handleBuy = async () => {
        if (!inputValues.packageCvId) {
            toast.error("Hiện chưa có gói tìm ứng viên phù hợp");
            return;
        }
        setIsLoading(true);
        let res = await getPaymentLinkCv(
            inputValues.packageCvId,
            inputValues.amount
        );
        if (res.errCode == 0) {
            let data = {
                packageCvId: inputValues.packageCvId,
                amount: inputValues.amount,
                userId: JSON.parse(localStorage.getItem("userData")).id,
            };
            localStorage.setItem("orderCvData", JSON.stringify(data));
            window.location.href = res.link;
        } else {
            toast.error(res.errMessage);
            setIsLoading(false);
        }
    };
    const fetchPackagePost = async () => {
        let res = await getAllToSelect();
        const packages = Array.isArray(res?.data) ? res.data : [];
        const firstPackage = packages[0];
        setDataPackage(packages);
        setInputValues((current) => ({
            ...current,
            packageCvId: firstPackage?.id || "",
        }));
        setPrice(firstPackage?.price || 0);
        setTotal((firstPackage?.price || 0) * inputValues.amount);
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
                                                onChange={(event) =>
                                                    handleOnChangePackage(event)
                                                }
                                                disabled={dataPackage.length === 0}
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
                                            {dataPackage.length === 0 && (
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
                                disabled={dataPackage.length === 0 || isLoading}
                            >
                                <i className="ti-file btn1-icon-prepend"></i>
                                Mua
                            </button>
                        </form>
                    </div>
                </div>
            </div>
            {isLoading && (
                <Modal isOpen="true" centered contentClassName="closeBorder">
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
