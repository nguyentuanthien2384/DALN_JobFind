import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Modal as AntModal } from "antd";
import { toast } from "react-toastify";
import {
    checkSeeCandiate,
    getAllListCvByPostService,
    getAllListCvByUserIdService,
    getDetailCvService,
    getFilterCv,
} from "../../service/cvService";
import {
    getAllSkillByJobCode,
    getDetailCompanyByUserId,
    getDetailPostByIdService,
    getDetailUserById,
} from "../../service/userService";
import FilterCv from "./Cv/FilterCv";
import ManageCv from "./Cv/ManageCv";
import UserCv from "./Cv/UserCv";
import DetailFilterUser from "./Cv/DetailFilterUser";

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
jest.mock("../../service/cvService", () => ({
    checkSeeCandiate: jest.fn(),
    getAllListCvByPostService: jest.fn(),
    getAllListCvByUserIdService: jest.fn(),
    getDetailCvService: jest.fn(),
    getFilterCv: jest.fn(),
}));
jest.mock("../../service/userService", () => ({
    getAllSkillByJobCode: jest.fn(),
    getDetailCompanyByUserId: jest.fn(),
    getDetailPostByIdService: jest.fn(),
    getDetailUserById: jest.fn(),
}));
jest.mock("../../util/fetch", () => ({
    useFetchAllcode: (type) => ({ data: [{ code: `${type}-1`, value: `${type} label` }] }),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-paginate", () => (props) => (
    <button type="button" data-testid="next-page" onClick={() => props.onPageChange({ selected: 1 })}>page</button>
));
jest.mock("antd", () => {
    const Select = ({ options = [], onChange, placeholder, mode, disabled, value }) => {
        const label = placeholder || (options[0] && options[0].type) || "readonly-select";
        const normalized = mode ? (value || []).map(String) : (value == null ? "" : String(value));
        return (
            <select
                aria-label={label}
                disabled={disabled}
                multiple={Boolean(mode)}
                value={normalized}
                onChange={(event) => {
                    if (!onChange) return;
                    if (mode) {
                        const rawValues = Array.from(event.target.selectedOptions).map((option) => option.value);
                        const details = rawValues.map((raw) => options.find((option) => String(option.value) === raw));
                        const values = details.map((detail, index) => detail ? detail.value : rawValues[index]);
                        onChange(values, details);
                    } else {
                        const detail = options.find((option) => String(option.value) === event.target.value);
                        onChange(detail ? detail.value : event.target.value, detail);
                    }
                }}
            >
                {!mode && <option value="">--</option>}
                {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
        );
    };
    return {
        Col: ({ children }) => <div>{children}</div>,
        Row: ({ children }) => <div>{children}</div>,
        Select,
        Modal: { confirm: jest.fn((options) => options.onOk()) },
    };
});
jest.mock("@ant-design/icons", () => ({ ExclamationCircleOutlined: () => null }));

const candidate = {
    userId: 99,
    userSettingData: { firstName: "Lan", lastName: "Nguyễn" },
    jobTypeSettingData: { value: "Công nghệ" },
    file: "82%",
};

describe("candidate filtering", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        AntModal.confirm.mockImplementation((options) => options.onOk());
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 5, companyId: 7, roleCode: "COMPANY" }));
        getFilterCv.mockResolvedValue({ errCode: 0, count: 6, isHiddenPercent: false, data: [candidate] });
        getDetailCompanyByUserId.mockResolvedValue({ errCode: 0, data: { allowCvFree: 2, allowCv: 4 } });
        getAllSkillByJobCode.mockResolvedValue({ errCode: 0, data: [{ id: 8, name: "React" }] });
    });

    it("loads company allowances, filters by category and skills, pages, then confirms candidate access", async () => {
        render(<FilterCv />);
        expect(await screen.findByText("Lan Nguyễn")).toBeInTheDocument();
        expect(screen.getByText("Số lượt xem miễn phí: 2")).toBeInTheDocument();
        expect(screen.getByText("82%")).toBeInTheDocument();
        expect(screen.getByText("Tốt")).toBeInTheDocument();
        expect(getDetailCompanyByUserId).toHaveBeenCalledWith(5, 7);

        fireEvent.change(screen.getByLabelText("categoryJobCode"), { target: { value: "JOBTYPE-1" } });
        await waitFor(() => expect(getAllSkillByJobCode).toHaveBeenCalledWith("JOBTYPE-1"));
        await waitFor(() => expect(getFilterCv).toHaveBeenLastCalledWith(expect.objectContaining({ categoryJobCode: "JOBTYPE-1" })));
        const skillSelect = screen.getByLabelText("Chọn kĩ năng của bạn");
        expect(skillSelect).not.toBeDisabled();
        fireEvent.change(skillSelect, { target: { value: "8" } });
        await waitFor(() => expect(getFilterCv).toHaveBeenLastCalledWith(expect.objectContaining({
            categoryJobCode: "JOBTYPE-1",
            listSkills: [8],
            otherSkills: [],
        })));

        fireEvent.click(screen.getByTestId("next-page"));
        await waitFor(() => expect(getFilterCv).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5 })));
        fireEvent.click(screen.getByText(/Xem chi tiết ứng viên/));
        expect(AntModal.confirm).toHaveBeenCalled();
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/admin/candiate/99/"));
    });
});

