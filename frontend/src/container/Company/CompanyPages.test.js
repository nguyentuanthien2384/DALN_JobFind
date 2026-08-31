import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import {
    checkFollowCompanyService,
    createCompanyReviewService,
    deleteCompanyReviewService,
    getDetailCompanyById,
    getListCompany,
    getReviewByCompanyService,
    toggleFollowCompanyService,
} from "../../service/userService";
import CommonUtils from "../../util/CommonUtils";
import CompanyReview from "./CompanyReview";
import DetailCompany from "./DetailCompany";
import ListCompany from "./ListCompany";

const mockNavigate = jest.fn();
let mockCompanyId = "42";

jest.mock("../../service/userService", () => ({
    getListCompany: jest.fn(),
    getDetailCompanyById: jest.fn(),
    checkFollowCompanyService: jest.fn(),
    toggleFollowCompanyService: jest.fn(),
    getReviewByCompanyService: jest.fn(),
    createCompanyReviewService: jest.fn(),
    deleteCompanyReviewService: jest.fn(),
}));
jest.mock("react-toastify", () => ({
    toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));
jest.mock("../../util/CommonUtils", () => ({
    __esModule: true,
    default: {
        removeSpace: jest.fn((value) => value.trim().replace(/\s+/g, " ")),
        formatDate: jest.fn(() => 4),
    },
}));
jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        Link: ({ to, children, ...props }) =>
            React.createElement("a", { href: to, ...props }, children),
        useParams: () => ({ id: mockCompanyId }),
        useNavigate: () => mockNavigate,
    };
});
jest.mock("antd", () => {
    const React = require("react");
    const Search = ({ onSearch, placeholder }) => {
        const [value, setValue] = React.useState("");
        return React.createElement(
            "div",
            {},
            React.createElement("input", {
                placeholder,
                value,
                onChange: (event) => setValue(event.target.value),
            }),
            React.createElement(
                "button",
                { type: "button", onClick: () => onSearch(value) },
                "Tìm kiếm"
            )
        );
    };
    return { Input: { Search } };
});
jest.mock("react-paginate", () => (props) => (
    <div>
        <span data-testid="company-pages">{props.pageCount}</span>
        <span data-testid="company-current-page">{String(props.forcePage)}</span>
        <button type="button" onClick={() => props.onPageChange({ selected: 1 })}>
            Trang 2
        </button>
    </div>
));

const company = {
    id: 42,
    name: "Công ty Sao Việt",
    coverimage: "/cover.jpg",
    thumbnail: "/logo.jpg",
    descriptionHTML: "<b>Môi trường tốt</b>",
    website: "https://example.test",
    amountEmployer: 120,
    address: "Quận 1, TP.HCM",
    phonenumber: "0900000000",
    taxnumber: "TAX-42",
    censorData: { code: "CS1", value: "Đã xác thực" },
    postData: [
        {
            id: 91,
            createdAt: Date.now(),
            timeEnd: Date.now() + 86400000,
            postDetailData: {
                name: "Frontend Engineer",
                salaryTypePostData: { value: "20 triệu" },
                provincePostData: { value: "TP.HCM" },
            },
        },
    ],
};

const review = {
    id: 5,
    star: 4,
    content: "Đồng nghiệp thân thiện",
    createdAt: Date.now(),
    userReviewData: {
        id: 7,
        firstName: "Minh",
        lastName: "An",
        image: "/user.png",
    },
};

describe("ListCompany", () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        CommonUtils.removeSpace.mockImplementation((value) =>
            value.trim().replace(/\s+/g, " ")
        );
        getListCompany.mockResolvedValue({ errCode: 0, data: [company], count: 7 });
    });

    it("loads companies, renders returned HTML and pagination metadata", async () => {
        render(<ListCompany />);

        expect(await screen.findByText("Công ty Sao Việt")).toHaveAttribute(
            "href",
            "/detail-company/42"
        );
        expect(screen.getByText("Môi trường tốt")).toBeInTheDocument();
        expect(screen.getByText("7 công ty được tìm thấy")).toBeInTheDocument();
        expect(screen.getByTestId("company-pages")).toHaveTextContent("2");
        expect(getListCompany).toHaveBeenCalledWith({ limit: 6, offset: 0, search: "" });
    });

    it("normalizes searches and preserves them while paging", async () => {
        render(<ListCompany />);
        await screen.findByText("Công ty Sao Việt");

        fireEvent.change(screen.getByPlaceholderText("Nhập tên công ty"), {
            target: { value: "  Sao   Việt  " },
        });
        fireEvent.click(screen.getByRole("button", { name: "Tìm kiếm" }));
        await waitFor(() =>
            expect(getListCompany).toHaveBeenLastCalledWith({
                limit: 6,
                offset: 0,
                search: "Sao Việt",
            })
        );
        expect(screen.getByTestId("company-current-page")).toHaveTextContent("0");

        fireEvent.click(screen.getByRole("button", { name: "Trang 2" }));
        await waitFor(() =>
            expect(getListCompany).toHaveBeenLastCalledWith({
                limit: 6,
                offset: 6,
                search: "Sao Việt",
            })
        );
        expect(screen.getByTestId("company-current-page")).toHaveTextContent("1");
    });

    it("keeps an empty result when the service fails", async () => {
        getListCompany.mockResolvedValue({ errCode: 2, data: [company], count: 1 });
        render(<ListCompany />);
        await waitFor(() => expect(getListCompany).toHaveBeenCalled());
        expect(screen.queryByText("Công ty Sao Việt")).not.toBeInTheDocument();
        expect(screen.getByText("0 công ty được tìm thấy")).toBeInTheDocument();
    });
});

