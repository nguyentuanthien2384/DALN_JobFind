import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import CommonUtils from "../../util/CommonUtils";
import {
    createCompanyService,
    getDetailCompanyByUserId,
    getDetailUserById,
    UpdateUserService,
    updateCompanyService,
} from "../../service/userService";
import UserInfo from "./User/UserInfo";
import AddCompany from "./Company/AddCompany";

let mockParams = {};
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
}));
jest.mock("../../service/userService", () => ({
    createCompanyService: jest.fn(),
    createNewUser: jest.fn(),
    getDetailCompanyByUserId: jest.fn(),
    getDetailUserById: jest.fn(),
    UpdateUserService: jest.fn(),
    updateCompanyService: jest.fn(),
}));
jest.mock("../../util/CommonUtils", () => ({
    __esModule: true,
    default: { getBase64: jest.fn() },
}));
jest.mock("../../util/fetch", () => ({
    useFetchAllcode: (type) => ({ data: type === "GENDER"
        ? [{ code: "F", value: "Nữ" }, { code: "M", value: "Nam" }]
        : [{ code: "EMPLOYER", value: "Nhân viên" }]
    }),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-datepicker", () => ({ selected, onChange }) => (
    <input
        aria-label="Ngày sinh"
        value={selected ? new Date(selected).toISOString().slice(0, 10) : ""}
        onChange={(event) => onChange(new Date(`${event.target.value}T00:00:00Z`))}
    />
));
jest.mock("react-image-lightbox", () => (props) => (
    <button type="button" data-testid="lightbox" onClick={props.onCloseRequest}>{props.mainSrc}</button>
));
jest.mock("react-markdown-editor-lite", () => ({ value, onChange }) => (
    <textarea
        aria-label="Giới thiệu công ty"
        value={value}
        onChange={(event) => onChange({ text: event.target.value, html: `<p>${event.target.value}</p>` })}
    />
));
jest.mock("markdown-it", () => function MarkdownIt() { return { render: (text) => `<p>${text}</p>` }; });
jest.mock("reactstrap", () => ({
    Modal: ({ children, isOpen }) => isOpen ? <div data-testid="loading">{children}</div> : null,
    Spinner: () => <span>loading</span>,
}));

const userDetail = {
    phonenumber: "0911222333",
    userAccountData: {
        id: 90,
        firstName: "Mai",
        lastName: "Lê",
        address: "Huế",
        genderCode: "F",
        roleCode: "EMPLOYER",
        dob: Date.parse("2000-01-02T00:00:00Z"),
        image: "/mai.png",
        email: "mai@example.com",
    },
};

const companyDetail = {
    id: 44,
    name: "Công ty Cũ",
    phonenumber: "0909009009",
    address: "Hà Nội",
    thumbnail: "/logo.png",
    coverimage: "/cover.png",
    descriptionHTML: "<p>Giới thiệu cũ</p>",
    descriptionMarkdown: "Giới thiệu cũ",
    amountEmployer: 20,
    taxnumber: "TAX-44",
    website: "https://example.test",
    file: "/certificate.pdf",
};

describe("personal profile", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        URL.createObjectURL = jest.fn((file) => `blob:${file.name}`);
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 90, roleCode: "EMPLOYER" }));
        mockParams = {};
        getDetailUserById.mockResolvedValue({ errCode: 0, data: userDetail });
        UpdateUserService.mockResolvedValue({ errCode: 0, user: { id: 90, firstName: "Mới" } });
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it("loads the signed-in user and persists edited identity and DOB", async () => {
        const { container } = render(<UserInfo />);
        await act(async () => Promise.resolve());
        await waitFor(() => expect(container.querySelector('input[name="firstName"]')).toHaveValue("Mai"));
        expect(getDetailUserById).toHaveBeenCalledWith(90);
        expect(container.querySelector('input[name="phonenumber"]')).toBeDisabled();
        fireEvent.change(container.querySelector('input[name="firstName"]'), { target: { name: "firstName", value: "Mới" } });
        fireEvent.change(container.querySelector('input[name="lastName"]'), { target: { name: "lastName", value: "Lê Mới" } });
        fireEvent.change(container.querySelector('input[name="address"]'), { target: { name: "address", value: "Đà Nẵng" } });
        fireEvent.change(container.querySelector('select[name="genderCode"]'), { target: { name: "genderCode", value: "M" } });
        fireEvent.change(container.querySelector('input[name="email"]'), { target: { name: "email", value: "new@example.com" } });
        fireEvent.change(screen.getByLabelText("Ngày sinh"), { target: { value: "2001-03-04" } });
        CommonUtils.getBase64.mockResolvedValue("data:image/png;base64,AVATAR");
        const avatar = new File(["avatar"], "avatar.png", { type: "image/png" });
        fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [avatar] } });
        await act(async () => Promise.resolve());
        fireEvent.click(container.querySelector(".box-img-preview"));
        expect(screen.getByTestId("lightbox")).toHaveTextContent("blob:avatar.png");
        fireEvent.click(screen.getByTestId("lightbox"));
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await act(async () => Promise.resolve());
        expect(UpdateUserService).toHaveBeenCalledWith({
            id: 90,
            firstName: "Mới",
            lastName: "Lê Mới",
            address: "Đà Nẵng",
            roleCode: "EMPLOYER",
            genderCode: "M",
            dob: Date.parse("2001-03-04T00:00:00Z"),
            image: "data:image/png;base64,AVATAR",
            email: "new@example.com",
        });
        expect(JSON.parse(localStorage.getItem("userData"))).toEqual({ id: 90, firstName: "Mới" });
        expect(toast.success).toHaveBeenCalledWith("Cập nhật người dùng thành công");
    });

    it("opens and closes the saved avatar preview", async () => {
        const { container } = render(<UserInfo />);
        await act(async () => Promise.resolve());
        await waitFor(() => expect(container.querySelector(".box-img-preview")).toHaveStyle({ backgroundImage: "url(/mai.png)" }));
        fireEvent.click(container.querySelector(".box-img-preview"));
        expect(screen.getByTestId("lightbox")).toHaveTextContent("/mai.png");
        fireEvent.click(screen.getByTestId("lightbox"));
        expect(screen.queryByTestId("lightbox")).not.toBeInTheDocument();
    });

    it("surfaces a profile update failure without replacing the current session", async () => {
        UpdateUserService.mockResolvedValue({ errCode: 1, errMessage: "Email đã tồn tại" });
        render(<UserInfo />);
        await act(async () => Promise.resolve());
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await act(async () => Promise.resolve());
        expect(toast.error).toHaveBeenCalledWith("Email đã tồn tại");
        expect(JSON.parse(localStorage.getItem("userData"))).toEqual({ id: 90, roleCode: "EMPLOYER" });
    });
});

