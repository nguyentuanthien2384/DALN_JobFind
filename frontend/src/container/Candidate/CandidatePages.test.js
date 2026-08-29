import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import { getAllListCvByUserIdService } from "../../service/cvService";
import {
    getAllSkillByJobCode,
    getDetailUserById,
    getFavoritePostByUserService,
    toggleFavoritePostService,
    UpdateUserService,
    UpdateUserSettingService,
} from "../../service/userService";
import { useFetchAllcode } from "../../util/fetch";
import CommonUtils from "../../util/CommonUtils";
import CandidateInfo from "./CandidateInfo";
import ManageCvCandidate from "./ManageCvCandidate";
import SavedJobs from "./SavedJobs";
import SettingUser from "./SettingUser";

jest.mock("../../service/cvService", () => ({
    getAllListCvByUserIdService: jest.fn(),
}));
jest.mock("../../service/userService", () => ({
    getDetailUserById: jest.fn(),
    UpdateUserService: jest.fn(),
    UpdateUserSettingService: jest.fn(),
    getAllSkillByJobCode: jest.fn(),
    getFavoritePostByUserService: jest.fn(),
    toggleFavoritePostService: jest.fn(),
}));
jest.mock("../../util/fetch", () => ({ useFetchAllcode: jest.fn() }));
jest.mock("../../util/CommonUtils", () => ({
    __esModule: true,
    default: { getBase64: jest.fn(), formatDate: jest.fn() },
}));
jest.mock("react-toastify", () => ({
    toast: { error: jest.fn(), success: jest.fn() },
}));
jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        Link: ({ to, children, ...props }) =>
            React.createElement("a", { href: to, ...props }, children),
        useParams: () => ({}),
    };
});
jest.mock("react-datepicker", () => (props) => (
    <input
        aria-label="Ngày sinh"
        value={props.selected instanceof Date ? props.selected.toISOString().slice(0, 10) : ""}
        onChange={(event) => props.onChange(new Date(`${event.target.value}T00:00:00`))}
    />
));
jest.mock("react-image-lightbox", () => (props) => (
    <div role="dialog" aria-label="Xem ảnh">
        <img src={props.mainSrc} alt="Ảnh xem trước" />
        <button type="button" onClick={props.onCloseRequest}>Đóng ảnh</button>
    </div>
));
jest.mock("antd", () => {
    const React = require("react");
    return {
        Select: ({ placeholder, options = [], onChange, mode, disabled, value }) =>
            React.createElement(
                "div",
                { "aria-label": placeholder, "data-value": JSON.stringify(value) },
                options.map((option) =>
                    React.createElement(
                        "button",
                        {
                            key: String(option.value),
                            type: "button",
                            disabled,
                            onClick: () =>
                                mode === "multiple"
                                    ? onChange([option.value], [option])
                                    : onChange(option.value, option),
                        },
                        `${placeholder}: ${option.label}`
                    )
                )
            ),
    };
});
jest.mock("react-paginate", () => (props) => (
    <div>
        <span data-testid="candidate-page-count">{props.pageCount}</span>
        <button type="button" onClick={() => props.onPageChange({ selected: 1 })}>
            Trang hồ sơ 2
        </button>
    </div>
));

const candidateDetail = (overrides = {}) => ({
    userAccountData: {
        id: 7,
        firstName: "Nguyễn",
        lastName: "An",
        address: "Đà Nẵng",
        genderCode: "M",
        roleCode: "CANDIDATE",
        dob: new Date("1995-04-03T00:00:00Z").getTime(),
        image: "/avatar.png",
        email: "an@example.test",
        userSettingData: {
            categoryJobCode: "IT",
            salaryJobCode: "SAL1",
            addressCode: "DN",
            experienceJobCode: "EXP1",
            isFindJob: 1,
            isTakeMail: 1,
            file: "data:application/pdf;base64,OLD",
            ...overrides.setting,
        },
    },
    phonenumber: "0909000000",
    listSkills: overrides.listSkills || [{ SkillId: 31 }],
});

const appliedCv = (id, checked = 0, name = "React Developer") => ({
    id,
    createdAt: new Date("2026-01-02T03:04:05Z").toISOString(),
    isChecked: checked,
    postCvData: {
        id: 90 + id,
        postDetailData: {
            name,
            jobTypePostData: { value: "Công nghệ" },
            jobLevelPostData: { value: "Senior" },
            provincePostData: { value: "Hà Nội" },
        },
    },
});

