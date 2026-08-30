import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Modal as AntModal } from "antd";
import { toast } from "react-toastify";
import {
    acceptPostService,
    activePostService,
    banPostService,
    createPostService,
    getAllPostByAdminService,
    getAllPostByRoleAdminService,
    getDetailCompanyByUserId,
    getDetailPostByIdService,
    getListNoteByPost,
    reupPostService,
    updatePostService,
} from "../../service/userService";
import ManagePost from "./Post/ManagePost";
import NotePost from "./Post/NotePost";
import AddPost from "./Post/AddPost";

let mockParams = {};
const mockNavigate = jest.fn();

jest.mock("xlsx/xlsx.mjs", () => ({
    utils: { book_new: jest.fn(), json_to_sheet: jest.fn(), book_append_sheet: jest.fn() },
    writeFile: jest.fn(),
}));
jest.mock("react-router-dom", () => ({
    Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
}));
jest.mock("../../service/userService", () => ({
    acceptPostService: jest.fn(),
    activePostService: jest.fn(),
    banPostService: jest.fn(),
    createPostService: jest.fn(),
    getAllPostByAdminService: jest.fn(),
    getAllPostByRoleAdminService: jest.fn(),
    getDetailCompanyByUserId: jest.fn(),
    getDetailPostByIdService: jest.fn(),
    getListNoteByPost: jest.fn(),
    reupPostService: jest.fn(),
    updatePostService: jest.fn(),
}));
jest.mock("../../util/fetch", () => ({
    useFetchAllcode: (type) => ({ data: [{ code: `${type}-1`, value: `${type} label` }] }),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-paginate", () => (props) => (
    <button type="button" data-testid="next-page" onClick={() => props.onPageChange({ selected: 1 })}>page</button>
));
jest.mock("react-datepicker", () => ({ selected, onChange, disabled }) => (
    <input
        aria-label="Ngày kết thúc"
        disabled={disabled}
        value={selected ? new Date(selected).toISOString().slice(0, 10) : ""}
        onChange={(event) => onChange(new Date(`${event.target.value}T00:00:00Z`))}
    />
));
jest.mock("react-markdown-editor-lite", () => ({ value, onChange }) => (
    <textarea
        aria-label="Mô tả công việc"
        value={value}
        onChange={(event) => onChange({ text: event.target.value, html: `<p>${event.target.value}</p>` })}
    />
));
jest.mock("markdown-it", () => function MarkdownIt() { return { render: (text) => `<p>${text}</p>` }; });
jest.mock("reactstrap", () => ({
    Modal: ({ children, isOpen }) => isOpen ? <div data-testid="loading">{children}</div> : null,
    Spinner: () => <span>loading</span>,
}));
jest.mock("../../components/modal/NoteModal", () => ({ isOpen, id, handleFunc, onHide }) => isOpen ? (
    <div role="dialog" aria-label="Ghi chú kiểm duyệt">
        <button type="button" onClick={() => handleFunc(id, "Lý do kiểm duyệt")}>Gửi ghi chú</button>
        <button type="button" onClick={onHide}>Đóng</button>
    </div>
) : null);
jest.mock("../../components/modal/ReupPostModal", () => ({ isOpen, handleFunc, onHide }) => isOpen ? (
    <div role="dialog" aria-label="Đăng lại bài">
        <button type="button" onClick={() => handleFunc(Date.parse("2031-01-01T00:00:00Z"))}>Xác nhận đăng lại</button>
        <button type="button" onClick={onHide}>Đóng</button>
    </div>
) : null);
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
        <select aria-label="Trạng thái bài" defaultValue={defaultValue} onChange={(event) => onChange(event.target.value)}>
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    );
    return {
        Input: { Search },
        Select,
        Col: ({ children }) => <div>{children}</div>,
        Row: ({ children }) => <div>{children}</div>,
        Modal: { confirm: jest.fn((options) => options.onOk()) },
    };
});
jest.mock("@ant-design/icons", () => ({ ExclamationCircleOutlined: () => null }));

const post = (statusCode = "PS3") => ({
    id: 55,
    timeEnd: Date.parse("2030-01-01T00:00:00Z"),
    statusCode,
    statusPostData: {
        code: statusCode,
        value: statusCode === "PS1" ? "Đã duyệt" : statusCode === "PS4" ? "Đã chặn" : "Chờ duyệt",
    },
    postDetailData: { name: "Kỹ sư Backend" },
    userPostData: { firstName: "An", lastName: "Trần", userCompanyData: { name: "Công ty Sao" } },
});