describe("CompanyReview", () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        getReviewByCompanyService.mockResolvedValue({
            errCode: 0,
            data: [review],
            count: 1,
            averageStar: 4.2,
        });
        createCompanyReviewService.mockResolvedValue({ errCode: 0, errMessage: "Đã gửi" });
        deleteCompanyReviewService.mockResolvedValue({ errCode: 0, errMessage: "Đã xóa" });
    });

    it("loads rating summary and existing reviews", async () => {
        render(<CompanyReview companyId="42" />);

        expect(await screen.findByText("Đồng nghiệp thân thiện")).toBeInTheDocument();
        expect(screen.getByText("4.2")).toBeInTheDocument();
        expect(screen.getByText("1 lượt đánh giá")).toBeInTheDocument();
        expect(screen.getByText("Minh An")).toBeInTheDocument();
        expect(getReviewByCompanyService).toHaveBeenCalledWith({
            companyId: "42",
            limit: 20,
            offset: 0,
        });
    });

    it("requires login and records the current URL before redirecting", async () => {
        jest.useFakeTimers();
        render(<CompanyReview companyId="42" />);
        await screen.findByText("Đồng nghiệp thân thiện");
        fireEvent.change(screen.getByPlaceholderText(/Chia sẻ cảm nhận/), {
            target: { value: "Rất tốt" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Gửi đánh giá" }));

        expect(toast.error).toHaveBeenCalledWith(
            "Xin hãy đăng nhập để có thể đánh giá công ty"
        );
        act(() => jest.advanceTimersByTime(1000));
        expect(localStorage.getItem("lastUrl")).toBe(window.location.href);
        expect(mockNavigate).toHaveBeenCalledWith("/login");
        expect(createCompanyReviewService).not.toHaveBeenCalled();
        jest.useRealTimers();
    });

    it("validates content before submitting", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7 }));
        render(<CompanyReview companyId="42" />);
        await screen.findByText("Đồng nghiệp thân thiện");
        fireEvent.click(screen.getByRole("button", { name: "Gửi đánh giá" }));
        expect(toast.error).toHaveBeenCalledWith("Vui lòng nhập nội dung đánh giá");
        expect(createCompanyReviewService).not.toHaveBeenCalled();
    });

    it("submits the selected star value, clears content and refreshes", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7 }));
        render(<CompanyReview companyId="42" />);
        await screen.findByText("Đồng nghiệp thân thiện");
        fireEvent.click(screen.getByRole("button", { name: "2 sao" }));
        fireEvent.change(screen.getByPlaceholderText(/Chia sẻ cảm nhận/), {
            target: { value: "Quy trình rõ ràng" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Gửi đánh giá" }));

        await waitFor(() =>
            expect(createCompanyReviewService).toHaveBeenCalledWith({
                userId: 7,
                companyId: "42",
                star: 2,
                content: "Quy trình rõ ràng",
            })
        );
        expect(toast.success).toHaveBeenCalledWith("Đã gửi");
        await waitFor(() =>
            expect(screen.getByPlaceholderText(/Chia sẻ cảm nhận/)).toHaveValue("")
        );
        expect(getReviewByCompanyService).toHaveBeenCalledTimes(2);
    });

    it("lets the review owner delete and reports service failures", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7 }));
        deleteCompanyReviewService.mockResolvedValue({ errCode: 2, errMessage: "Không thể xóa" });
        render(<CompanyReview companyId="42" />);
        fireEvent.click(await screen.findByText("Xóa"));

        await waitFor(() =>
            expect(deleteCompanyReviewService).toHaveBeenCalledWith({ id: 5, userId: 7 })
        );
        expect(toast.error).toHaveBeenCalledWith("Không thể xóa");
    });
});

