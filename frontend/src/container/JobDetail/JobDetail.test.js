import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "react-toastify";
import {
    checkFavoritePostService,
    getDetailPostByIdService,
    getRelatedPostService,
    toggleFavoritePostService,
} from "../../service/userService";
import CommonUtils from "../../util/CommonUtils";
import JobDetail from "./JobDetail";
import { clearJobDetailResourceCache } from "./jobDetailResource";

const mockNavigate = jest.fn();
let mockPostId = "42";

jest.mock("../../service/userService", () => ({
    checkFavoritePostService: jest.fn(),
    getDetailPostByIdService: jest.fn(),
    getRelatedPostService: jest.fn(),
    toggleFavoritePostService: jest.fn(),
}));
jest.mock("../../util/CommonUtils", () => ({
    __esModule: true,
    default: { formatDate: jest.fn() },
}));
jest.mock("react-toastify", () => ({
    toast: { error: jest.fn(), success: jest.fn() },
}));
jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        useNavigate: () => mockNavigate,
        useParams: () => ({ id: mockPostId }),
        Link: ({ to, children, ...props }) =>
            React.createElement("a", { href: to, ...props }, children),
    };
});
jest.mock("../../components/modal/SendCvModal", () => (props) =>
    props.isOpen ? (
        <div role="dialog" aria-label="Nộp CV">
            <span>post:{props.postId}</span>
            <button type="button" onClick={props.onHide}>Đóng</button>
        </div>
    ) : null
);

const post = {
    id: 42,
    userId: 88,
    timeEnd: new Date("2030-06-20T00:00:00Z").getTime(),
    companyData: {
        id: 9,
        name: "Công ty Sao Việt",
        coverimage: "/cover.png",
        thumbnail: "/logo.png",
        website: "https://example.test",
        address: "Hà Nội",
        phonenumber: "0909000000",
        taxnumber: "TAX-01",
        amountEmployer: 120,
    },
    postDetailData: {
        name: "Senior React Developer",
        descriptionHTML: "<p><strong>Xây dựng sản phẩm</strong></p>",
        jobTypePostData: { value: "Công nghệ" },
        provincePostData: { value: "Hà Nội" },
        workTypePostData: { value: "Toàn thời gian" },
        expTypePostData: { value: "3 năm" },
        salaryTypePostData: { value: "30 triệu" },
    },
};

const related = {
    id: 99,
    userPostData: {
        userCompanyData: { name: "Công ty Liên quan", thumbnail: "/related.png" },
    },
    postDetailData: {
        name: "Node.js Developer",
        provincePostData: { value: "Đà Nẵng" },
        salaryTypePostData: { value: "25 triệu" },
    },
};