describe("post administration", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        mockParams = {};
        AntModal.confirm.mockImplementation((options) => options.onOk());
        getAllPostByRoleAdminService.mockResolvedValue({ errCode: 0, count: 7, data: [post()] });
        acceptPostService.mockResolvedValue({ errCode: 0, errMessage: "Đã kiểm duyệt" });
        banPostService.mockResolvedValue({ errCode: 0, errMessage: "Đã chặn" });
        activePostService.mockResolvedValue({ errCode: 0, errMessage: "Đã mở lại" });
    });

    it("normalizes admin searches, filters by moderation state and paginates", async () => {
        render(<ManagePost />);
        expect(await screen.findByText("Kỹ sư Backend")).toBeInTheDocument();
        expect(screen.getByText("Công ty Sao")).toBeInTheDocument();
        const input = screen.getByLabelText("Nhập tên hoặc mã bài đăng, tên công ty");
        fireEvent.change(input, { target: { value: "  backend   sao " } });
        fireEvent.click(screen.getByRole("button", { name: "Tìm kiếm" }));
        await waitFor(() => expect(getAllPostByRoleAdminService).toHaveBeenLastCalledWith({
            limit: 5, offset: 0, search: "backend sao", censorCode: "PS3",
        }));
        fireEvent.change(screen.getByLabelText("Trạng thái bài"), { target: { value: "PS1" } });
        await waitFor(() => expect(getAllPostByRoleAdminService).toHaveBeenLastCalledWith(expect.objectContaining({ censorCode: "PS1" })));
        fireEvent.click(screen.getByTestId("next-page"));
        await waitFor(() => expect(getAllPostByRoleAdminService).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5 })));
    });

    it("opens a post-focused route with an exact id and no moderation filter", async () => {
        mockParams = { id: "55" };
        getAllPostByAdminService.mockResolvedValue({ errCode: 0, count: 1, data: [post()] });
        render(<ManagePost />);
        expect(await screen.findByText("Kỹ sư Backend")).toBeInTheDocument();
        expect(getAllPostByAdminService).toHaveBeenCalledWith({
            limit: 5, offset: 0, search: "55", censorCode: "",
        });
    });

    it.each([
        ["PS3", "Duyệt", acceptPostService, { id: 55, statusCode: "PS1", note: "", userId: 1 }],
        ["PS3", "Từ chối", acceptPostService, { id: 55, statusCode: "PS2", note: "Lý do kiểm duyệt", userId: 1 }],
        ["PS1", "Chặn", banPostService, { postId: 55, note: "Lý do kiểm duyệt", userId: 1 }],
        ["PS4", "Mở lại", activePostService, { id: 55, note: "Lý do kiểm duyệt", userId: 1 }],
    ])("handles %s posts through the %s moderation action", async (status, action, service, payload) => {
        getAllPostByRoleAdminService.mockResolvedValue({ errCode: 0, count: 1, data: [post(status)] });
        render(<ManagePost />);
        fireEvent.click(await screen.findByText(action));
        if (action !== "Duyệt") fireEvent.click(screen.getByRole("button", { name: "Gửi ghi chú" }));
        await waitFor(() => expect(service).toHaveBeenCalledWith(payload));
        expect(toast.success).toHaveBeenCalled();
        expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(2);
    });

    it("shows a moderation API error without pretending to refresh the list", async () => {
        acceptPostService.mockResolvedValue({ errCode: 1, errMessage: "Không thể duyệt bài" });
        render(<ManagePost />);
        fireEvent.click(await screen.findByText("Duyệt"));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không thể duyệt bài"));
        expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(1);
    });

    it("uses the company-scoped list and exposes CV/edit actions to an employer", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 8, roleCode: "EMPLOYER", companyId: 9 }));
        getAllPostByAdminService.mockResolvedValue({ errCode: 0, count: 1, data: [post("PS1")] });
        render(<ManagePost />);
        expect(await screen.findByText("Xem CV nộp")).toHaveAttribute("href", "/admin/list-cv/55/");
        expect(screen.getByText("Sửa")).toHaveAttribute("href", "/admin/edit-post/55/");
        expect(getAllPostByAdminService).toHaveBeenCalledWith(expect.objectContaining({ companyId: 9 }));
        fireEvent.click(screen.getByTestId("next-page"));
        await waitFor(() => expect(getAllPostByAdminService).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 9, offset: 5 })));
        expect(screen.queryByText("Chặn")).not.toBeInTheDocument();
    });
});

describe("post notes", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        mockParams = { id: "55" };
        getListNoteByPost.mockResolvedValue({ errCode: 0, count: 8, data: [{
            id: 3,
            note: "Cần bổ sung mức lương",
            createdAt: "2026-08-20T08:00:00Z",
            userNoteData: { id: 1, firstName: "Admin", lastName: "One" },
        }] });
    });

    it("loads, paginates and returns from a post's moderation notes", async () => {
        render(<NotePost />);
        expect(await screen.findByText("Cần bổ sung mức lương")).toBeInTheDocument();
        expect(getListNoteByPost).toHaveBeenCalledWith({ limit: 5, offset: 0, id: "55" });
        fireEvent.click(screen.getByTestId("next-page"));
        await waitFor(() => expect(getListNoteByPost).toHaveBeenLastCalledWith({ limit: 5, offset: 5, id: "55" }));
        fireEvent.click(screen.getByText("Quay lại"));
        expect(mockNavigate).toHaveBeenCalledWith(-1);
    });
});