describe("DetailCompany", () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        mockCompanyId = "42";
        CommonUtils.formatDate.mockReturnValue(4);
        getDetailCompanyById.mockResolvedValue({ errCode: 0, data: company });
        checkFollowCompanyService.mockResolvedValue({
            errCode: 0,
            isFollow: false,
            countFollower: 9,
        });
        getReviewByCompanyService.mockResolvedValue({
            errCode: 0,
            data: [],
            count: 0,
            averageStar: 0,
        });
        toggleFollowCompanyService.mockResolvedValue({
            errCode: 0,
            isFollow: true,
            errMessage: "Đã theo dõi",
        });
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: jest.fn() },
        });
    });

    it("loads company detail, follow count and active vacancies", async () => {
        render(<DetailCompany />);

        expect(await screen.findByRole("heading", { name: "Công ty Sao Việt" })).toBeInTheDocument();
        expect(getDetailCompanyById).toHaveBeenCalledWith("42");
        expect(checkFollowCompanyService).toHaveBeenCalledWith({ companyId: "42", userId: "" });
        expect(screen.getByText("Theo dõi (9)")).toBeInTheDocument();
        expect(screen.getByText("Frontend Engineer")).toBeInTheDocument();
        expect(screen.getByText(/Còn/)).toHaveTextContent("Còn 4 ngày");
        expect(screen.getByText("Đã xác thực")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Chia sẻ qua Facebook" })).toHaveAttribute(
            "href",
            `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`
        );
        expect(screen.getByTitle("Bản đồ địa chỉ công ty")).toHaveAttribute(
            "src",
            expect.not.stringContaining("key=")
        );
        expect(document.body.innerHTML).not.toContain("topcv.vn");
    });

    it("redirects anonymous visitors who try to follow", async () => {
        render(<DetailCompany />);
        fireEvent.click(await screen.findByText("Theo dõi (9)"));
        expect(toast.info).toHaveBeenCalledWith("Vui lòng đăng nhập để theo dõi công ty");
        expect(mockNavigate).toHaveBeenCalledWith("/login");
        expect(toggleFollowCompanyService).not.toHaveBeenCalled();
    });

    it("recovers malformed login data as an anonymous visitor", async () => {
        localStorage.setItem("userData", "{broken-json");
        render(<DetailCompany />);
        fireEvent.click(await screen.findByText("Theo dõi (9)"));

        expect(mockNavigate).toHaveBeenCalledWith("/login");
        expect(localStorage.getItem("userData")).toBeNull();
        expect(toggleFollowCompanyService).not.toHaveBeenCalled();
    });

    it("toggles follow state and adjusts the follower count", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7 }));
        render(<DetailCompany />);
        fireEvent.click(await screen.findByText("Theo dõi (9)"));

        await waitFor(() =>
            expect(toggleFollowCompanyService).toHaveBeenCalledWith({ userId: 7, companyId: "42" })
        );
        expect(await screen.findByText("Đang theo dõi (10)")).toBeInTheDocument();
        expect(toast.success).toHaveBeenCalledWith("Đã theo dõi");
    });

    it("reports follow errors and can copy the current detail URL", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7 }));
        toggleFollowCompanyService.mockResolvedValue({ errCode: 2 });
        render(<DetailCompany />);
        fireEvent.click(await screen.findByText("Theo dõi (9)"));
        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith("Không thể cập nhật theo dõi công ty")
        );

        fireEvent.click(screen.getByRole("button", { name: "Sao chép đường dẫn" }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href);
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã sao chép đường dẫn"));
    });

    it("renders explicit empty and expired vacancy states", async () => {
        CommonUtils.formatDate.mockReturnValue(-1);
        getDetailCompanyById.mockResolvedValueOnce({
            errCode: 0,
            data: { ...company, postData: [{ ...company.postData[0], timeEnd: Date.now() - 1 }] },
        });
        const first = render(<DetailCompany />);
        expect(await screen.findByText("Hết hạn ứng tuyển")).toBeInTheDocument();
        first.unmount();

        getDetailCompanyById.mockResolvedValueOnce({
            errCode: 0,
            data: { ...company, postData: [] },
        });
        render(<DetailCompany />);
        expect(await screen.findByText("Không có bài đăng nào")).toBeInTheDocument();
    });

    it("shows a stable error state when company loading fails", async () => {
        getDetailCompanyById.mockRejectedValue(new Error("offline"));
        checkFollowCompanyService.mockRejectedValue(new Error("offline"));
        render(<DetailCompany />);

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Không thể tải thông tin công ty. Vui lòng thử lại"
        );
    });

    it("does not render an unsafe company website protocol", async () => {
        getDetailCompanyById.mockResolvedValue({
            errCode: 0,
            data: { ...company, website: "javascript:alert(1)" },
        });
        render(<DetailCompany />);

        expect(await screen.findByText("Chưa cập nhật website")).toBeInTheDocument();
        expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    });
});
