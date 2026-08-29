import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Modal as AntModal } from "antd";
import { toast } from "react-toastify";
import {
    accecptCompanyService,
    BanUserService,
    banCompanyService,
    createNewUser,
    getAllCompany,
    getAllUserByCompanyIdService,
    getAllUsers,
    getDetailUserById,
    handleChangePassword,
    QuitCompanyService,
    RecruitmentService,
    UnbanUserService,
    unbanCompanyService,
    UpdateUserService,
} from "../../service/userService";
import AddUser from "./User/AddUser";
import ChangePassword from "./User/ChangePassword";
import ManageUser from "./User/ManageUser";
import ManageCompany from "./Company/ManageCompany";
import ManageEmployer from "./Company/ManageEmployer";
import Recruitment from "./Company/Recruitment";

let mockParams = {};
const mockNavigate = jest.fn();

jest.mock("xlsx/xlsx.mjs", () => ({
    utils: { book_new: jest.fn(), json_to_sheet: jest.fn(), book_append_sheet: jest.fn() },
    writeFile: jest.fn(),
}));
jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
        useNavigate: () => mockNavigate,
        useParams: () => mockParams,
    };
});
jest.mock("../../service/userService", () => ({
    accecptCompanyService: jest.fn(),
    BanUserService: jest.fn(),
    banCompanyService: jest.fn(),
    createNewUser: jest.fn(),
    getAllCompany: jest.fn(),
    getAllUserByCompanyIdService: jest.fn(),
    getAllUsers: jest.fn(),
    getDetailUserById: jest.fn(),
    handleChangePassword: jest.fn(),
    QuitCompanyService: jest.fn(),
    RecruitmentService: jest.fn(),
    UnbanUserService: jest.fn(),
    unbanCompanyService: jest.fn(),
    UpdateUserService: jest.fn(),
}));
jest.mock("../../util/fetch", () => ({
    useFetchAllcode: (type) => ({
        data: type === "GENDER"
            ? [{ code: "M", value: "Nam" }, { code: "F", value: "Nữ" }]
            : [
                { code: "ADMIN", value: "Quản trị" },
                { code: "COMPANY", value: "Công ty" },
                { code: "EMPLOYER", value: "Nhân viên" },
                { code: "CANDIDATE", value: "Ứng viên" },
            ],
    }),
}));
jest.mock("react-datepicker", () => ({ selected, onChange }) => (
    <input
        aria-label="Ngày sinh"
        value={selected ? new Date(selected).toISOString().slice(0, 10) : ""}
        onChange={(event) => onChange(new Date(`${event.target.value}T00:00:00Z`))}
    />
));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-paginate", () => (props) => (
    <button type="button" data-testid="page-2" onClick={() => props.onPageChange({ selected: 1 })}>page 2</button>
));
jest.mock("reactstrap", () => ({
    Modal: ({ children, isOpen }) => isOpen ? <div>{children}</div> : null,
    Spinner: () => <span>loading</span>,
    ListGroupItemHeading: ({ children }) => <div>{children}</div>,
}));
jest.mock("antd", () => {
    const React = require("react");
    const Search = ({ onSearch, placeholder }) => {
        const [value, setValue] = React.useState("");
        return <div>
            <input aria-label={placeholder} value={value} onChange={(event) => setValue(event.target.value)} />
            <button type="button" onClick={() => onSearch(value)}>Tìm kiếm</button>
        </div>;
    };
    const Select = ({ options = [], onChange, defaultValue = "" }) => (
        <select aria-label="Loại kiểm duyệt" defaultValue={defaultValue} onChange={(event) => onChange(event.target.value)}>
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    );
    return {
        Input: { Search },
        Modal: { confirm: jest.fn() },
        Row: ({ children }) => <div>{children}</div>,
        Col: ({ children }) => <div>{children}</div>,
        Select,
    };
});
jest.mock("@ant-design/icons", () => ({ ExclamationCircleOutlined: () => null }));
jest.mock("../../components/modal/NoteModal", () => ({ isOpen, id, handleFunc, onHide }) => isOpen ? (
    <div role="dialog" aria-label="Ghi chú">
        <button type="button" onClick={() => handleFunc(id, "Không đủ hồ sơ")}>Gửi lý do</button>
        <button type="button" onClick={onHide}>Đóng</button>
    </div>
) : null);

const account = ({ id, statusCode = "S1", name = "Lan", role = "EMPLOYER" }) => ({
    id,
    phonenumber: `09000000${id}`,
    statusCode,
    roleData: { value: role === "ADMIN" ? "Quản trị" : "Nhân viên" },
    statusAccountData: { value: statusCode === "S1" ? "Hoạt động" : "Đã chặn" },
    userAccountData: {
        id: id + 100,
        firstName: name,
        lastName: "Nguyễn",
        dob: 946684800000,
        genderCode: "F",
        genderData: { value: "Nữ" },
    },
});

