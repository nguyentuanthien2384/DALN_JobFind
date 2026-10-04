import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "react-toastify";
import {
    changePasswordByphone,
    handleLoginService,
    requestResetPasswordOtp,
} from "../../service/userService";
import ForgetPassword from "./ForgetPassword";

jest.mock("../../service/userService", () => ({
    changePasswordByphone: jest.fn(),
    handleLoginService: jest.fn(),
    requestResetPasswordOtp: jest.fn(),
}));
jest.mock("react-toastify", () => ({
    toast: { error: jest.fn(), success: jest.fn() },
}));
jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        Link: ({ to, children, ...props }) =>
            React.createElement("a", { href: to, ...props }, children),
    };
});

const phone = "0909123456";

// user-event types key by key and respects disabled buttons, like a person using the form.
let user;
const typeInto = async (placeholder, value) => {
    const input = screen.getByPlaceholderText(placeholder);
    await user.clear(input);
    await user.type(input, value);
};

const enterPhone = async (value = phone) => {
    await typeInto("Số điện thoại", value);
    await user.click(screen.getByText("Gửi mã xác thực"));
};

const enterValidReset = async (password = "secret12") => {
    await typeInto("Mã xác thực", "123456");
    await typeInto("Mật khẩu mới", password);
    await typeInto("Xác nhận mật khẩu", password);
};

