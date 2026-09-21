import React from "react";
import { act, fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import CommonUtils from "../../util/CommonUtils";
import { getStatisticalCv } from "../../service/cvService";
import { getStatisticalPackageCv, getStatisticalPackagePost, getStatisticalTypePost } from "../../service/userService";
import Home from "./Home";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";

// CRA's Jest resolver predates React Router's /dom package export.
jest.mock('react-router-dom', () => {
    global.TextEncoder = require('util').TextEncoder;
    global.TextDecoder = require('util').TextDecoder;
    return jest.requireActual('react-router');
});
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
    <button type="button" data-testid="dashboard-pager" data-page={props.forcePage} onClick={() => props.onPageChange({ selected: 1 })}>page</button>
));
jest.mock("antd", () => ({
    DatePicker: {
        RangePicker: ({ onChange, value }) => (
            <button type="button" data-testid="dashboard-range" data-range={value?.map(date => date.format("YYYY-MM-DD")).join("/")} onClick={() => onChange([
                { format: () => "2026-08-01" },
                { format: () => "2026-08-20" },
            ])}>range</button>
        ),
    },
}));

const LocationProbe = () => {
    const location = useLocation();
    const navigate = useNavigate();
    return <><span data-testid="location">{location.pathname + location.search}</span><button onClick={() => navigate(-1)}>Back</button></>;
};
const render = (view, entry = '/admin') => renderView(<MemoryRouter initialEntries={[entry]}>{view}<LocationProbe /></MemoryRouter>);

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

    it('keeps company CV statistics available when the chart request rejects and recovers on refresh', async () => {
        localStorage.setItem('userData', JSON.stringify({ id: 8, companyId: 42, roleCode: 'EMPLOYER' }));
        getStatisticalTypePost.mockRejectedValueOnce(new Error('Network unavailable'));
        render(<Home />);
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Không tải được biểu đồ thống kê'));
        expect(screen.queryByTestId('job-type-chart')).not.toBeInTheDocument();
        expect(await screen.findByText('Frontend Engineer')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Làm mới dashboard' }));
        expect(await screen.findByTestId('job-type-chart')).toBeInTheDocument();
        expect(screen.queryByText(/Không tải được biểu đồ thống kê/)).not.toBeInTheDocument();
    });

    it('shows an empty state without reserving an empty chart when there are no jobs', async () => {
        localStorage.setItem('userData', JSON.stringify({ id: 8, companyId: 42, roleCode: 'EMPLOYER' }));
        getStatisticalTypePost.mockResolvedValue({ errCode: 0, totalPost: 0, data: [] });
        render(<Home />);
        expect(await screen.findByText('Frontend Engineer')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Chưa có dữ liệu thống kê lĩnh vực.');
        expect(screen.queryByTestId('job-type-chart')).not.toBeInTheDocument();
        expect(toast.error).not.toHaveBeenCalled();
    });
    it('restores independent revenue pages and dates after reload, refresh and back navigation', async () => {
        localStorage.setItem('userData', JSON.stringify({ id: 1, roleCode: 'ADMIN' }));
        getStatisticalPackagePost.mockResolvedValue({ ...postPackageStats, count: 30 });
        getStatisticalPackageCv.mockResolvedValue({ ...cvPackageStats, count: 30 });
        const entry = '/admin?post.page=3&post.fromDate=2026-07-01&post.toDate=2026-07-31&packageCv.page=4&packageCv.fromDate=2026-08-01&packageCv.toDate=2026-08-15&campaign=keep';
        const first = render(<Home />, entry);
        await waitFor(() => expect(getStatisticalPackagePost).toHaveBeenCalledWith({ fromDate: '2026-07-01', toDate: '2026-07-31', limit: 5, offset: 10 }));
        expect(getStatisticalPackageCv).toHaveBeenCalledWith({ fromDate: '2026-08-01', toDate: '2026-08-15', limit: 5, offset: 15 });
        expect(getStatisticalPackagePost).toHaveBeenCalledTimes(1);
        expect(screen.getAllByTestId('dashboard-pager').map(el => el.dataset.page)).toEqual(['2', '3']);
        expect(screen.getAllByTestId('dashboard-range').map(el => el.dataset.range)).toEqual(['2026-07-01/2026-07-31', '2026-08-01/2026-08-15']);
        fireEvent.click(screen.getAllByTestId('dashboard-pager')[0]);
        await waitFor(() => expect(getStatisticalPackagePost).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5 })));
        expect(getStatisticalPackageCv).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('location').textContent).toContain('packageCv.page=4');
        expect(screen.getByTestId('location').textContent).toContain('campaign=keep');
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        await waitFor(() => expect(getStatisticalPackagePost).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10 })));
        fireEvent.click(screen.getByRole('button', { name: 'Làm mới dashboard' }));
        await waitFor(() => expect(getStatisticalPackagePost).toHaveBeenCalledTimes(4));
        const restoredUrl = screen.getByTestId('location').textContent;
        first.unmount();
        render(<Home />, restoredUrl);
        await waitFor(() => expect(getStatisticalPackagePost).toHaveBeenCalledTimes(5));
        expect(getStatisticalPackagePost).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, fromDate: '2026-07-01' }));
        expect(getStatisticalPackageCv).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 15, fromDate: '2026-08-01' }));
    });

    it('does not let a late page response clamp or replace a newer dashboard page', async () => {
        localStorage.setItem('userData', JSON.stringify({ id: 8, companyId: 42, roleCode: 'EMPLOYER' }));
        let completeOld;
        getStatisticalCv.mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve; }));
        const next = { errCode: 0, count: 15, data: [{ id: 91, total: 2, postDetailData: { name: 'Newest page' }, userPostData: { firstName: 'A', lastName: 'B' } }] };
        getStatisticalCv.mockResolvedValue(next);
        render(<Home />, '/admin?cv.page=3');
        fireEvent.click(screen.getByTestId('dashboard-pager'));
        expect(await screen.findByText('Newest page')).toBeInTheDocument();
        await act(async () => completeOld({ errCode: 0, count: 0, data: [] }));
        expect(screen.getByText('Newest page')).toBeInTheDocument();
        expect(screen.getByTestId('location').textContent).toContain('cv.page=2');
    });

    it('clamps both dashboard tables without losing the other table query', async () => {
        localStorage.setItem('userData', JSON.stringify({ id: 1, roleCode: 'ADMIN' }));
        getStatisticalPackagePost.mockResolvedValue({ ...postPackageStats, count: 7 });
        getStatisticalPackageCv.mockResolvedValue({ ...cvPackageStats, count: 12 });
        render(<Home />, '/admin?post.page=10&post.fromDate=2026-07-01&post.toDate=2026-07-31&packageCv.page=10&packageCv.fromDate=2026-08-01&packageCv.toDate=2026-08-15');
        await waitFor(() => expect(screen.getAllByTestId('dashboard-pager').map(el => el.dataset.page)).toEqual(['1', '2']));
        expect(getStatisticalPackagePost).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5, fromDate: '2026-07-01' }));
        expect(getStatisticalPackageCv).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, fromDate: '2026-08-01' }));
        expect(screen.getByTestId('location').textContent).toContain('post.page=2');
        expect(screen.getByTestId('location').textContent).toContain('packageCv.page=3');
    });

    it('repairs malformed dashboard dates without discarding the restored page', async () => {
        localStorage.setItem('userData', JSON.stringify({ id: 8, companyId: 42, roleCode: 'EMPLOYER' }));
        getStatisticalCv.mockResolvedValue({ errCode: 0, count: 15, data: [] });
        render(<Home />, '/admin?cv.page=3&cv.fromDate=2026-02-31&cv.toDate=invalid');
        await waitFor(() => expect(getStatisticalCv).toHaveBeenCalled());
        const today = require('dayjs')().format('YYYY-MM-DD');
        expect(getStatisticalCv).toHaveBeenLastCalledWith({ companyId: 42, limit: 5, offset: 10, fromDate: today, toDate: today });
        expect(screen.getByTestId('dashboard-range')).toHaveAttribute('data-range', `${today}/${today}`);
        expect(screen.getByTestId('location').textContent).toContain('cv.page=3');
        expect(screen.getByTestId('location').textContent).not.toContain('invalid');
        expect(screen.getByTestId('location').textContent).not.toContain('2026-02-31');
    });

    it('retains rows after same-page refresh failure but hides them on a failed page change', async () => {
        localStorage.setItem('userData', JSON.stringify({ id: 8, companyId: 42, roleCode: 'EMPLOYER' }));
        render(<Home />);
        expect(await screen.findByText('Frontend Engineer')).toBeInTheDocument();
        getStatisticalCv.mockRejectedValue(new Error('offline'));
        fireEvent.click(screen.getByRole('button', { name: 'Làm mới dashboard' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Không tải được dữ liệu thống kê'));
        expect(screen.getByText('Frontend Engineer')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('dashboard-pager'));
        await waitFor(() => expect(getStatisticalCv).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5 })));
        expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được dữ liệu thống kê');
        expect(screen.queryByText('Frontend Engineer')).not.toBeInTheDocument();
        expect(screen.getByTestId('location').textContent).toContain('cv.page=2');
    });

    it('keeps the original default date when a saved dashboard page is reopened the next day', async () => {
        localStorage.setItem('userData', JSON.stringify({ id: 8, companyId: 42, roleCode: 'EMPLOYER' }));
        const NativeDate = global.Date;
        let now = new NativeDate('2026-09-21T12:00:00').getTime();
        global.Date = class extends NativeDate {
            constructor(...args) { super(...(args.length ? args : [now])); }
            static now() { return now; }
        };
        try {
            const first = render(<Home />);
            await screen.findByText('Frontend Engineer');
            fireEvent.click(screen.getByTestId('dashboard-pager'));
            await waitFor(() => expect(getStatisticalCv).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5 })));
            const url = screen.getByTestId('location').textContent;
            expect(url).toContain('cv.fromDate=2026-09-21');
            expect(url).toContain('cv.toDate=2026-09-21');
            first.unmount();
            now = new NativeDate('2026-09-22T12:00:00').getTime();
            render(<Home />, url);
            await screen.findByText('Frontend Engineer');
            expect(getStatisticalCv).toHaveBeenLastCalledWith({ companyId: 42, limit: 5, offset: 5, fromDate: '2026-09-21', toDate: '2026-09-21' });
            expect(screen.getByTestId('dashboard-range')).toHaveAttribute('data-range', '2026-09-21/2026-09-21');
        } finally {
            global.Date = NativeDate;
        }
    });

});
