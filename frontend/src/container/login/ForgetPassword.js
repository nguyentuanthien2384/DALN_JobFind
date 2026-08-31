import React from "react";
import { useState } from "react";
import { toast } from "react-toastify";
import {
    requestResetPasswordOtp,
    changePasswordByphone,
    handleLoginService,
} from "../../service/userService";

import { Link } from "react-router-dom";
import handleValidate from "../../util/Validation";
const ForgetPassword = () => {
    const [inputValidates, setValidates] = useState({
        phonenumber: '',
        otp: '',
        newPassword: '',
        confirmPassword: '',
    });
    const [inputValues, setInputValues] = useState({
        phonenumber: "",
        isOpen: false,
        isSuccess: false,
        otp: "",
        newPassword: "",
        confirmPassword: "",
    });
    // Email da che bot, hien de nguoi dung biet phai mo hom thu nao lay ma.
    const [maskedEmail, setMaskedEmail] = useState("");
    const [isSending, setIsSending] = useState(false);

    const handleOnChange = (event) => {
        const { name, value } = event.target;
        setInputValues({ ...inputValues, [name]: value });
    };

    let handleForget = async () => {
        let checkPhone = handleValidate(inputValues.phonenumber, "phone");
        if (!(checkPhone === true)) {
            setValidates({
                ...inputValidates,
                phonenumber: checkPhone,
            });
            return;
        }
        // Gui ma xac thuc ve email gan voi so dien thoai. Truoc day buoc nay chi
        // kiem tra so dien thoai co ton tai hay khong, nghia la ai cung doi duoc
        // mat khau cua nguoi khac chi bang cach biet so dien thoai.
        setIsSending(true);
        let res = await requestResetPasswordOtp({
            phonenumber: inputValues.phonenumber,
        });
        setIsSending(false);
        if (res && res.errCode === 0) {
            setMaskedEmail(res.email || "");
            setValidates({ ...inputValidates, phonenumber: '' });
            setInputValues({
                ...inputValues,
                isSuccess: true,
            });
            toast.success("Đã gửi mã xác thực, vui lòng kiểm tra email");
        } else {
            setValidates({
                ...inputValidates,
                phonenumber: true,
            });
            toast.error((res && res.errMessage) || "Không gửi được mã xác thực");
        }
    };

    let handleResendOtp = async () => {
        setIsSending(true);
        let res = await requestResetPasswordOtp({
            phonenumber: inputValues.phonenumber,
        });
        setIsSending(false);
        if (res && res.errCode === 0) {
            toast.success("Đã gửi lại mã xác thực");
        } else {
            toast.error((res && res.errMessage) || "Không gửi được mã xác thực");
        }
    };

    let handleLogin = async (phonenumber, password) => {
        let res = await handleLoginService({
            phonenumber: phonenumber,
            password: password,
        });

        if (res && res.errCode === 0) {
            localStorage.setItem("userData", JSON.stringify(res.user));
            localStorage.setItem("token_user", res.token);
            if (
                res.user.roleCode === "ADMIN" ||
                res.user.roleCode === "EMPLOYER"
            ) {
                window.location.href = "/admin/";
            } else {
                window.location.href = "/";
            }
        } else {
            toast.error(res.errMessage);
        }
    };
    let handleForgetPassword = async () => {
        if (!/^\d{6}$/.test(inputValues.otp)) {
            setValidates({
                ...inputValidates,
                otp: "Mã xác thực gồm 6 chữ số",
            });
            return;
        }
        let checkNewPass = handleValidate(inputValues.newPassword, "password");
        if (!(checkNewPass === true)) {
            setValidates({
                ...inputValidates,
                otp: '',
                newPassword: checkNewPass,
            });
            return;
        }
        if (inputValues.confirmPassword !== inputValues.newPassword) {
            setValidates({
                ...inputValidates,
                otp: '',
                newPassword: '',
                confirmPassword: "Mật khẩu nhập lại không trùng",
            });
            return;
        }
        let res = await changePasswordByphone({
            phonenumber: inputValues.phonenumber,
            password: inputValues.newPassword,
            otp: inputValues.otp,
        });
        if (res && res.errCode === 0) {
            toast.success("Đổi mật khẩu thành công");
            handleLogin(inputValues.phonenumber, inputValues.newPassword);
        } else {
            toast.error(res.errMessage);
        }
    };
    return (
        <>
            <div className="container-scroller">
                <div className="container-fluid page-body-wrapper full-page-wrapper">
                    <div className="content-wrapper d-flex align-items-center auth px-0">
                        <div className="row w-100 mx-0">
                            <div className="col-lg-4 mx-auto">
                                <div className="auth-form-light text-left py-5 px-4 px-sm-5">
                                    <div className="brand-logo">
                                        <img
                                            src="/assets/img/logo/logo.png"
                                            alt="logo"
                                        />
                                    </div>
                                    <h4>Quên mật khẩu?</h4>
                                    <h6 className="font-weight-light">
                                        Đừng lo! Khôi phục trong vài giây
                                    </h6>
                                    <form className="pt-3">
                                        {inputValues.isSuccess === true && (
                                            <>
                                                <p style={{ fontSize: "14px" }}>
                                                    Mã xác thực gồm 6 chữ số đã được gửi tới
                                                    {maskedEmail ? ` ${maskedEmail}` : " email của bạn"}.
                                                    Mã có hiệu lực trong 5 phút.
                                                </p>
                                                <div className="form-group">
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        maxLength={6}
                                                        value={inputValues.otp}
                                                        name="otp"
                                                        onChange={(event) =>
                                                            handleOnChange(event)
                                                        }
                                                        className="form-control form-control-lg"
                                                        placeholder="Mã xác thực"
                                                    />
                                                    {inputValidates.otp !== '' && inputValidates.otp !== true && (
                                                        <p style={{ color: "red" }}>
                                                            {inputValidates.otp}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="form-group">
                                                    <input
                                                        type="password"
                                                        value={
                                                            inputValues.newPassword
                                                        }
                                                        name="newPassword"
                                                        onChange={(event) =>
                                                            handleOnChange(
                                                                event
                                                            )
                                                        }
                                                        className="form-control form-control-lg"
                                                        id="exampleInputPassword1"
                                                        placeholder="Mật khẩu mới"
                                                    />
                                                    {inputValidates.newPassword !== '' && inputValidates.newPassword !== true && (
                                                        <p
                                                            style={{
                                                                color: "red",
                                                            }}
                                                        >
                                                            {
                                                                inputValidates.newPassword
                                                            }
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="form-group">
                                                    <input
                                                        type="password"
                                                        value={
                                                            inputValues.confirmPassword
                                                        }
                                                        name="confirmPassword"
                                                        onChange={(event) =>
                                                            handleOnChange(
                                                                event
                                                            )
                                                        }
                                                        className="form-control form-control-lg"
                                                        id="exampleInputPassword1"
                                                        placeholder="Xác nhận mật khẩu"
                                                    />
                                                    {inputValidates.confirmPassword !== '' && inputValidates.confirmPassword !== true && (
                                                        <p
                                                            style={{
                                                                color: "red",
                                                            }}
                                                        >
                                                            {
                                                                inputValidates.confirmPassword
                                                            }
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="mt-3">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            handleForgetPassword()
                                                        }
                                                        className="btn1 btn1-block btn1-primary1 btn1-lg font-weight-medium auth-form-btn1"
                                                    >
                                                        Xác nhận
                                                    </button>
                                                </div>
                                                <div className="text-center mt-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (!isSending) handleResendOtp();
                                                        }}
                                                        className="text-primary"
                                                        style={{ cursor: "pointer" }}
                                                    >
                                                        {isSending ? "Đang gửi..." : "Gửi lại mã"}
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                        {inputValues.isSuccess === false && (
                                            <>
                                                <div className="form-group">
                                                    <input
                                                        type="number"
                                                        value={
                                                            inputValues.phonenumber
                                                        }
                                                        name="phonenumber"
                                                        onChange={(event) =>
                                                            handleOnChange(
                                                                event
                                                            )
                                                        }
                                                        className="form-control form-control-lg"
                                                        id="exampleInputEmail1"
                                                        placeholder="Số điện thoại"
                                                    />
                                                    {inputValidates.phonenumber !== '' && inputValidates.phonenumber !== true && (
                                                        <p
                                                            style={{
                                                                color: "red",
                                                            }}
                                                        >
                                                            {
                                                                inputValidates.phonenumber
                                                            }
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="mt-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (!isSending) handleForget();
                                                        }}
                                                        className="btn1 btn1-block btn1-primary1 btn1-lg font-weight-medium auth-form-btn1"
                                                    >
                                                        {isSending ? "Đang gửi mã..." : "Gửi mã xác thực"}
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                        <div className="text-center mt-4 font-weight-light">
                                            Chưa có tài khoản?{" "}
                                            <Link
                                                to="/register"
                                                className="text-primary"
                                            >
                                                Đăng ký
                                            </Link>
                                            <br></br>
                                            <br></br>
                                            Đã có tài khoản?{" "}
                                            <Link
                                                to="/login"
                                                className="text-primary"
                                            >
                                                Đăng nhập
                                            </Link>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* content-wrapper ends */}
                </div>
                {/* page-body-wrapper ends */}
            </div>
        </>
    );
};

export default ForgetPassword;