describe("ForgetPassword", () => {
    beforeEach(() => {
        user = userEvent.setup();
        localStorage.clear();
        jest.clearAllMocks();
        requestResetPasswordOtp.mockResolvedValue({
            errCode: 0,
            email: "a***@example.test",
        });
        changePasswordByphone.mockResolvedValue({ errCode: 0 });
        handleLoginService.mockResolvedValue({
            errCode: 0,
            token: "new-token",
            user: { id: 7, roleCode: "CANDIDATE", firstName: "An" },
        });
    });

    it("renders recovery guidance and account links", () => {
        render(<ForgetPassword />);
        // A phone number is text: type="number" lets arrow keys and the wheel rewrite it.
        expect(screen.getByPlaceholderText("Số điện thoại")).toHaveAttribute("type", "tel");
        expect(screen.getByPlaceholderText("Số điện thoại")).toHaveAttribute("inputmode", "numeric");

        expect(screen.getByRole("heading", { name: "Quên mật khẩu?" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Đăng ký" })).toHaveAttribute(
            "href",
            "/register"
        );
        expect(screen.getByRole("link", { name: "Đăng nhập" })).toHaveAttribute(
            "href",
            "/login"
        );
    });

    it("validates an empty and malformed phone number before making a request", async () => {
        render(<ForgetPassword />);

        await user.click(screen.getByText("Gửi mã xác thực"));
        expect(screen.getByText("Không được để trống")).toBeInTheDocument();
        await enterPhone("12345");
        expect(screen.getByText("Số điện thoại cần 10 số")).toBeInTheDocument();
        expect(requestResetPasswordOtp).not.toHaveBeenCalled();
    });

    it("prevents duplicate OTP requests and reveals the masked destination", async () => {
        let resolveRequest;
        requestResetPasswordOtp.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveRequest = resolve;
            })
        );
        render(<ForgetPassword />);
        await enterPhone();

        expect(screen.getByText("Đang gửi mã...")).toBeInTheDocument();
        await user.click(screen.getByText("Đang gửi mã..."));
        expect(requestResetPasswordOtp).toHaveBeenCalledTimes(1);
        expect(requestResetPasswordOtp).toHaveBeenCalledWith({ phonenumber: phone });

        await act(async () => {
            resolveRequest({ errCode: 0, email: "a***@example.test" });
        });
        expect(screen.getByText(/a\*\*\*@example\.test/)).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Mã xác thực")).toHaveAttribute("maxlength", "6");
        expect(toast.success).toHaveBeenCalledWith(
            "Đã gửi mã xác thực, vui lòng kiểm tra email"
        );
    });

    it("keeps the phone step and reports an OTP request failure", async () => {
        requestResetPasswordOtp.mockResolvedValueOnce({
            errCode: 2,
            errMessage: "Không tìm thấy tài khoản",
        });
        render(<ForgetPassword />);
        await enterPhone();

        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith("Không tìm thấy tài khoản")
        );
        expect(screen.getByPlaceholderText("Số điện thoại")).toHaveValue("0909123456");
        expect(screen.queryByPlaceholderText("Mã xác thực")).not.toBeInTheDocument();
    });

    it("resends the OTP and reports both successful and failed attempts", async () => {
        render(<ForgetPassword />);
        await enterPhone();
        await screen.findByPlaceholderText("Mã xác thực");

        requestResetPasswordOtp.mockResolvedValueOnce({ errCode: 0 });
        await user.click(screen.getByText("Gửi lại mã"));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã gửi lại mã xác thực"));
        expect(requestResetPasswordOtp).toHaveBeenLastCalledWith({ phonenumber: phone });

        requestResetPasswordOtp.mockResolvedValueOnce(null);
        await user.click(screen.getByText("Gửi lại mã"));
        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith("Không gửi được mã xác thực")
        );
    });

    it("validates the OTP, password policy and matching confirmation in order", async () => {
        render(<ForgetPassword />);
        await enterPhone();
        await screen.findByPlaceholderText("Mã xác thực");

        await user.click(screen.getByText("Xác nhận"));
        expect(screen.getByText("Mã xác thực gồm 6 chữ số")).toBeInTheDocument();

        await typeInto("Mã xác thực", "123456");
        await typeInto("Mật khẩu mới", "bad!");
        await user.click(screen.getByText("Xác nhận"));
        expect(
            screen.getByText(/Mật khẩu cần ít nhất 8 ký tự/)
        ).toBeInTheDocument();

        await typeInto("Mật khẩu mới", "secret12");
        await typeInto("Xác nhận mật khẩu", "secret23");
        await user.click(screen.getByText("Xác nhận"));
        expect(screen.getByText("Mật khẩu nhập lại không trùng")).toBeInTheDocument();
        expect(changePasswordByphone).not.toHaveBeenCalled();
    });

    it("refuses a new password made only of spaces without calling the server", async () => {
        render(<ForgetPassword />);
        await enterPhone();
        await screen.findByPlaceholderText("Mã xác thực");
        await enterValidReset(" ".repeat(10));
        await user.click(screen.getByText("Xác nhận"));
        expect(screen.getByText("Mật khẩu không được chỉ gồm khoảng trắng hoặc ký tự vô hình.")).toBeInTheDocument();
        expect(changePasswordByphone).not.toHaveBeenCalled();

        await enterValidReset("  mật khẩu mới  ");
        await user.click(screen.getByText("Xác nhận"));
        await waitFor(() => expect(changePasswordByphone).toHaveBeenCalledWith({
            phonenumber: phone, password: "  mật khẩu mới  ", otp: "123456",
        }));
    });

    it("submits the verified reset fields and surfaces a reset failure", async () => {
        changePasswordByphone.mockResolvedValueOnce({
            errCode: 2,
            errMessage: "Mã xác thực đã hết hạn",
        });
        render(<ForgetPassword />);
        await enterPhone();
        await screen.findByPlaceholderText("Mã xác thực");
        await enterValidReset();
        await user.click(screen.getByText("Xác nhận"));

        await waitFor(() =>
            expect(changePasswordByphone).toHaveBeenCalledWith({
                phonenumber: phone,
                password: "secret12",
                otp: "123456",
            })
        );
        expect(toast.error).toHaveBeenCalledWith("Mã xác thực đã hết hạn");
        expect(handleLoginService).not.toHaveBeenCalled();
    });

    it("logs the candidate in and stores the fresh session after a successful reset", async () => {
        // jsdom intentionally does not navigate on location.href assignment. The component still
        // executes the real redirect branch; silence only that environment-specific diagnostic.
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        render(<ForgetPassword />);
        await enterPhone();
        await screen.findByPlaceholderText("Mã xác thực");
        await enterValidReset();
        await user.click(screen.getByText("Xác nhận"));

        await waitFor(() =>
            expect(handleLoginService).toHaveBeenCalledWith({
                phonenumber: phone,
                password: "secret12",
            })
        );
        expect(toast.success).toHaveBeenCalledWith("Đổi mật khẩu thành công");
        expect(JSON.parse(localStorage.getItem("userData"))).toEqual({
            id: 7,
            roleCode: "CANDIDATE",
            firstName: "An",
        });
        expect(localStorage.getItem("token_user")).toMatch(/^jf-session:/);
        consoleError.mockRestore();
    });

    it("reports an automatic-login failure after the password was changed", async () => {
        handleLoginService.mockResolvedValueOnce({
            errCode: 2,
            errMessage: "Không thể đăng nhập",
        });
        render(<ForgetPassword />);
        await enterPhone();
        await screen.findByPlaceholderText("Mã xác thực");
        await enterValidReset();
        await user.click(screen.getByText("Xác nhận"));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không thể đăng nhập"));
        expect(localStorage.getItem("token_user")).toBeNull();
    });
});
