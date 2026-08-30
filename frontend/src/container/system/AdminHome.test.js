import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import CommonUtils from "../../util/CommonUtils";
import { getStatisticalCv } from "../../service/cvService";
import { getStatisticalPackageCv, getStatisticalPackagePost, getStatisticalTypePost } from "../../service/userService";
import Home from "./Home";

jest.mock("xlsx/xlsx.mjs", () => ({
    utils: { book_new: jest.fn(), json_to_sheet: jest.fn(), book_append_sheet: jest.fn() },
    writeFile: jest.fn(),
}));
jest.mock("../../util/CommonUtils", () => ({
    __esModule: true,
    default: { exportExcel: jest.fn() },
}));
jest.mock("../../service/cvService", () => ({ getStatisticalCv: jest.fn() }));
jest.mock("../../service/userService", () => ({
    getStatisticalPackageCv: jest.fn(),
    getStatisticalPackagePost: jest.fn(),
    getStatisticalTypePost: jest.fn(),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-minimal-pie-chart", () => ({
    PieChart: ({ data }) => <div data-testid="job-type-chart" data-chart={JSON.stringify(data)} />,
}));
jest.mock("../../util/useAutoRefresh", () => (loader) => ({
    capNhatLuc: new Date("2026-08-30T00:00:00Z"),
    dangTai: false,
    lamMoi: jest.fn(() => loader()),
}));
jest.mock("./AutoRefreshInfo", () => ({ onLamMoi }) => (
    <button type="button" onClick={onLamMoi}>Làm mới dashboard</button>
));
jest.mock("react-paginate", () => (props) => (
    <button type="button" data-testid="dashboard-pager" onClick={() => props.onPageChange({ selected: 1 })}>page</button>
));
jest.mock("antd", () => ({
    DatePicker: {
        RangePicker: ({ onChange }) => (
            <button type="button" data-testid="dashboard-range" onClick={() => onChange([
                { format: () => "2026-08-01" },
                { format: () => "2026-08-20" },
            ])}>range</button>
        ),
    },
}));

const typeStats = {
    errCode: 0,
    totalPost: 10,
    data: [
        { amount: 6, postDetailData: { jobTypePostData: { value: "Công nghệ" } } },
        { amount: 2, postDetailData: { jobTypePostData: { value: "Kinh doanh" } } },
    ],
};
const postPackageStats = {
    errCode: 0,
    count: 7,
    sum: 120,
    data: [{ id: 11, name: "Gói bài hot", isHot: 1, count: "4", total: "80" }],
};
const cvPackageStats = {
    errCode: 0,
    count: 6,
    sum: 70,
    data: [{ id: 12, name: "Gói xem CV", count: "5", total: "70" }],
};