const favorite = (id, timeEnd, name) => ({
    createdAt: Date.now(),
    postFavoriteData: {
        id,
        timeEnd,
        userPostData: {
            userCompanyData: { thumbnail: "/company.png", name: "Sao Việt" },
        },
        postDetailData: {
            name,
            provincePostData: { value: "Hà Nội" },
            salaryTypePostData: { value: "Thỏa thuận" },
        },
    },
});

const allcodes = {
    GENDER: [
        { code: "M", value: "Nam" },
        { code: "F", value: "Nữ" },
    ],
    ROLE: [{ code: "CANDIDATE", value: "Ứng viên" }],
    PROVINCE: [
        { code: "DN", value: "Đà Nẵng" },
        { code: "HCM", value: "TP.HCM" },
    ],
    EXPTYPE: [
        { code: "EXP1", value: "1 năm" },
        { code: "EXP2", value: "2 năm" },
    ],
    SALARYTYPE: [
        { code: "SAL1", value: "10 triệu" },
        { code: "SAL2", value: "20 triệu" },
    ],
    JOBTYPE: [
        { code: "IT", value: "Công nghệ" },
        { code: "MKT", value: "Marketing" },
    ],
};

describe("CandidateInfo", () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 7 }));
        jest.clearAllMocks();
        useFetchAllcode.mockImplementation((type) => ({ data: allcodes[type] || [] }));
        getDetailUserById.mockResolvedValue({ errCode: 0, data: candidateDetail() });
        UpdateUserService.mockResolvedValue({
            errCode: 0,
            user: { id: 7, firstName: "Minh", roleCode: "CANDIDATE" },
        });
        CommonUtils.getBase64.mockResolvedValue("data:image/png;base64,NEW");
        URL.createObjectURL = jest.fn(() => "blob:new-avatar");
    });

    it("loads and renders the current candidate profile", async () => {
        render(<CandidateInfo />);

        expect(await screen.findByDisplayValue("Nguyễn")).toBeInTheDocument();
        expect(screen.getByDisplayValue("An")).toBeInTheDocument();
        expect(screen.getByDisplayValue("0909000000")).toBeDisabled();
        expect(screen.getByDisplayValue("an@example.test")).toBeInTheDocument();
        expect(getDetailUserById).toHaveBeenCalledWith(7);
    });

    it("updates edited fields, changed birthday and a newly encoded avatar", async () => {
        jest.useFakeTimers();
        render(<CandidateInfo />);
        await screen.findByDisplayValue("Nguyễn");
        fireEvent.change(screen.getByDisplayValue("Nguyễn"), {
            target: { name: "firstName", value: "Minh" },
        });
        fireEvent.change(screen.getByLabelText("Ngày sinh"), {
            target: { value: "2000-06-15" },
        });
        const file = new File(["avatar"], "avatar.png", { type: "image/png" });
        await act(async () => {
            fireEvent.change(screen.getByLabelText("Tải hình ảnh"), {
                target: { files: [file] },
            });
            await Promise.resolve();
        });
        fireEvent.click(screen.getByRole("button", { name: "Xem ảnh đại diện" }));
        expect(screen.getByRole("dialog", { name: "Xem ảnh" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Đóng ảnh" }));

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
            await Promise.resolve();
        });
        expect(UpdateUserService).toHaveBeenCalledWith({
            id: 7,
            firstName: "Minh",
            lastName: "An",
            address: "Đà Nẵng",
            roleCode: "CANDIDATE",
            genderCode: "M",
            dob: new Date("2000-06-15T00:00:00").getTime(),
            image: "data:image/png;base64,NEW",
            email: "an@example.test",
        });
        expect(toast.success).toHaveBeenCalledWith("Cập nhật người dùng thành công");
        expect(JSON.parse(localStorage.getItem("userData"))).toEqual(
            expect.objectContaining({ firstName: "Minh" })
        );
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it("sends null image and reports an update failure when the avatar is unchanged", async () => {
        UpdateUserService.mockResolvedValue({ errCode: 2, errMessage: "Email đã tồn tại" });
        render(<CandidateInfo />);
        await screen.findByDisplayValue("Nguyễn");
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

        await waitFor(() => expect(UpdateUserService).toHaveBeenCalled());
        expect(UpdateUserService).toHaveBeenCalledWith(
            expect.objectContaining({ image: null, dob: candidateDetail().userAccountData.dob })
        );
        expect(toast.error).toHaveBeenCalledWith("Email đã tồn tại");
    });
});

describe("SettingUser", () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 7 }));
        jest.clearAllMocks();
        useFetchAllcode.mockImplementation((type) => ({ data: allcodes[type] || [] }));
        getDetailUserById.mockResolvedValue({ errCode: 0, data: candidateDetail() });
        getAllSkillByJobCode.mockResolvedValue({
            data: [
                { id: 31, name: "React" },
                { id: 32, name: "Node.js" },
            ],
        });
        UpdateUserSettingService.mockResolvedValue({ errCode: 2, errMessage: "Không thể lưu" });
        CommonUtils.getBase64.mockResolvedValue("data:application/pdf;base64,CV");
    });

    it("loads settings, selected skills and the saved CV", async () => {
        render(<SettingUser />);

        expect(await screen.findByTitle("CV đã tải")).toHaveAttribute(
            "src",
            "data:application/pdf;base64,OLD"
        );
        expect(getDetailUserById).toHaveBeenCalledWith(7);
        expect(getAllSkillByJobCode).toHaveBeenCalledWith("IT");
        expect(screen.getByRole("checkbox", { name: "Bật tìm việc" })).toBeChecked();
        expect(screen.getByRole("checkbox", { name: "Nhận mail công việc" })).toBeChecked();
    });

    it("reloads skills when the job field changes and submits all settings", async () => {
        render(<SettingUser />);
        await screen.findByTitle("CV đã tải");
        fireEvent.click(screen.getByRole("button", { name: "Chọn lĩnh vực: Marketing" }));
        await waitFor(() => expect(getAllSkillByJobCode).toHaveBeenLastCalledWith("MKT"));
        fireEvent.click(await screen.findByRole("button", { name: "Chọn kĩ năng của bạn: Node.js" }));
        fireEvent.click(screen.getByRole("button", { name: "Chọn mức lương: 20 triệu" }));
        fireEvent.click(screen.getByRole("button", { name: "Chọn nơi làm việc: TP.HCM" }));
        fireEvent.click(screen.getByRole("button", { name: "Chọn khoảng kinh nghiệm: 2 năm" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "Bật tìm việc" }));
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

        await waitFor(() =>
            expect(UpdateUserSettingService).toHaveBeenCalledWith({
                id: 7,
                data: {
                    categoryJobCode: "MKT",
                    addressCode: "HCM",
                    experienceJobCode: "EXP2",
                    isTakeMail: 1,
                    isFindJob: 0,
                    file: "data:application/pdf;base64,OLD",
                    salaryJobCode: "SAL2",
                    listSkills: [32],
                },
            })
        );
        expect(toast.error).toHaveBeenCalledWith("Không thể lưu");
    });

    it("blocks dependent checkboxes until a CV and job preferences exist", async () => {
        getDetailUserById.mockResolvedValue({
            errCode: 0,
            data: candidateDetail({
                setting: {
                    categoryJobCode: "",
                    addressCode: "",
                    isFindJob: 0,
                    isTakeMail: 0,
                    file: "",
                },
                listSkills: [],
            }),
        });
        render(<SettingUser />);
        await waitFor(() => expect(getDetailUserById).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("checkbox", { name: "Bật tìm việc" }));
        expect(toast.error).toHaveBeenCalledWith(
            "Bạn cần đăng tải CV trước khi chọn tính năng này"
        );
        expect(screen.getByRole("checkbox", { name: "Bật tìm việc" })).not.toBeChecked();
        fireEvent.click(screen.getByRole("checkbox", { name: "Nhận mail công việc" }));
        expect(toast.error).toHaveBeenCalledWith(
            "Bạn cần chọn lĩnh vực và khu vực làm việc trước khi chọn tính năng này"
        );
    });

    it("rejects a CV larger than 2 MB and encodes an accepted PDF", async () => {
        const { rerender } = render(<SettingUser />);
        await screen.findByTitle("CV đã tải");
        const large = new File([new Uint8Array(2097153)], "large.pdf", {
            type: "application/pdf",
        });
        fireEvent.change(screen.getByLabelText("Tải CV"), { target: { files: [large] } });
        expect(toast.error).toHaveBeenCalledWith(
            "File của bạn quá lớn. Chỉ gửi file dưới 2MB"
        );
        expect(CommonUtils.getBase64).not.toHaveBeenCalled();

        const pdf = new File(["pdf"], "cv.pdf", { type: "application/pdf" });
        await act(async () => {
            fireEvent.change(screen.getByLabelText("Tải CV"), { target: { files: [pdf] } });
            await Promise.resolve();
        });
        expect(CommonUtils.getBase64).toHaveBeenCalledWith(pdf);
        rerender(<SettingUser />);
        expect(screen.getByTitle("CV đã tải")).toHaveAttribute(
            "src",
            "data:application/pdf;base64,CV"
        );
    });
});