describe("JobDetail", () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        clearJobDetailResourceCache();
        mockPostId = "42";
        CommonUtils.formatDate.mockReturnValue(10);
        getDetailPostByIdService.mockResolvedValue({ errCode: 0, data: post });
        getRelatedPostService.mockResolvedValue({ errCode: 1, data: [] });
        checkFavoritePostService.mockResolvedValue({ errCode: 0, isFavorite: false });
        toggleFavoritePostService.mockResolvedValue({
            errCode: 0,
            isFavorite: true,
            errMessage: "Đã lưu",
        });
    });

    it("loads the post and related jobs and renders all important details", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7, roleCode: "CANDIDATE" }));
        getRelatedPostService.mockResolvedValueOnce({ errCode: 0, data: [related] });

        render(<JobDetail />);

        expect(await screen.findByRole("heading", {
            name: "Senior React Developer",
        })).toBeInTheDocument();
        expect(getDetailPostByIdService).toHaveBeenCalledWith("42");
        expect(getRelatedPostService).toHaveBeenCalledWith({ postId: "42", limit: 5 });
        expect(checkFavoritePostService).toHaveBeenCalledWith({ postId: "42", userId: 7 });
        expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
        expect(screen.getByText("Xây dựng sản phẩm")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Công ty Sao Việt/ })).toHaveAttribute(
            "href",
            "/detail-company/9"
        );
        expect(screen.getByRole("link", { name: /Node.js Developer/ })).toHaveAttribute(
            "href",
            "/detail-job/99"
        );
        expect(screen.getByText(/TAX-01/)).toBeInTheDocument();
        expect(screen.getByText(/120/)).toBeInTheDocument();

        const companyCard = screen
            .getByRole("heading", { name: "Thông tin công ty" })
            .closest(".company-details-card");
        expect(companyCard).toHaveClass("post-details3");
        expect(within(companyCard).getAllByRole("listitem")).toHaveLength(6);
        expect(within(companyCard).getByText("Công ty Sao Việt")).toHaveClass(
            "company-details-value"
        );
    });

    it("keeps a full-height loading shell visible while the detail request is pending", async () => {
        let resolveDetail;
        getDetailPostByIdService.mockReturnValueOnce(new Promise((resolve) => {
            resolveDetail = resolve;
        }));

        render(<JobDetail />);

        const main = screen.getByRole("main");
        expect(main).toHaveAttribute("aria-busy", "true");
        expect(screen.getByRole("status", { name: "Đang tải chi tiết công việc" }))
            .toBeInTheDocument();
        expect(document.querySelector(".job-detail-skeleton__content-card")).toBeInTheDocument();

        await act(async () => {
            resolveDetail({ errCode: 0, data: post });
        });
        expect(await screen.findByRole("heading", { name: "Senior React Developer" }))
            .toBeInTheDocument();
        expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "false");
    });

    it("ignores a stale response when the user opens another job quickly", async () => {
        const deferred = {};
        getDetailPostByIdService.mockImplementation((postId) => new Promise((resolve) => {
            deferred[postId] = resolve;
        }));
        const newerPost = {
            ...post,
            id: 99,
            postDetailData: { ...post.postDetailData, name: "Frontend Lead" },
        };
        const view = render(<JobDetail />);

        await waitFor(() => expect(deferred["42"]).toEqual(expect.any(Function)));
        mockPostId = "99";
        view.rerender(<JobDetail />);
        await waitFor(() => expect(deferred["99"]).toEqual(expect.any(Function)));

        await act(async () => deferred["99"]({ errCode: 0, data: newerPost }));
        expect(await screen.findByRole("heading", { name: "Frontend Lead" })).toBeInTheDocument();

        await act(async () => deferred["42"]({ errCode: 0, data: post }));
        expect(screen.getByRole("heading", { name: "Frontend Lead" })).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Senior React Developer" }))
            .not.toBeInTheDocument();
        expect(window.scrollTo).toHaveBeenCalledTimes(2);
    });

    it("deduplicates development StrictMode requests and scrolls once", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7, roleCode: "CANDIDATE" }));

        render(
            <React.StrictMode>
                <JobDetail />
            </React.StrictMode>
        );

        expect(await screen.findByRole("heading", { name: "Senior React Developer" }))
            .toBeInTheDocument();
        expect(getDetailPostByIdService).toHaveBeenCalledTimes(1);
        expect(getRelatedPostService).toHaveBeenCalledTimes(1);
        expect(checkFavoritePostService).toHaveBeenCalledTimes(1);
        expect(window.scrollTo).toHaveBeenCalledTimes(1);
    });

    it("does not check favorites for an anonymous visitor", async () => {
        render(<JobDetail />);
        await screen.findByRole("heading", { name: "Senior React Developer" });
        expect(checkFavoritePostService).not.toHaveBeenCalled();
    });

    it("redirects an anonymous visitor who tries to save the job", async () => {
        jest.useFakeTimers();
        render(<JobDetail />);
        await screen.findByRole("heading", { name: "Senior React Developer" });

        fireEvent.click(screen.getByRole("button", { name: "Lưu tin" }));
        expect(toast.error).toHaveBeenCalledWith(
            "Xin hãy đăng nhập để có thể lưu tin tuyển dụng"
        );
        act(() => jest.advanceTimersByTime(1000));
        expect(localStorage.getItem("lastUrl")).toBe(window.location.href);
        expect(mockNavigate).toHaveBeenCalledWith("/login");
        expect(toggleFavoritePostService).not.toHaveBeenCalled();
        jest.useRealTimers();
    });

    it("toggles a favorite and reports both service and fallback errors", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7, roleCode: "CANDIDATE" }));
        const view = render(<JobDetail />);
        await screen.findByRole("heading", { name: "Senior React Developer" });
        fireEvent.click(screen.getByRole("button", { name: "Lưu tin" }));

        await waitFor(() =>
            expect(toggleFavoritePostService).toHaveBeenCalledWith({ userId: 7, postId: "42" })
        );
        expect(await screen.findByRole("button", { name: "Đã lưu tin" })).toHaveClass(
            "is-active"
        );
        expect(toast.success).toHaveBeenCalledWith("Đã lưu");
        view.unmount();

        toggleFavoritePostService.mockResolvedValueOnce({
            errCode: 2,
            errMessage: "Không thể lưu",
        });
        render(<JobDetail />);
        await screen.findByRole("heading", { name: "Senior React Developer" });
        fireEvent.click(screen.getByRole("button", { name: "Lưu tin" }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không thể lưu"));

        toggleFavoritePostService.mockResolvedValueOnce(null);
        fireEvent.click(screen.getByRole("button", { name: "Lưu tin" }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Có lỗi xảy ra"));
    });

    it("opens and closes the application modal for a signed-in user", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7, roleCode: "CANDIDATE" }));
        render(<JobDetail />);
        fireEvent.click(await screen.findByRole("button", { name: "Ứng tuyển ngay" }));

        expect(CommonUtils.formatDate).toHaveBeenCalledWith(post.timeEnd);
        expect(screen.getByRole("dialog", { name: "Nộp CV" })).toHaveTextContent("post:42");
        fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
        expect(screen.queryByRole("dialog", { name: "Nộp CV" })).not.toBeInTheDocument();
    });

    it("blocks expired applications and redirects anonymous active applicants", async () => {
        CommonUtils.formatDate.mockReturnValueOnce(0);
        const first = render(<JobDetail />);
        fireEvent.click(await screen.findByRole("button", { name: "Ứng tuyển ngay" }));
        expect(toast.error).toHaveBeenCalledWith("Hạn ứng tuyển đã hết");
        expect(screen.queryByRole("dialog", { name: "Nộp CV" })).not.toBeInTheDocument();
        first.unmount();

        jest.useFakeTimers();
        CommonUtils.formatDate.mockReturnValue(3);
        render(<JobDetail />);
        fireEvent.click(await screen.findByRole("button", { name: "Ứng tuyển ngay" }));
        expect(toast.error).toHaveBeenCalledWith(
            "Xin hãy đăng nhập để có thể thực hiện nộp CV"
        );
        act(() => jest.advanceTimersByTime(1000));
        expect(mockNavigate).toHaveBeenCalledWith("/login");
        expect(localStorage.getItem("lastUrl")).toBe(window.location.href);
        jest.useRealTimers();
    });

    it("handles anonymous and candidate chat actions", async () => {
        jest.useFakeTimers();
        const first = render(<JobDetail />);
        fireEvent.click(
            await screen.findByRole("button", { name: "Nhắn tin cho nhà tuyển dụng" })
        );
        expect(toast.error).toHaveBeenCalledWith(
            "Xin hãy đăng nhập để nhắn tin với nhà tuyển dụng"
        );
        act(() => jest.advanceTimersByTime(1000));
        expect(mockNavigate).toHaveBeenCalledWith("/login");
        first.unmount();
        jest.useRealTimers();

        localStorage.setItem("userData", JSON.stringify({ id: 7, roleCode: "CANDIDATE" }));
        render(<JobDetail />);
        fireEvent.click(
            await screen.findByRole("button", { name: "Nhắn tin cho nhà tuyển dụng" })
        );
        expect(mockNavigate).toHaveBeenCalledWith("/chat/88");
    });

    it("lets ADMIN chat, apply and save the job as a super-admin", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        render(<JobDetail />);

        expect(await screen.findByRole("heading", { name: "Senior React Developer" })).toBeInTheDocument();
        expect(checkFavoritePostService).toHaveBeenCalledWith({ postId: "42", userId: 1 });
        expect(screen.getByRole("button", { name: "Nhắn tin cho nhà tuyển dụng" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Ứng tuyển ngay" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Lưu tin" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Nhắn tin cho nhà tuyển dụng" }));
        expect(mockNavigate).toHaveBeenCalledWith("/chat/88");

        fireEvent.click(screen.getByRole("button", { name: "Ứng tuyển ngay" }));
        expect(screen.getByRole("dialog", { name: "Nộp CV" })).toHaveTextContent("post:42");

        fireEvent.click(screen.getByRole("button", { name: "Lưu tin" }));
        await waitFor(() => expect(toggleFavoritePostService).toHaveBeenCalledWith({
            postId: "42",
            userId: 1,
        }));
    });

    it.each([
        ["COMPANY without companyId", { id: 2, roleCode: "COMPANY" }],
        ["EMPLOYER without companyId", { id: 3, roleCode: "EMPLOYER" }],
        ["EMPLOYER in a pending company", {
            id: 4,
            roleCode: "EMPLOYER",
            companyId: 9,
            companyStatusCode: "S1",
            companyCensorCode: "CS2",
        }],
        ["EMPLOYER in an approved company", {
            id: 5,
            roleCode: "EMPLOYER",
            companyId: 9,
            companyStatusCode: "S1",
            companyCensorCode: "CS1",
        }],
    ])("does not expose chat action to %s", async (_label, user) => {
        localStorage.setItem("userData", JSON.stringify(user));
        render(<JobDetail />);

        expect(await screen.findByRole("heading", { name: "Senior React Developer" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Nhắn tin cho nhà tuyển dụng" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Ứng tuyển ngay" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Lưu tin" })).not.toBeInTheDocument();
        expect(checkFavoritePostService).not.toHaveBeenCalled();
    });
});
