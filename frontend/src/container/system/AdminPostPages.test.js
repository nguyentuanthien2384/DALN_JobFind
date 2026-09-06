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
    const Select = ({ options = [], onChange, defaultValue = "", value, disabled }) => (
        <select aria-label="Trạng thái bài" disabled={disabled} {...(value === undefined ? { defaultValue } : { value })} onChange={(event) => onChange(event.target.value)}>
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
    editRevision: 'jv1-' + 'a'.repeat(64),
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

    it.each([{ errCode: 4, conflict: true }, { errCode: -1, httpStatus: 409, errorType: 'conflict' },
        { errCode: 1, httpStatus: 428 }, { errCode: -1, errorType: 'timeout' }, { errCode: -1, errorType: 'network' },
        { errCode: -1, httpStatus: 502, errorType: 'unavailable' }])('requires explicit reread after moderation conflict/uncertain outcome: %j', async response => {
        acceptPostService.mockResolvedValueOnce(response);
        render(<ManagePost />);
        fireEvent.click(await screen.findByText('Duyệt'));
        await screen.findByRole('alert');
        expect(screen.getByRole('button', { name: 'Duyệt' })).toBeDisabled();
        expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
        expect(acceptPostService).toHaveBeenCalledTimes(1);
        const latest = { ...post(), editRevision: 'jv1-' + 'b'.repeat(64) };
        getAllPostByRoleAdminService.mockResolvedValueOnce({ errCode: 0, count: 1, data: [latest] });
        fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Duyệt' })).toBeEnabled());
        expect(acceptPostService).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
        await waitFor(() => expect(acceptPostService).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: latest.editRevision }), {}));
    });

    it('disables moderation when a server has no revision instead of silently sending an unguarded decision', async () => {
        getAllPostByRoleAdminService.mockResolvedValueOnce({ errCode: 0, count: 1, data: [{ ...post(), editRevision: undefined }] });
        render(<ManagePost />);
        await screen.findByRole('alert');
        fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
        expect(acceptPostService).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Từ chối' })).toBeDisabled();
    });

    it('holds a single in-flight moderation and ignores duplicate confirmation callbacks', async () => {
        let finish;
        acceptPostService.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        render(<ManagePost />);
        fireEvent.click(await screen.findByText('Duyệt'));
        const confirmation = AntModal.confirm.mock.calls[0][0];
        await act(async () => confirmation.onOk());
        expect(acceptPostService).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Duyệt' })).toBeDisabled();
        await act(async () => finish({ errCode: 0, changed: true }));
        await waitFor(() => expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(2));
        await act(async () => confirmation.onOk());
        expect(acceptPostService).toHaveBeenCalledTimes(1);
    });

    it('ignores old list and confirmation responses after the filter changes', async () => {
        AntModal.confirm.mockImplementation(() => {});
        render(<ManagePost />);
        fireEvent.click(await screen.findByText('Duyệt'));
        const confirmation = AntModal.confirm.mock.calls[0][0];
        let finishOld;
        getAllPostByRoleAdminService.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
        fireEvent.change(screen.getByLabelText('Trạng thái bài'), { target: { value: 'PS1' } });
        getAllPostByRoleAdminService.mockResolvedValueOnce({ errCode: 0, count: 1, data: [post('PS4')] });
        fireEvent.change(screen.getByLabelText('Trạng thái bài'), { target: { value: 'PS4' } });
        await screen.findByText('Mở lại');
        await act(async () => finishOld({ errCode: 0, count: 1, data: [post('PS1')] }));
        await act(async () => confirmation.onOk());
        expect(screen.getByText('Mở lại')).toBeInTheDocument();
        expect(screen.queryByText('Chặn')).not.toBeInTheDocument();
        expect(acceptPostService).not.toHaveBeenCalled();
    });

    it('failed reload does not leave old rows available for a moderation decision', async () => {
        getAllPostByRoleAdminService.mockResolvedValueOnce({ errCode: -1, errMessage: 'Không đọc được dữ liệu' });
        render(<ManagePost />);
        await screen.findByRole('alert');
        expect(screen.queryByText('Duyệt')).not.toBeInTheDocument();
        expect(acceptPostService).not.toHaveBeenCalled();
    });

    it("opens a post-focused route with an exact id and no moderation filter", async () => {
        mockParams = { id: "55" };
        getAllPostByAdminService.mockResolvedValue({ errCode: 0, count: 1, data: [post()] });
        render(<ManagePost />);
        expect(await screen.findByText("Kỹ sư Backend")).toBeInTheDocument();
        expect(getAllPostByRoleAdminService).toHaveBeenCalledWith({
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
        await waitFor(() => expect(service).toHaveBeenCalledWith({ ...payload, expectedRevision: post().editRevision }, {}));
        expect(toast.success).toHaveBeenCalled();
        await waitFor(() => expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(2));
    });

    it("does not expose the edit action for a blocked post", async () => {
        getAllPostByRoleAdminService.mockResolvedValue({
            errCode: 0,
            count: 1,
            data: [post("PS4")],
        });

        render(<ManagePost />);

        expect(await screen.findByText("Mở lại")).toBeInTheDocument();
        expect(screen.queryByText("Xem chi tiết")).not.toBeInTheDocument();
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
    editRevision: 'jv1-' + 'a'.repeat(64),
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
    const loadEditor = async (data = detailPost) => {
        mockParams = { id: '55' };
        getDetailPostByIdService.mockReset().mockResolvedValue({ errCode: 0, data });
        const rendered = render(<AddPost />);
        await waitFor(() => expect(rendered.container.querySelector('input[name="name"]')).toHaveValue('Bài cũ'));
        const name = rendered.container.querySelector('input[name="name"]');
        fireEvent.change(name, { target: { name: 'name', value: 'Bản nháp cần giữ' } });
        return { ...rendered, name, save: () => fireEvent.click(screen.getByRole('button', { name: 'Lưu' })) };
    };

    it.each([
        { errCode: 4, conflict: true }, { errCode: -1, errorType: 'conflict', httpStatus: 409 },
        { errCode: -1, errorType: 'network' }, { errCode: -1, errorType: 'timeout' },
        { errCode: -1, errorType: 'server' }, { errCode: 0 }, null
    ])('keeps draft and blocks retries after conflict/uncertain result or missing success revision: %j', async response => {
        updatePostService.mockResolvedValueOnce(response);
        const { name, save } = await loadEditor();
        save();
        await screen.findByRole('alert');
        expect(name).toHaveValue('Bản nháp cần giữ');
        expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
        save();
        expect(updatePostService).toHaveBeenCalledTimes(1);
        expect(getDetailPostByIdService).toHaveBeenCalledTimes(1);
        expect(createPostService).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Tải lại tin' }));
        expect(screen.getByRole('alertdialog', { name: 'Xác nhận tải lại tin' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Giữ biểu mẫu' }));
        expect(name).toHaveValue('Bản nháp cần giữ');
        expect(getDetailPostByIdService).toHaveBeenCalledTimes(1);
    });

    it('reloads only after explicit discard confirmation and saves with the newly read revision', async () => {
        updatePostService.mockResolvedValueOnce({ errCode: -1, errorType: 'conflict' });
        const { name, save } = await loadEditor();
        save(); await screen.findByRole('alert');
        const revision = 'jv1-' + 'c'.repeat(64);
        getDetailPostByIdService.mockResolvedValueOnce({ errCode: 0, data: { ...detailPost, editRevision: revision,
            postDetailData: { ...detailPost.postDetailData, name: 'Nội dung người khác đã lưu' } } });
        fireEvent.click(screen.getByRole('button', { name: 'Tải lại tin' }));
        fireEvent.click(screen.getByRole('button', { name: 'Bỏ phần chưa lưu và tải lại' }));
        await waitFor(() => expect(name).toHaveValue('Nội dung người khác đã lưu'));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        save();
        await waitFor(() => expect(updatePostService).toHaveBeenCalledTimes(2));
        expect(updatePostService).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: revision }), {});
    });

    it('uses the revision returned by a successful save and prevents overlapping requests', async () => {
        let finish;
        updatePostService.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const { save } = await loadEditor();
        save(); save();
        expect(updatePostService).toHaveBeenCalledTimes(1);
        const revision = 'jv1-' + 'd'.repeat(64);
        await act(async () => finish({ errCode: 0, changed: false, editRevision: revision }));
        save();
        await waitFor(() => expect(updatePostService).toHaveBeenCalledTimes(2));
        expect(updatePostService).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: revision }), {});
        expect(getDetailPostByIdService).toHaveBeenCalledTimes(1);
    });

    it('ignores an old save response after switching to a different job', async () => {
        let finish;
        updatePostService.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const { save, rerender, name } = await loadEditor();
        save();
        mockParams = { id: '56' };
        getDetailPostByIdService.mockResolvedValueOnce({ errCode: 0, data: { ...detailPost, id: 56,
            postDetailData: { ...detailPost.postDetailData, name: 'Tin khác' } } });
        rerender(<AddPost />);
        await waitFor(() => expect(name).toHaveValue('Tin khác'));
        await act(async () => finish({ errCode: -1, errorType: 'conflict' }));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(name).toHaveValue('Tin khác');
        save();
        await waitFor(() => expect(updatePostService).toHaveBeenLastCalledWith(expect.objectContaining({ id: 56,
            expectedRevision: detailPost.editRevision }), {}));
    });

    it('never silently submits an unguarded edit when an old backend omits revision', async () => {
        const { save } = await loadEditor({ ...detailPost, editRevision: undefined });
        expect(screen.getByRole('alert')).toHaveTextContent('Chưa có thông tin phiên bản');
        save(); expect(updatePostService).not.toHaveBeenCalled();
    });

    it('keeps edits enabled after a definite validation rejection and retains the original revision', async () => {
        updatePostService.mockResolvedValueOnce({ errCode: 1, errMessage: 'Missing required parameters' });
        const { save } = await loadEditor();
        save(); await waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
        save(); await waitFor(() => expect(updatePostService).toHaveBeenCalledTimes(2));
        expect(updatePostService).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: detailPost.editRevision }), {});
    });

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 8, roleCode: "EMPLOYER", companyId: 9 }));
        mockParams = {};
        getDetailCompanyByUserId.mockResolvedValue({ errCode: 0, data: { allowPost: 3, allowHotPost: 1 } });
        createPostService.mockResolvedValue({ errCode: 0, errMessage: "Đã tạo bài" });
        updatePostService.mockReset().mockResolvedValue({ errCode: 0, errMessage: "Đã sửa bài", changed: true, editRevision: 'jv1-' + 'b'.repeat(64) });
        reupPostService.mockResolvedValue({ errCode: 0, errMessage: "Đã đăng lại" });
    });

    afterEach(() => {
        act(() => jest.runOnlyPendingTimers());
        jest.useRealTimers();
    });

    it("creates a post with all default classification fields, content, expiry and featured flag", async () => {
        const { container } = render(<AddPost />);
        expect(await screen.findByText("3 bài bình thường")).toBeInTheDocument();
        expect(getDetailCompanyByUserId).toHaveBeenCalledWith(8, 9);
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
        await act(async () => {
            jest.advanceTimersByTime(1000);
            await Promise.resolve();
        });
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
        expect(screen.getByLabelText('Ngày kết thúc')).toBeDisabled();
        expect(screen.getByText('Ngày hết hạn giữ nguyên khi sửa tin. Muốn gia hạn, hãy dùng Đăng lại.')).toBeInTheDocument();
        await waitFor(() => expect(container.querySelector('input[name="name"]')).toHaveValue("Bài cũ"));
        fireEvent.change(container.querySelector('input[name="name"]'), { target: { name: "name", value: "Bài mới" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await act(async () => Promise.resolve());
        expect(updatePostService).toHaveBeenCalledWith(expect.objectContaining({
            id: 55, userId: 8, name: "Bài mới", timeEnd: detailPost.timeEnd, expectedRevision: detailPost.editRevision,
        }), {});
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
        expect(getDetailCompanyByUserId).not.toHaveBeenCalled();
        expect(container.querySelector('input[name="name"]')).toBeDisabled();
        expect(screen.queryByRole("button", { name: "Lưu" })).not.toBeInTheDocument();
    });

    it('preserves unknown raw codes and null joins instead of overwriting with dropdown defaults', async () => {
        mockParams = { id: '55' };
        getDetailPostByIdService.mockResolvedValue({ errCode: 0, data: { ...detailPost, statusCode: 'PS2', postDetailData: {
            ...detailPost.postDetailData, categoryJobCode: 'DELETED-CODE', jobTypePostData: null,
            addressCode: null, provincePostData: null, genderPostCode: 'OLD-GENDER', genderPostData: null
        } } });
        const { container } = render(<AddPost />);
        await waitFor(() => expect(container.querySelector('input[name="name"]')).toHaveValue('Bài cũ'));
        expect(container.querySelector('[name="categoryJobCode"]')).toHaveValue('DELETED-CODE');
        expect(container.querySelector('[name="addressCode"]')).toHaveValue('');
        expect(container.querySelector('[name="genderCode"]')).toHaveValue('OLD-GENDER');
        expect(screen.getByText('Trạng thái lúc tải: Bị từ chối')).toBeInTheDocument();
        expect(screen.getByText('Mã đang lưu: DELETED-CODE (không có trong danh mục)')).toBeInTheDocument();
    });
    it.each([
        { errCode: 0 }, { errCode: 403, errMessage: 'Không có quyền' },
        { errCode: 0, data: { ...detailPost, id: 56 } },
        { errCode: 0, data: { ...detailPost, postDetailData: null } }
    ])('failed/mismatched edit read never becomes a create or permits a write: %j', async response => {
        mockParams = { id: '55' };
        getDetailPostByIdService.mockResolvedValue(response);
        render(<AddPost />);
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
        expect(screen.queryByRole('button', { name: 'Đăng lại' })).not.toBeInTheDocument();
        expect(createPostService).not.toHaveBeenCalled(); expect(updatePostService).not.toHaveBeenCalled();
    });
    it('ignores an earlier response when navigating to another post and resets on a new-post route', async () => {
        mockParams = { id: '55' };
        let finishFirst;
        getDetailPostByIdService.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
        const { container, rerender } = render(<AddPost />);
        expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
        expect(createPostService).not.toHaveBeenCalled();
        mockParams = { id: '56' };
        getDetailPostByIdService.mockResolvedValue({ errCode: 0, data: { ...detailPost, id: 56, postDetailData: { ...detailPost.postDetailData, name: 'Tin mới nhất' } } });
        rerender(<AddPost />);
        await waitFor(() => expect(container.querySelector('input[name="name"]')).toHaveValue('Tin mới nhất'));
        await act(async () => finishFirst({ errCode: 0, data: detailPost }));
        expect(container.querySelector('input[name="name"]')).toHaveValue('Tin mới nhất');
        mockParams = {};
        rerender(<AddPost />);
        expect(container.querySelector('input[name="name"]')).toHaveValue('');
        expect(screen.getByText('Thêm mới bài đăng')).toBeInTheDocument();
    });
    it('shows malformed historical deadlines safely without allowing edit/repost', async () => {
        mockParams = { id: '55' };
        getDetailPostByIdService.mockResolvedValue({ errCode: 0, data: { ...detailPost, timeEnd: 'bad date' } });
        render(<AddPost />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Ngày hết hạn đang lưu không hợp lệ');
        expect(screen.getByLabelText('Ngày kết thúc')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Đăng lại' })).not.toBeInTheDocument();
    });
    it('displays removed status but never enables save/repost for PS4', async () => {
        mockParams = { id: '55' };
        getDetailPostByIdService.mockResolvedValue({ errCode: 0, data: { ...detailPost, statusCode: 'PS4' } });
        render(<AddPost />);
        expect(await screen.findByText('Trạng thái lúc tải: Đã gỡ hoặc bị chặn')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Đăng lại' })).not.toBeInTheDocument();
    });
});