const company = ({ id = 5, status = "S1", censor = "CS3" } = {}) => ({
    id,
    name: `Công ty ${id}`,
    phonenumber: "0911222333",
    taxnumber: "TAX-5",
    createdAt: "2026-08-01T00:00:00Z",
    statusCompanyData: { code: status, value: status === "S1" ? "Hoạt động" : "Tạm dừng" },
    censorData: { code: censor, value: censor === "CS1" ? "Đã duyệt" : "Chờ duyệt" },
});

describe("ManageUser", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        getAllUsers.mockResolvedValue({ errCode: 0, count: 2, data: [
            account({ id: 1, role: "ADMIN", name: "Tôi" }),
            account({ id: 2, name: "Lan" }),
        ] });
        BanUserService.mockResolvedValue({ errCode: 0, errMessage: "Đã chặn" });
        UnbanUserService.mockResolvedValue({ errCode: 0, errMessage: "Đã kích hoạt" });
    });

    it("does not allow the current admin to block itself and blocks another user", async () => {
        render(<ManageUser />);
        expect(await screen.findByText("Số lượng người dùng: 2")).toBeInTheDocument();
        const selfRow = screen.getByText("Tôi Nguyễn").closest("tr");
        const otherRow = screen.getByText("Lan Nguyễn").closest("tr");
        expect(within(selfRow).queryByText("Chặn")).not.toBeInTheDocument();
        fireEvent.click(within(otherRow).getByText("Chặn"));
        await waitFor(() => expect(BanUserService).toHaveBeenCalledWith(102));
        expect(UnbanUserService).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith("Đã chặn");
        expect(getAllUsers).toHaveBeenCalledTimes(2);
    });

    it("normalizes searches, paginates and activates a blocked account", async () => {
        getAllUsers.mockResolvedValue({ errCode: 0, count: 1, data: [account({ id: 2, statusCode: "S2" })] });
        render(<ManageUser />);
        await screen.findByText("Kích hoạt");
        const input = screen.getByLabelText("Nhập tên hoặc số điện thoại");
        fireEvent.change(input, { target: { value: "  Lan   Nguyen " } });
        fireEvent.click(screen.getByRole("button", { name: "Tìm kiếm" }));
        await waitFor(() => expect(getAllUsers).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Lan Nguyen", offset: 0 })));
        fireEvent.click(screen.getByTestId("page-2"));
        await waitFor(() => expect(getAllUsers).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10 })));
        fireEvent.click(screen.getByText("Kích hoạt"));
        await waitFor(() => expect(UnbanUserService).toHaveBeenCalledWith(102));
    });
});