describe("ManageCvCandidate", () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 7 }));
        jest.clearAllMocks();
        getAllListCvByUserIdService.mockResolvedValue({
            errCode: 0,
            data: [appliedCv(1)],
            count: 6,
        });
    });

    it("loads submitted applications with status and detail links", async () => {
        render(<ManageCvCandidate />);
        expect(await screen.findByText("React Developer")).toBeInTheDocument();
        expect(getAllListCvByUserIdService).toHaveBeenCalledWith({
            limit: 5,
            offset: 0,
            userId: 7,
        });
        expect(screen.getByText("Chưa xem")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Xem công việc" })).toHaveAttribute(
            "href",
            "/detail-job/91/"
        );
        expect(screen.getByRole("link", { name: "Xem CV đã nộp" })).toHaveAttribute(
            "href",
            "/candidate/cv-detail/1"
        );
        expect(screen.getByTestId("candidate-page-count")).toHaveTextContent("2");
    });

    it("requests the selected page and numbers its first row correctly", async () => {
        getAllListCvByUserIdService
            .mockResolvedValueOnce({ errCode: 0, data: [appliedCv(1)], count: 6 })
            .mockResolvedValueOnce({ errCode: 0, data: [appliedCv(2, 1, "Node Developer")] });
        render(<ManageCvCandidate />);
        await screen.findByText("React Developer");
        fireEvent.click(screen.getByRole("button", { name: "Trang hồ sơ 2" }));

        expect(await screen.findByText("Node Developer")).toBeInTheDocument();
        expect(getAllListCvByUserIdService).toHaveBeenLastCalledWith({
            limit: 5,
            offset: 5,
            userId: 7,
        });
        expect(screen.getByText("6")).toBeInTheDocument();
        expect(screen.getByText("Đã xem")).toBeInTheDocument();
    });
});

