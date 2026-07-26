import React from "react";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
    checkUserPhoneService,
    createNewUser,
    handleLoginService,
} from "../../service/userService";
import { useFetchAllcode } from "../../util/fetch";
import handleValidate from "../../util/Validation";
import { Link } from "react-router-dom";
const Register = () => {
    const [inputValidates, setValidates] = useState({
        phonenumber: '',
        password: '',
        firstName: '',
        lastName: '',
        email: '',
        againPass: '',
    });
    const [inputValues, setInputValues] = useState({
        phonenumber: "",
        firstName: "",
        lastName: "",
        password: "",
        roleCode: "",
        email: "",
        againPass: "",
        genderCode: "",
    });
    let { data: dataRole } = useFetchAllcode("ROLE");
    let { data: dataGender } = useFetchAllcode("GENDER");

    if (dataRole && dataRole.length > 0) {
        dataRole = dataRole.filter(
            (item) => item.code !== "ADMIN" && item.code !== "COMPANY"
        );
    }
    if (
        dataGender &&
        dataGender.length > 0 &&
        inputValues.genderCode === "" &&
        dataRole &&
        dataRole.length > 0 &&
        inputValues.roleCode === ""
    ) {
        setInputValues({
            ...inputValues,
            ["genderCode"]: dataGender[0].code,
            ["roleCode"]: dataRole[0].code,
        });
    }

    const handleOnChange = (event) => {
        const { name, value } = event.target;
        setInputValues({ ...inputValues, [name]: value });
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

    let handleRegister = async () => {
        let checkPhonenumber = handleValidate(inputValues.phonenumber, "phone");
        let checkPassword = handleValidate(inputValues.password, "password");
        let checkFirstName = handleValidate(inputValues.firstName, "isEmpty");
        let checkLastName = handleValidate(inputValues.lastName, "isEmpty");
        let checkEmail = handleValidate(inputValues.email, "email");
        if (
            !(
                checkPhonenumber === true &&
                checkPassword === true &&
                checkFirstName === true &&
                checkLastName === true &&
                checkEmail === true
            )
        ) {
            setValidates({
                phonenumber: checkPhonenumber,
                password: checkPassword,
                firstName: checkFirstName,
                lastName: checkLastName,
                email: checkEmail,
            });
            return;
        }

        if (inputValues.againPass !== inputValues.password) {
            toast.error("Mật khẩu nhập lại không trùng khớp!");
            return;
        }
        let res = await checkUserPhoneService(inputValues.phonenumber);
        if (res === true) {
            toast.error("Số điện thoại đã tồn tại !");
        } else {
            let createUser = async () => {
                let res = await createNewUser({
                    password: inputValues.password,
                    firstName: inputValues.firstName,
                    lastName: inputValues.lastName,
                    phonenumber: inputValues.phonenumber,
                    roleCode: inputValues.roleCode,
                    email: inputValues.email,
                    image: "https://res.cloudinary.com/bingo2706/image/upload/v1642521841/dev_setups/l60Hf_blyqhb.png",
                });
                if (res && res.errCode === 0) {
                    toast.success("Tạo tài khoản thành công");
                    handleLogin(inputValues.phonenumber, inputValues.password);
                } else {
                    toast.error(res.errMessage);
                }
            };
            createUser();
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
                                    <h4>Người mới?</h4>
                                    <h6 className="font-weight-light">
                                        Đăng ký dễ dàng chỉ vài bước đơn giản
                                    </h6>
                                    <form className="pt-3">
                                        <div className="form-group">
                                            <input
                                                type="text"
                                                value={inputValues.firstName}
                                                name="firstName"
                                                onChange={(event) =>
                                                    handleOnChange(event)
                                                }
                                                className="form-control form-control-lg"
                                                id="exampleInputUsername1"
                                                placeholder="Họ"
                                            />
                                            {inputValidates.firstName !== '' && inputValidates.firstName !== true && (
                                                <p style={{ color: "red" }}>
                                                    {inputValidates.firstName}
                                                </p>
                                            )}
                                        </div>
                                        <div className="form-group">
                                            <input
                                                type="text"
                                                value={inputValues.lastName}
                                                name="lastName"
                                                onChange={(event) =>
                                                    handleOnChange(event)
                                                }
                                                className="form-control form-control-lg"
                                                id="exampleInputUsername1"
                                                placeholder="Tên"
                                            />
                                            {inputValidates.lastName !== '' && inputValidates.lastName !== true && (
                                                <p style={{ color: "red" }}>
                                                    {inputValidates.lastName}
                                                </p>
                                            )}
                                        </div>
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
                                            {inputValidates.phonenumber !== '' && inputValidates.phonenumber !== true && (
                                                <p style={{ color: "red" }}>
                                                    {inputValidates.phonenumber}
                                                </p>
                                            )}
                                        </div>
                                        <div className="form-group">
                                            <input
                                                type="text"
                                                value={inputValues.email}
                                                name="email"
                                                onChange={(event) =>
                                                    handleOnChange(event)
                                                }
                                                className="form-control form-control-lg"
                                                placeholder="Email"
                                            />
                                            {inputValidates.email !== '' && inputValidates.email !== true && (
                                                <p style={{ color: "red" }}>
                                                    {inputValidates.email}
                                                </p>
                                            )}
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
                                            {inputValidates.password !== '' && inputValidates.password !== true && (
                                                <p style={{ color: "red" }}>
                                                    {inputValidates.password}
                                                </p>
                                            )}
                                        </div>
                                        <div className="form-group">
                                            <input
                                                type="password"
                                                value={inputValues.againPass}
                                                name="againPass"
                                                onChange={(event) =>
                                                    handleOnChange(event)
                                                }
                                                className="form-control form-control-lg"
                                                placeholder="Nhập lại mật khẩu"
                                            />
                                            {inputValidates.againPass !== '' && inputValidates.againPass !== true && (
                                                <p style={{ color: "red" }}>
                                                    {inputValidates.againPass}
                                                </p>
                                            )}
                                        </div>
                                        <div className="form-group">
                                            <select
                                                style={{ color: "black" }}
                                                className="form-control"
                                                value={inputValues.roleCode}
                                                name="roleCode"
                                                onChange={(event) =>
                                                    handleOnChange(event)
                                                }
                                            >
                                                {dataRole &&
                                                    dataRole.length > 0 &&
                                                    dataRole.map(
                                                        (item, index) => {
                                                            if (
                                                                item.code !==
                                                                    "ADMIN" &&
                                                                item.code !==
                                                                    "COMPANY"
                                                            ) {
                                                                return (
                                                                    <option
                                                                        key={
                                                                            index
                                                                        }
                                                                        value={
                                                                            item.code
                                                                        }
                                                                    >
                                                                        {
                                                                            item.value
                                                                        }
                                                                    </option>
                                                                );
                                                            }
                                                        }
                                                    )}
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <select
                                                style={{ color: "black" }}
                                                className="form-control"
                                                value={inputValues.genderCode}
                                                name="genderCode"
                                                onChange={(event) =>
                                                    handleOnChange(event)
                                                }
                                            >
                                                {dataGender &&
                                                    dataGender.length > 0 &&
                                                    dataGender.map(
                                                        (item, index) => {
                                                            return (
                                                                <option
                                                                    key={index}
                                                                    value={
                                                                        item.code
                                                                    }
                                                                >
                                                                    {item.value}
                                                                </option>
                                                            );
                                                        }
                                                    )}
                                            </select>
                                        </div>
                                        <div className="mt-3">
                                            <a
                                                onClick={() => handleRegister()}
                                                className="btn1 btn1-block btn1-primary1 btn1-lg font-weight-medium auth-form-btn1"
                                            >
                                                Đăng ký
                                            </a>
                                        </div>
                                        <div className="text-center mt-4 font-weight-light">
                                            Bạn đã có tài khoản rồi?{" "}
                                            <Link
                                                to="/login"
                                                className="text-primary"
                                            >
                                                Đăng nhập ngay
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

export default Register;
