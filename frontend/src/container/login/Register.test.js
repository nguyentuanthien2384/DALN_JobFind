import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import {
    checkUserPhoneService,
    createNewUser,
    handleLoginService,
} from "../../service/userService";
import Register from "./Register";

jest.mock("../../service/userService", () => ({
    checkUserPhoneService: jest.fn(),
    createNewUser: jest.fn(),
    handleLoginService: jest.fn(),
}));
jest.mock("../../util/fetch", () => ({
    useFetchAllcode: (type) => ({
        data: type === "ROLE"
            ? [
                { code: "ADMIN", value: "Admin" },
                { code: "COMPANY", value: "Company" },
                { code: "CANDIDATE", value: "Candidate" },
                { code: "EMPLOYER", value: "Employer" },
            ]
            : [{ code: "M", value: "Nam" }, { code: "F", value: "Nữ" }],
    }),
}));
jest.mock("react-toastify", () => ({
    toast: { error: jest.fn(), success: jest.fn() },
}));
jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        Link: ({ to, children, ...props }) => React.createElement("a", { href: to, ...props }, children),
    };
});

const renderRegister = () => render(<Register />);

const fillValidForm = ({ confirmation = "secret1" } = {}) => {
    fireEvent.change(screen.getByPlaceholderText("Họ"), { target: { value: "Nguyen" } });
    fireEvent.change(screen.getByPlaceholderText("Tên"), { target: { value: "Lan" } });
    fireEvent.change(screen.getByPlaceholderText("Số điện thoại"), { target: { value: "0912345678" } });
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "lan@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("Mật khẩu"), { target: { value: "secret1" } });
    fireEvent.change(screen.getByPlaceholderText("Nhập lại mật khẩu"), { target: { value: confirmation } });
};

describe("Register", () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        window.history.replaceState({}, "", "/register");
    });

    it("filters privileged roles and initializes candidate/gender defaults", async () => {
        renderRegister();
        expect(await screen.findByDisplayValue("Candidate")).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: "Admin" })).not.toBeInTheDocument();
        expect(screen.queryByRole("option", { name: "Company" })).not.toBeInTheDocument();
        expect(screen.getByDisplayValue("Nam")).toBeInTheDocument();
    });

    it("shows field validation messages and does not call the API", async () => {
        renderRegister();
        fireEvent.click(screen.getByText("Đăng ký"));
        expect(await screen.findAllByText("Không được để trống")).toHaveLength(5);
        expect(checkUserPhoneService).not.toHaveBeenCalled();
    });

    it("rejects a password confirmation mismatch", async () => {
        renderRegister();
        fillValidForm({ confirmation: "other12" });
        fireEvent.click(screen.getByText("Đăng ký"));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Mật khẩu nhập lại không trùng khớp!"));
        expect(checkUserPhoneService).not.toHaveBeenCalled();
    });

    it("does not create an account when the phone already exists", async () => {
        checkUserPhoneService.mockResolvedValue(true);
        renderRegister();
        fillValidForm();
        fireEvent.click(screen.getByText("Đăng ký"));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Số điện thoại đã tồn tại !"));
        expect(createNewUser).not.toHaveBeenCalled();
    });

    it("creates the account, logs in and persists the new session", async () => {
        checkUserPhoneService.mockResolvedValue(false);
        createNewUser.mockResolvedValue({ errCode: 0 });
        const user = { id: 10, roleCode: "CANDIDATE" };
        handleLoginService.mockResolvedValue({ errCode: 0, user, token: "new-token" });
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        renderRegister();
        fillValidForm();
        fireEvent.click(screen.getByText("Đăng ký"));

        await waitFor(() => expect(createNewUser).toHaveBeenCalledWith({
            password: "secret1",
            firstName: "Nguyen",
            lastName: "Lan",
            phonenumber: "0912345678",
            roleCode: "CANDIDATE",
            email: "lan@example.com",
            image: expect.stringContaining("cloudinary.com"),
        }));
        expect(toast.success).toHaveBeenCalledWith("Tạo tài khoản thành công");
        await waitFor(() => expect(handleLoginService).toHaveBeenCalledWith({
            phonenumber: "0912345678",
            password: "secret1",
        }));
        await waitFor(() => expect(localStorage.getItem("token_user")).toBe("new-token"));
        consoleError.mockRestore();
    });

    it("shows account creation and automatic-login failures", async () => {
        checkUserPhoneService.mockResolvedValue(false);
        createNewUser.mockResolvedValueOnce({ errCode: 2, errMessage: "Create failed" });
        renderRegister();
        fillValidForm();
        fireEvent.click(screen.getByText("Đăng ký"));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Create failed"));
        expect(handleLoginService).not.toHaveBeenCalled();

        jest.clearAllMocks();
        checkUserPhoneService.mockResolvedValue(false);
        createNewUser.mockResolvedValue({ errCode: 0 });
        handleLoginService.mockResolvedValue({ errCode: 1, errMessage: "Login failed" });
        fireEvent.click(screen.getByText("Đăng ký"));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Login failed"));
    });
});