describe("SavedJobs", () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 7 }));
        jest.clearAllMocks();
        CommonUtils.formatDate.mockImplementation((value) =>
            value === "expired" ? 0 : 3
        );
        getFavoritePostByUserService.mockResolvedValue({
            errCode: 0,
            data: [
                favorite(21, "live", "Backend Engineer"),
                favorite(22, "expired", "Expired Job"),
            ],
            count: 11,
        });
        toggleFavoritePostService.mockResolvedValue({ errCode: 0, errMessage: "Đã bỏ lưu" });
    });

    it("renders live and expired saved jobs and paginates", async () => {
        render(<SavedJobs />);
        expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();
        expect(screen.getByText("Còn 3 ngày để ứng tuyển")).toBeInTheDocument();
        expect(screen.getByText("Hết hạn ứng tuyển")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Backend Engineer" })).toHaveAttribute(
            "href",
            "/detail-job/21"
        );
        fireEvent.click(screen.getByRole("button", { name: "Trang hồ sơ 2" }));
        await waitFor(() =>
            expect(getFavoritePostByUserService).toHaveBeenLastCalledWith({
                userId: 7,
                limit: 10,
                offset: 10,
            })
        );
    });

    it("unsaves a job, reports success and refreshes the current page", async () => {
        getFavoritePostByUserService.mockResolvedValue({
            errCode: 0,
            data: [favorite(21, "live", "Backend Engineer")],
            count: 1,
        });
        render(<SavedJobs />);
        fireEvent.click(await screen.findByRole("button", { name: /Bỏ lưu/ }));

        await waitFor(() =>
            expect(toggleFavoritePostService).toHaveBeenCalledWith({ userId: 7, postId: 21 })
        );
        expect(toast.success).toHaveBeenCalledWith("Đã bỏ lưu");
        expect(getFavoritePostByUserService).toHaveBeenCalledTimes(2);
    });

    it("shows the service error and keeps the list when unsave fails", async () => {
        toggleFavoritePostService.mockResolvedValue({ errCode: 2 });
        getFavoritePostByUserService.mockResolvedValue({
            errCode: 0,
            data: [favorite(21, "live", "Backend Engineer")],
            count: 1,
        });
        render(<SavedJobs />);
        fireEvent.click(await screen.findByRole("button", { name: /Bỏ lưu/ }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Có lỗi xảy ra"));
        expect(getFavoritePostByUserService).toHaveBeenCalledTimes(1);
        expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
    });

    it("does not fetch without a signed-in candidate and shows the empty action", () => {
        localStorage.clear();
        render(<SavedJobs />);
        expect(getFavoritePostByUserService).not.toHaveBeenCalled();
        expect(screen.getByText(/Bạn chưa lưu tin tuyển dụng nào/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Tìm việc ngay" })).toHaveAttribute(
            "href",
            "/job"
        );
    });
});