describe("CV list and detail", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 5, companyId: 7, roleCode: "EMPLOYER" }));
        mockParams = { id: "post-10" };
    });

    it("loads a post's CVs, presents their score and paginates", async () => {
        getDetailPostByIdService.mockResolvedValue({ errCode: 0, data: { postDetailData: { name: "Kỹ sư React" } } });
        getAllListCvByPostService.mockResolvedValue({ errCode: 0, count: 8, data: [{
            id: 31,
            file: "75%",
            isChecked: 0,
            userCvData: { firstName: "An", lastName: "Trần", userAccountData: { phonenumber: "0901" } },
        }] });
        render(<ManageCv />);
        expect(await screen.findByText("Kỹ sư React")).toBeInTheDocument();
        expect(screen.getByText("An Trần")).toBeInTheDocument();
        expect(screen.getByText("Tốt")).toBeInTheDocument();
        expect(screen.getByText("Xem CV")).toHaveAttribute("href", "/admin/user-cv/31/");
        fireEvent.click(screen.getByTestId("next-page"));
        await waitFor(() => expect(getAllListCvByPostService).toHaveBeenLastCalledWith({ limit: 5, offset: 5, postId: "post-10" }));
    });

    it("loads the selected CV with the current role and supports back navigation", async () => {
        mockParams = { id: "31" };
        getDetailCvService.mockResolvedValue({ errCode: 0, data: {
            description: "Tôi có 5 năm kinh nghiệm",
            file: "/files/cv-31.pdf",
            userCvData: { firstName: "An", lastName: "Trần" },
        } });
        const { container } = render(<UserCv />);
        expect(await screen.findByText("Tôi có 5 năm kinh nghiệm")).toBeInTheDocument();
        expect(getDetailCvService).toHaveBeenCalledWith("31", "EMPLOYER");
        expect(container.querySelector("iframe")).toHaveAttribute("src", "/files/cv-31.pdf");
        fireEvent.click(screen.getByText("Quay lại"));
        expect(mockNavigate).toHaveBeenCalledWith(-1);
    });
});

const detailedUser = {
    phonenumber: "0911222333",
    listSkills: [{ SkillId: 8, Skill: { name: "React" } }],
    userAccountData: {
        firstName: "Mai",
        lastName: "Lê",
        email: "mai@example.com",
        image: "/mai.png",
        address: "Đà Nẵng",
        dob: "2000-01-01",
        genderData: { value: "Nữ" },
        userSettingData: {
            categoryJobCode: "JOBTYPE-1",
            salaryJobCode: "SALARYTYPE-1",
            addressCode: "PROVINCE-1",
            experienceJobCode: "EXPTYPE-1",
            isFindJob: 1,
            isTakeMail: 1,
            file: "/files/profile.pdf",
        },
    },
};

describe("candidate access detail", () => {
    beforeEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 5, companyId: 7 }));
        mockParams = { id: "99" };
        getAllSkillByJobCode.mockResolvedValue({ errCode: 0, data: [{ id: 8, name: "React" }] });
    });

    it("shows contact information, preferences and application history after authorization", async () => {
        checkSeeCandiate.mockResolvedValue({ errCode: 0 });
        getDetailUserById.mockResolvedValue({ errCode: 0, data: detailedUser });
        getAllListCvByUserIdService.mockResolvedValue({ errCode: 0, data: [{
            id: 1,
            description: "Ứng tuyển vị trí frontend",
            createdAt: "2026-08-20T00:00:00Z",
            isChecked: 1,
            postCvData: { postDetailData: { name: "Frontend Engineer" } },
        }] });
        const { container } = render(<DetailFilterUser />);
        expect(await screen.findByText("Mai Lê")).toBeInTheDocument();
        expect(screen.getByText("mai@example.com")).toBeInTheDocument();
        expect(screen.getAllByText("React").length).toBeGreaterThan(0);
        const historyRow = screen.getByText("Frontend Engineer").closest("tr");
        expect(within(historyRow).getByText("Đã xem")).toBeInTheDocument();
        expect(checkSeeCandiate).toHaveBeenCalledWith({ candidateId: "99" });
        expect(getAllListCvByUserIdService).toHaveBeenCalledWith({ userId: "99", limit: 20, offset: 0 });
        expect(container.querySelector("iframe")).toHaveAttribute("src", "/files/profile.pdf");
    });

    it("reports denied access and returns to the candidate list", async () => {
        jest.useFakeTimers();
        checkSeeCandiate.mockResolvedValue({ errCode: 1, errMessage: "Bạn đã hết lượt xem" });
        render(<DetailFilterUser />);
        await act(async () => Promise.resolve());
        expect(toast.error).toHaveBeenCalledWith("Bạn đã hết lượt xem");
        act(() => jest.advanceTimersByTime(1000));
        expect(mockNavigate).toHaveBeenCalledWith("/admin/list-candiate/");
        expect(getDetailUserById).not.toHaveBeenCalled();
        jest.useRealTimers();
    });
});
