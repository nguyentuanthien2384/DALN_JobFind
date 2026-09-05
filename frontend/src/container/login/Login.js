import React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { handleLoginService } from "../../service/userService";
import { toast } from "react-toastify";
import { safeReturnPath } from '../../auth/sessionExpiry';
const Login = () => {
    const [inputValues, setInputValues] = useState({
        password: "",
        phonenumber: "",
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const handleOnChange = (event) => {
        const { name, value } = event.target;
        setInputValues({ ...inputValues, [name]: value });
    };
    let handleLogin = async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            let res = await handleLoginService({
                phonenumber: inputValues.phonenumber,
                password: inputValues.password,
            });

            if (res && res.errCode === 0) {
                localStorage.setItem("userData", JSON.stringify(res.user));
                localStorage.setItem("token_user", res.token);
                const lastUrl = safeReturnPath(localStorage.getItem("lastUrl"), window.location.origin);
                localStorage.removeItem("lastUrl");
                if (
                    res.user.roleCode === "ADMIN" ||
                    res.user.roleCode === "EMPLOYER" ||
                    res.user.roleCode === "COMPANY"
                ) {
                    window.location.href = "/admin/";
                } else {
                    if (lastUrl) {
                        window.location.href = lastUrl;
                    } else {
                        window.location.href = "/";
                    }
                }
            } else {
                toast.error(res?.errMessage || "Dang nhap that bai. Vui long thu lai.");
            }
        } catch {
            toast.error('Không gửi được yêu cầu đăng nhập. Vui lòng thử lại.');
        } finally {
            setIsSubmitting(false);
        }
    };
    const handleSubmit = (event) => {
        event.preventDefault();
        handleLogin();
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
                                    <h4>Chào bạn! Tham gia ứng tuyển ngay</h4>
                                    <h6 className="font-weight-light">
                                        Đăng nhập để tiếp tục.
                                    </h6>
                                    {['expired', 'inactive'].includes(new URLSearchParams(window.location.search).get('reason')) && (
                                        <p role="status">
                                            {new URLSearchParams(window.location.search).get('reason') === 'inactive'
                                                ? 'Tài khoản đã bị khóa hoặc chưa kích hoạt. Vui lòng liên hệ quản trị viên.'
                                                : 'Phiên đăng nhập đã hết hạn hoặc không còn hợp lệ. Vui lòng đăng nhập lại.'}
                                        </p>
                                    )}
                                    <form className="pt-3" onSubmit={handleSubmit}>
                                        <div className="form-group">
                                            <input
                                                type="number"
                                                value={inputValues.phonenumber}
                                                name="phonenumber"
                                                onChange={(event) =>
                                                    handleOnChange(event)
                                                }
                                                className="form-control form-control-lg"
                                                id="exampleInputEmail1"
                                                placeholder="Số điện thoại"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <input
                                                type="password"
                                                value={inputValues.password}
                                                name="password"
                                                onChange={(event) =>
                                                    handleOnChange(event)
                                                }
                                                className="form-control form-control-lg"
                                                id="exampleInputPassword1"
                                                placeholder="Mật khẩu"
                                            />
                                        </div>
                                        <div className="mt-3">
                                            <button
                                                type="submit"
                                                disabled={isSubmitting}
                                                className="btn1 btn1-block btn1-primary1 btn1-lg font-weight-medium auth-form-btn1"
                                            >
                                                Đăng nhập
                                            </button>
                                        </div>
                                        <div className="my-2 d-flex justify-content-between align-items-center">
                                            {/* <a href="#" className="auth-link text-black">Forgot password?</a> */}
                                            <Link
                                                to="/forget-password"
                                                className="auth-link text-black"
                                                style={{ color: "blue" }}
                                            >
                                                Quên mật khẩu?
                                            </Link>
                                        </div>

                                        <div className="text-center mt-4 font-weight-light">
                                            Không có tài khoản?{" "}
                                            <Link
                                                to="/register"
                                                className="text-primary"
                                            >
                                                Tạo ngay
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

export default Login;