describe("system home dashboard", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        getStatisticalTypePost.mockResolvedValue(typeStats);
        getStatisticalPackagePost.mockResolvedValue(postPackageStats);
        getStatisticalPackageCv.mockResolvedValue(cvPackageStats);
        getStatisticalCv.mockResolvedValue({ errCode: 0, count: 6, data: [{
            id: 90,
            total: 3,
            postDetailData: { name: "Frontend Engineer" },
            userPostData: { firstName: "An", lastName: "Trần" },
        }] });
    });

    it("loads the administrator overview, preserves each date/page filter and exports both revenue tables", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN", firstName: "Quản", lastName: "Trị" }));
        render(<Home />);
        expect(await screen.findByText("Xin chào Quản Trị")).toBeInTheDocument();
        expect(await screen.findByText("Công nghệ: 6 bài")).toBeInTheDocument();
        expect(screen.getByText("Lĩnh vực khác: 2 bài")).toBeInTheDocument();
        expect(await screen.findByText("Gói bài hot")).toBeInTheDocument();
        expect(screen.getByText("Gói xem CV")).toBeInTheDocument();
        expect(screen.getByText("Tổng doanh thu: 120 USD")).toBeInTheDocument();
        expect(screen.getByText("Tổng doanh thu: 70 USD")).toBeInTheDocument();
        expect(getStatisticalCv).not.toHaveBeenCalled();

        const ranges = screen.getAllByTestId("dashboard-range");
        fireEvent.click(ranges[0]);
        await waitFor(() => expect(getStatisticalPackagePost).toHaveBeenLastCalledWith({
            fromDate: "2026-08-01", toDate: "2026-08-20", limit: 5, offset: 0,
        }));
        fireEvent.click(ranges[1]);
        await waitFor(() => expect(getStatisticalPackageCv).toHaveBeenLastCalledWith({
            fromDate: "2026-08-01", toDate: "2026-08-20", limit: 5, offset: 0,
        }));

        const pagers = screen.getAllByTestId("dashboard-pager");
        fireEvent.click(pagers[0]);
        await waitFor(() => expect(getStatisticalPackagePost).toHaveBeenLastCalledWith(expect.objectContaining({
            fromDate: "2026-08-01", toDate: "2026-08-20", offset: 5,
        })));
        fireEvent.click(pagers[1]);
        await waitFor(() => expect(getStatisticalPackageCv).toHaveBeenLastCalledWith(expect.objectContaining({
            fromDate: "2026-08-01", toDate: "2026-08-20", offset: 5,
        })));

        const exports = screen.getAllByRole("button", { name: /Xuất excel/ });
        fireEvent.click(exports[0]);
        await waitFor(() => expect(CommonUtils.exportExcel).toHaveBeenCalledWith([
            { "Mã gói": 11, "Tên gói": "Gói bài hot", "Loại gói": "Loại nổi bật", "Số lượng": 4, "Tổng": "80USD" },
        ], "Statistical Package Post", "Statistical Package Post"));
        expect(getStatisticalPackagePost).toHaveBeenLastCalledWith({
            fromDate: "2026-08-01", toDate: "2026-08-20", limit: "", offset: "",
        });

        fireEvent.click(exports[1]);
        await waitFor(() => expect(CommonUtils.exportExcel).toHaveBeenCalledWith([
            { "Mã gói": 12, "Tên gói": "Gói xem CV", "Số lượng": 5, "Tổng": "70USD" },
        ], "Statistical Package Candiate", "Statistical Package Candiate"));
    });

    it("loads and filters the company CV table without requesting administrator revenue", async () => {
        localStorage.setItem("userData", JSON.stringify({
            id: 8, companyId: 42, roleCode: "EMPLOYER", firstName: "Nhà", lastName: "Tuyển dụng",
        }));
        render(<Home />);
        expect(await screen.findByText("Xin chào Nhà Tuyển dụng")).toBeInTheDocument();
        expect(await screen.findByText("Frontend Engineer")).toBeInTheDocument();
        expect(getStatisticalCv).toHaveBeenCalledWith(expect.objectContaining({ companyId: 42, limit: 5, offset: 0 }));
        expect(getStatisticalPackagePost).not.toHaveBeenCalled();
        expect(getStatisticalPackageCv).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId("dashboard-range"));
        await waitFor(() => expect(getStatisticalCv).toHaveBeenLastCalledWith({
            companyId: 42, fromDate: "2026-08-01", toDate: "2026-08-20", limit: 5, offset: 0,
        }));
        fireEvent.click(screen.getByTestId("dashboard-pager"));
        await waitFor(() => expect(getStatisticalCv).toHaveBeenLastCalledWith({
            companyId: 42, fromDate: "2026-08-01", toDate: "2026-08-20", limit: 5, offset: 5,
        }));
    });

    it("shows a repeated chart API failure only once until a successful refresh", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN", firstName: "A", lastName: "B" }));
        getStatisticalTypePost.mockResolvedValue({ errCode: 1, errMessage: "Không tải được top ngành" });
        render(<Home />);
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không tải được top ngành"));
        fireEvent.click(screen.getByRole("button", { name: "Làm mới dashboard" }));
        fireEvent.click(screen.getByRole("button", { name: "Làm mới dashboard" }));
        await waitFor(() => expect(getStatisticalTypePost).toHaveBeenCalledTimes(3));
        expect(toast.error).toHaveBeenCalledTimes(1);
    });
});