describe("company profile", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        URL.createObjectURL = jest.fn((file) => `blob:${file.name}`);
        localStorage.clear();
        mockParams = {};
        CommonUtils.getBase64.mockImplementation((file) => Promise.resolve(`data:${file.name}`));
        createCompanyService.mockResolvedValue({ errCode: 0, companyId: 44 });
        updateCompanyService.mockResolvedValue({ errCode: 0, errMessage: "Đã cập nhật công ty" });
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it("creates a company and upgrades the current account with its company id", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7, roleCode: "CANDIDATE" }));
        getDetailCompanyByUserId.mockResolvedValue({ errCode: 1 });
        const { container } = render(<AddCompany />);
        await act(async () => Promise.resolve());
        const values = {
            name: "Công ty Mới",
            phonenumber: "0912345678",
            taxnumber: "TAX-NEW",
            amountEmployer: "12",
            address: "Đà Nẵng",
            website: "https://new.example",
        };
        Object.entries(values).forEach(([name, value]) => {
            fireEvent.change(container.querySelector(`input[name="${name}"]`), { target: { name, value } });
        });
        const certificate = new File(["certificate"], "new-company.pdf", { type: "application/pdf" });
        fireEvent.change(container.querySelector('input[accept=".pdf"]'), { target: { files: [certificate] } });
        await act(async () => Promise.resolve());
        fireEvent.change(screen.getByLabelText("Giới thiệu công ty"), { target: { value: "Môi trường tốt" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await act(async () => Promise.resolve());
        expect(createCompanyService).toHaveBeenCalledWith({
            ...values,
            thumbnail: "",
            coverimage: "",
            descriptionHTML: "<p>Môi trường tốt</p>",
            descriptionMarkdown: "Môi trường tốt",
            userId: 7,
            file: "data:new-company.pdf",
        });
        act(() => jest.advanceTimersByTime(1000));
        expect(toast.success).toHaveBeenCalledWith("Tạo mới công ty thành công");
        expect(JSON.parse(localStorage.getItem("userData"))).toEqual({ id: 7, roleCode: "COMPANY", companyId: 44 });
    });

    it("loads and updates the current company while rejecting an oversized certificate", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7, roleCode: "COMPANY", companyId: 44 }));
        getDetailCompanyByUserId.mockResolvedValue({ errCode: 0, data: companyDetail });
        const { container } = render(<AddCompany />);
        await act(async () => Promise.resolve());
        await waitFor(() => expect(container.querySelector('input[name="name"]')).toHaveValue("Công ty Cũ"));
        const certificate = container.querySelector('input[accept=".pdf"]');
        const tooLarge = new File(["x"], "large.pdf", { type: "application/pdf" });
        Object.defineProperty(tooLarge, "size", { value: 2097153 });
        fireEvent.change(certificate, { target: { files: [tooLarge] } });
        expect(toast.error).toHaveBeenCalledWith("File của bạn quá lớn. Chỉ gửi file dưới 2MB");
        expect(CommonUtils.getBase64).not.toHaveBeenCalled();

        const logo = new File(["logo"], "logo-new.png", { type: "image/png" });
        const cover = new File(["cover"], "cover-new.png", { type: "image/png" });
        const certificateOk = new File(["certificate"], "certificate.pdf", { type: "application/pdf" });
        fireEvent.change(container.querySelector('input[name="image"]'), { target: { name: "image", files: [logo] } });
        await act(async () => Promise.resolve());
        fireEvent.change(container.querySelector('input[name="coverImage"][accept="image/*"]'), { target: { name: "coverImage", files: [cover] } });
        await act(async () => Promise.resolve());
        fireEvent.change(certificate, { target: { files: [certificateOk] } });
        await act(async () => Promise.resolve());
        fireEvent.click(container.querySelector('div[name="review"]'));
        expect(screen.getByTestId("lightbox")).toHaveTextContent("blob:logo-new.png");
        fireEvent.click(screen.getByTestId("lightbox"));
        fireEvent.click(container.querySelector('div[name="cover"]'));
        expect(screen.getByTestId("lightbox")).toHaveTextContent("data:cover-new.png");
        fireEvent.click(screen.getByTestId("lightbox"));

        fireEvent.change(container.querySelector('input[name="name"]'), { target: { name: "name", value: "Công ty Đã sửa" } });
        fireEvent.change(screen.getByLabelText("Giới thiệu công ty"), { target: { value: "Giới thiệu mới" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await act(async () => Promise.resolve());
        expect(updateCompanyService).toHaveBeenCalledWith({
            name: "Công ty Đã sửa",
            phonenumber: "0909009009",
            address: "Hà Nội",
            thumbnail: "data:logo-new.png",
            coverimage: "data:cover-new.png",
            descriptionHTML: "<p>Giới thiệu mới</p>",
            descriptionMarkdown: "Giới thiệu mới",
            amountEmployer: 20,
            taxnumber: "TAX-44",
            website: "https://example.test",
            id: 44,
            file: "data:certificate.pdf",
        });
        expect(toast.success).toHaveBeenCalledWith("Đã cập nhật công ty");
    });

    it("returns to the previous screen and reports a company update error", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7, roleCode: "COMPANY", companyId: 44 }));
        getDetailCompanyByUserId.mockResolvedValue({ errCode: 0, data: companyDetail });
        updateCompanyService.mockResolvedValue({ errCode: 1, errMessage: "Mã số thuế đã tồn tại" });
        render(<AddCompany />);
        await act(async () => Promise.resolve());
        fireEvent.click(screen.getByText("Quay lại"));
        expect(mockNavigate).toHaveBeenCalledWith(-1);
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await act(async () => Promise.resolve());
        expect(toast.error).toHaveBeenCalledWith("Mã số thuế đã tồn tại");
    });

    it("renders an administrator's company view as read-only", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        mockParams = { id: "44" };
        getDetailCompanyByUserId.mockResolvedValue({ errCode: 0, data: companyDetail });
        const { container } = render(<AddCompany />);
        await act(async () => Promise.resolve());
        expect(await screen.findByText("Xem thông tin công ty")).toBeInTheDocument();
        expect(getDetailCompanyByUserId).toHaveBeenCalledWith(null, "44");
        expect(container.querySelector('input[name="name"]')).toBeDisabled();
        expect(screen.queryByRole("button", { name: "Lưu" })).not.toBeInTheDocument();
    });
});