const detailPost = {
    id: 55,
    timeEnd: Date.parse("2020-01-01T00:00:00Z"),
    postDetailData: {
        name: "Bài cũ",
        amount: 4,
        descriptionHTML: "<p>Mô tả cũ</p>",
        descriptionMarkdown: "Mô tả cũ",
        jobTypePostData: { code: "JOBTYPE-1" },
        provincePostData: { code: "PROVINCE-1" },
        salaryTypePostData: { code: "SALARYTYPE-1" },
        jobLevelPostData: { code: "JOBLEVEL-1" },
        workTypePostData: { code: "WORKTYPE-1" },
        expTypePostData: { code: "EXPTYPE-1" },
        genderPostData: { code: "GENDERPOST-1" },
    },
};

describe("post editor", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 8, roleCode: "EMPLOYER", companyId: 9 }));
        mockParams = {};
        getDetailCompanyByUserId.mockResolvedValue({ errCode: 0, data: { allowPost: 3, allowHotPost: 1 } });
        createPostService.mockResolvedValue({ errCode: 0, errMessage: "Đã tạo bài" });
        updatePostService.mockResolvedValue({ errCode: 0, errMessage: "Đã sửa bài" });
        reupPostService.mockResolvedValue({ errCode: 0, errMessage: "Đã đăng lại" });
    });

    afterEach(() => {
        act(() => jest.runOnlyPendingTimers());
        jest.useRealTimers();
    });

    it("creates a post with all default classification fields, content, expiry and featured flag", async () => {
        const { container } = render(<AddPost />);
        expect(await screen.findByText("3 bài bình thường")).toBeInTheDocument();
        fireEvent.change(container.querySelector('input[name="name"]'), { target: { name: "name", value: "Backend Engineer" } });
        fireEvent.change(container.querySelector('input[name="amount"]'), { target: { name: "amount", value: "2" } });
        fireEvent.change(screen.getByLabelText("Ngày kết thúc"), { target: { value: "2030-01-02" } });
        fireEvent.change(screen.getByLabelText("Mô tả công việc"), { target: { value: "Xây dựng API" } });
        fireEvent.click(container.querySelector('input[type="checkbox"]'));
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await act(async () => Promise.resolve());
        expect(createPostService).toHaveBeenCalledWith({
            name: "Backend Engineer",
            descriptionHTML: "<p>Xây dựng API</p>",
            descriptionMarkdown: "Xây dựng API",
            categoryJobCode: "JOBTYPE-1",
            addressCode: "PROVINCE-1",
            salaryJobCode: "SALARYTYPE-1",
            amount: "2",
            timeEnd: Date.parse("2030-01-02T00:00:00Z"),
            categoryJoblevelCode: "JOBLEVEL-1",
            categoryWorktypeCode: "WORKTYPE-1",
            experienceJobCode: "EXPTYPE-1",
            genderPostCode: "GENDERPOST-1",
            userId: 8,
            isHot: 1,
        });
        act(() => jest.advanceTimersByTime(1000));
        expect(toast.success).toHaveBeenCalledWith("Đã tạo bài");
    });

    it("rejects a new post whose expiry is in the past before calling the API", async () => {
        render(<AddPost />);
        await screen.findByText("3 bài bình thường");
        fireEvent.change(screen.getByLabelText("Ngày kết thúc"), { target: { value: "2020-01-01" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        expect(toast.error).toHaveBeenCalledWith("Ngày kết thúc phải hơn ngày hiện tại");
        expect(createPostService).not.toHaveBeenCalled();
    });

    it("loads and updates an existing post, then re-publishes an expired one", async () => {
        mockParams = { id: "55" };
        getDetailPostByIdService.mockResolvedValue({ errCode: 0, data: detailPost });
        const { container } = render(<AddPost />);
        expect(await screen.findByText("Cập nhật bài đăng")).toBeInTheDocument();
        await waitFor(() => expect(container.querySelector('input[name="name"]')).toHaveValue("Bài cũ"));
        fireEvent.change(container.querySelector('input[name="name"]'), { target: { name: "name", value: "Bài mới" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await act(async () => Promise.resolve());
        expect(updatePostService).toHaveBeenCalledWith(expect.objectContaining({
            id: 55, userId: 8, name: "Bài mới", timeEnd: detailPost.timeEnd,
        }));
        act(() => jest.advanceTimersByTime(1000));
        expect(toast.success).toHaveBeenCalledWith("Đã sửa bài");

        fireEvent.click(screen.getByRole("button", { name: "Đăng lại" }));
        fireEvent.click(screen.getByRole("button", { name: "Xác nhận đăng lại" }));
        await waitFor(() => expect(reupPostService).toHaveBeenCalledWith({
            userId: 8, postId: "55", timeEnd: Date.parse("2031-01-01T00:00:00Z"),
        }));
    });

    it("renders an existing post read-only for an administrator", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        mockParams = { id: "55" };
        getDetailPostByIdService.mockResolvedValue({ errCode: 0, data: detailPost });
        const { container } = render(<AddPost />);
        expect(await screen.findByText("Xem thông tin bài đăng")).toBeInTheDocument();
        expect(container.querySelector('input[name="name"]')).toBeDisabled();
        expect(screen.queryByRole("button", { name: "Lưu" })).not.toBeInTheDocument();
    });
});