describe("AddUser and ChangePassword", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        mockParams = {};
        createNewUser.mockResolvedValue({ errCode: 0 });
        UpdateUserService.mockResolvedValue({ errCode: 0 });
        handleChangePassword.mockResolvedValue({ errCode: 0 });
    });

    it("enforces company role choices and includes companyId when creating an employee", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 8, roleCode: "COMPANY", companyId: 44 }));
        const { container } = render(<AddUser />);
        const roleSelect = container.querySelector('select[name="roleCode"]');
        expect(within(roleSelect).queryByRole("option", { name: "Quản trị" })).not.toBeInTheDocument();
        expect(within(roleSelect).queryByRole("option", { name: "Ứng viên" })).not.toBeInTheDocument();
        fireEvent.change(roleSelect, { target: { name: "roleCode", value: "EMPLOYER" } });
        fireEvent.change(container.querySelector('input[name="email"]'), { target: { name: "email", value: "lan@example.com" } });
        fireEvent.change(container.querySelector('input[name="firstName"]'), { target: { name: "firstName", value: "Lan" } });
        fireEvent.change(container.querySelector('input[name="lastName"]'), { target: { name: "lastName", value: "Nguyễn" } });
        fireEvent.change(container.querySelector('input[name="phonenumber"]'), { target: { name: "phonenumber", value: "0912345678" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await waitFor(() => expect(createNewUser).toHaveBeenCalledWith(expect.objectContaining({
            email: "lan@example.com",
            firstName: "Lan",
            lastName: "Nguyễn",
            phonenumber: "0912345678",
            roleCode: "EMPLOYER",
            companyId: 44,
        })));
    });

    it("loads an existing user and preserves or changes DOB intentionally", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        mockParams = { id: "102" };
        getDetailUserById.mockResolvedValue({ errCode: 0, data: account({ id: 2 }) });
        const { container } = render(<AddUser />);
        await screen.findByText("Cập nhật người dùng");
        await waitFor(() => expect(container.querySelector('input[name="firstName"]')).toHaveValue("Lan"));
        expect(container.querySelector('input[name="email"]')).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Ngày sinh"), { target: { value: "2001-02-03" } });
        fireEvent.change(container.querySelector('input[name="firstName"]'), { target: { name: "firstName", value: "Linh" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await waitFor(() => expect(UpdateUserService).toHaveBeenCalledWith(expect.objectContaining({
            id: 102,
            firstName: "Linh",
            dob: Date.parse("2001-02-03T00:00:00Z"),
        })));
    });

    it("rejects mismatched passwords, then submits and clears a valid change", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 9 }));
        const { container } = render(<ChangePassword />);
        const oldPassword = container.querySelector('input[name="oldPassword"]');
        const password = container.querySelector('input[name="password"]');
        const confirmation = container.querySelector('input[name="confirmPassword"]');
        fireEvent.change(oldPassword, { target: { name: "oldPassword", value: "old" } });
        fireEvent.change(password, { target: { name: "password", value: "new-one" } });
        fireEvent.change(confirmation, { target: { name: "confirmPassword", value: "different" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        expect(handleChangePassword).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith("Mật khẩu nhập lại không đúng");

        fireEvent.change(confirmation, { target: { name: "confirmPassword", value: "new-one" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await waitFor(() => expect(handleChangePassword).toHaveBeenCalledWith({ id: 9, oldpassword: "old", password: "new-one" }));
        expect(oldPassword).toHaveValue("");
        expect(password).toHaveValue("");
        expect(confirmation).toHaveValue("");
    });
});

describe("company staff workflows", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 20, roleCode: "COMPANY", companyId: 5 }));
        RecruitmentService.mockResolvedValue({ errCode: 0 });
        QuitCompanyService.mockResolvedValue({ errCode: 0 });
        getAllUserByCompanyIdService.mockResolvedValue({ errCode: 0, count: 1, data: [{
            id: 21,
            firstName: "Minh",
            lastName: "Trần",
            dob: 946684800000,
            genderData: { value: "Nam" },
            userAccountData: {
                phonenumber: "0909009009",
                roleData: { value: "Nhân viên" },
                statusCode: "S1",
                statusAccountData: { value: "Hoạt động" },
            },
        }] });
    });

    it("recruits by phone for the signed-in company and clears a successful request", async () => {
        const { container } = render(<Recruitment />);
        const phone = container.querySelector('input[name="phonenumber"]');
        fireEvent.change(phone, { target: { name: "phonenumber", value: "0909009009" } });
        fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
        await waitFor(() => expect(RecruitmentService).toHaveBeenCalledWith({ phonenumber: "0909009009", companyId: 5 }));
        expect(phone).toHaveValue("");
        expect(toast.success).toHaveBeenCalledWith("Tuyển dụng thành công !");
    });

    it("removes another employee and refreshes the current company page", async () => {
        render(<ManageEmployer />);
        expect(await screen.findByText("Minh Trần")).toBeInTheDocument();
        fireEvent.click(screen.getByText("Thôi việc"));
        await waitFor(() => expect(QuitCompanyService).toHaveBeenCalledWith({ userId: 21 }));
        expect(getAllUserByCompanyIdService).toHaveBeenLastCalledWith({ limit: 10, offset: 0, companyId: 5 });
        expect(toast.success).toHaveBeenCalledWith("Thôi việc thành công !");
    });
});

describe("ManageCompany moderation", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        AntModal.confirm.mockImplementation((options) => options.onOk());
        getAllCompany.mockResolvedValue({ errCode: 0, count: 1, data: [company()] });
        banCompanyService.mockResolvedValue({ errCode: 0, errMessage: "Đã dừng" });
        unbanCompanyService.mockResolvedValue({ errCode: 0, errMessage: "Đã mở" });
        accecptCompanyService.mockResolvedValue({ errCode: 0, errMessage: "Đã cập nhật kiểm duyệt" });
    });

    it("filters, bans and accepts a pending company through confirmation", async () => {
        render(<ManageCompany />);
        expect(await screen.findByText("Công ty 5")).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Loại kiểm duyệt"), { target: { value: "CS3" } });
        await waitFor(() => expect(getAllCompany).toHaveBeenLastCalledWith(expect.objectContaining({ censorCode: "CS3" })));
        fireEvent.click(screen.getByText("Dừng kích hoạt"));
        await waitFor(() => expect(banCompanyService).toHaveBeenCalledWith({ id: 5 }));
        fireEvent.click(screen.getByText("Duyệt"));
        await waitFor(() => expect(accecptCompanyService).toHaveBeenCalledWith({ companyId: 5, note: "null" }));
    });

    it("passes a moderator note when rejecting or returning a company to pending", async () => {
        render(<ManageCompany />);
        await screen.findByText("Từ chối");
        fireEvent.click(screen.getByText("Từ chối"));
        fireEvent.click(within(screen.getByRole("dialog", { name: "Ghi chú" })).getByText("Gửi lý do"));
        await waitFor(() => expect(accecptCompanyService).toHaveBeenCalledWith({ companyId: 5, note: "Không đủ hồ sơ" }));
    });

    it("reactivates an inactive company", async () => {
        getAllCompany.mockResolvedValue({ errCode: 0, count: 1, data: [company({ status: "S2", censor: "CS1" })] });
        render(<ManageCompany />);
        fireEvent.click(await screen.findByText("Kích hoạt"));
        await waitFor(() => expect(unbanCompanyService).toHaveBeenCalledWith({ id: 5 }));
    });
});
