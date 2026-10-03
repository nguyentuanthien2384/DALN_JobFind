import React from "react";
import { act, fireEvent, render as renderView, screen, waitFor, within } from "@testing-library/react";
import dayjs from "dayjs";
import { toast } from "react-toastify";
import CommonUtils from "../../util/CommonUtils";
import { getStatisticalCv } from "../../service/cvService";
import {
    getAllCompany, getAllPostByRoleAdminService, getStatisticalPackageCv, getStatisticalPackagePost, getStatisticalTypePost,
} from "../../service/userService";
import { supportRequest } from "../../service/supportChatService";
import {
    getAuditLogs, getDistribution, getOverview, getSystemFunnel, getSystemStatus, getTimeseries,
} from "../../service/adminReportService";
import { resetAdminAttentionForTests } from "./adminAttention";
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
    getAllCompany: jest.fn(),
    getAllPostByRoleAdminService: jest.fn(),
    getStatisticalPackageCv: jest.fn(),
    getStatisticalPackagePost: jest.fn(),
    getStatisticalTypePost: jest.fn(),
}));
jest.mock("../../service/supportChatService", () => ({ supportRequest: jest.fn() }));
jest.mock("../../service/adminReportService", () => ({
    getAuditLogs: jest.fn(),
    getDistribution: jest.fn(),
    getOverview: jest.fn(),
    getSystemFunnel: jest.fn(),
    getSystemStatus: jest.fn(),
    getTimeseries: jest.fn(),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("recharts", () => {
    const passthrough = ({ children }) => <div>{children}</div>;
    const chart = ({ children }) => <svg>{children}</svg>;
    const none = () => null;
    return {
        ResponsiveContainer: passthrough, AreaChart: chart, ComposedChart: chart,
        Area: none, Line: none, XAxis: none, YAxis: none, CartesianGrid: none, Tooltip: none,
    };
});
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
const day = (offset = 0) => dayjs().subtract(offset, 'day').format('YYYY-MM-DD');
// Intl puts a no-break space before the currency symbol.
const money = (text) => new RegExp(`^${text.replace(/[$.]/g, '\\$&').replace(/ /g, '\\s')}$`);

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
const overview = (revenue, applications, hired, newUsers = 2) => ({
    errCode: 0,
    data: {
        nguoiDung: { tong: 128, moi: newUsers }, congTy: 25,
        tinTuyenDung: { dangHienThi: 30, choDuyet: 10 },
        hoSoUngTuyen: { tong: applications, daTuyen: hired },
        doanhThu: { tong: revenue, goiTin: revenue / 3, goiXemCv: (revenue / 3) * 2 },
    },
});
const services = ['support', 'identity', 'jobs', 'search', 'applications', 'admin', 'legacy']
    .map(key => ({ key, name: `${key}-service`, healthy: key !== 'search', lastCheck: '2026-10-02T14:30:13.628Z' }));

const mockAdminSources = () => {
    getOverview.mockImplementation(({ fromDate }) => Promise.resolve(fromDate === day(29) ? overview(375.3, 422, 70) : overview(300, 0, 0, 4)));
    getTimeseries.mockResolvedValue({ errCode: 0, data: {
        tinTuyenDung: [{ ngay: day(2), soLuong: 3 }, { ngay: day(40), soLuong: 2 }],
        nguoiDungMoi: [{ ngay: day(1), soLuong: 2 }],
        doanhThu: [{ ngay: day(1), tien: 12.5 }],
        doanhThuXemCv: [{ ngay: day(1), tien: 7.5 }],
        hoSoUngTuyen: [{ ngay: day(0), soLuong: 5 }, { ngay: day(3), soLuong: 4 }],
    } });
    getSystemFunnel.mockResolvedValue({ errCode: 0, data: {
        tong: 10, tyLeTuyen: 20,
        pheu: [{ stage: 'moi_ung_tuyen', ten: 'Mới ứng tuyển', soLuong: 8 }, { stage: 'nhan_viec', ten: 'Đã nhận việc', soLuong: 2 }],
    } });
    getDistribution.mockResolvedValue({ errCode: 0, data: {
        theoNganhNghe: [{ ten: 'Công nghệ thông tin', soLuong: 11 }, { ten: 'Luật', soLuong: 3 }],
        theoTinhThanh: [{ ten: 'Vĩnh Long', soLuong: 6 }],
    } });
    getAuditLogs.mockResolvedValue({ errCode: 0, data: [{
        _id: 'e1', kind: 'event', name: 'application.submitted', targetType: 'job', targetId: '233',
        createdAt: new Date().toISOString(),
    }] });
    getSystemStatus.mockResolvedValue({ gateway: 'ok', services, circuitBreakers: [{ service: 'search', state: 'open' }] });
    getAllPostByRoleAdminService.mockResolvedValue({ errCode: 0, count: 10, data: [] });
    getAllCompany.mockResolvedValue({ errCode: 0, count: 0, data: [] });
    supportRequest.mockResolvedValue([{ id: 'a', status: 'waiting' }, { id: 'b', status: 'waiting' }, { id: 'c', status: 'resolved' }]);
};

describe("admin dashboard", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        resetAdminAttentionForTests();
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN", firstName: "Quản", lastName: "Trị" }));
        mockAdminSources();
        getStatisticalPackagePost.mockResolvedValue(postPackageStats);
        getStatisticalPackageCv.mockResolvedValue(cvPackageStats);
    });

    it("compares the default 30-day period with the previous one and shows every operational block", async () => {
        render(<Home />);
        expect(await screen.findByText(/Xin chào Quản Trị/)).toBeInTheDocument();
        await waitFor(() => expect(getOverview).toHaveBeenCalledTimes(2));
        expect(getOverview).toHaveBeenCalledWith({ fromDate: day(29), toDate: day(0) });
        expect(getOverview).toHaveBeenCalledWith({ fromDate: day(59), toDate: day(30) });
        expect(getTimeseries).toHaveBeenCalledWith({ fromDate: day(59), toDate: day(0) });
        expect(getAuditLogs).toHaveBeenCalledWith({ kind: 'event', limit: 8 });
        expect(getStatisticalTypePost).not.toHaveBeenCalled();
        expect(getStatisticalCv).not.toHaveBeenCalled();

        const revenue = (await screen.findByText(money('375,30 US$'))).closest('[data-kpi]');
        expect(revenue).toHaveTextContent('25,1%');
        const applications = screen.getByText('422').closest('[data-kpi]');
        expect(applications).toHaveTextContent('Mới phát sinh');
        expect(applications).toHaveTextContent('70 hồ sơ đã nhận việc');
        // New jobs come from the daily series: 3 in this period, 2 in the previous one.
        expect(screen.getByText('Tin tuyển dụng mới', { selector: '.jf-kpi__label' }).closest('[data-kpi]')).toHaveTextContent('3');
        expect(screen.getByText('Tin tuyển dụng mới', { selector: '.jf-kpi__label' }).closest('[data-kpi]')).toHaveTextContent('50%');
        expect(screen.getByText('Người dùng mới', { selector: '.jf-kpi__label' }).closest('[data-kpi]')).toHaveTextContent('50%');

        const attention = screen.getByRole('region', { name: 'Việc cần xử lý' });
        await waitFor(() => expect(within(attention).getByText('Tin tuyển dụng chờ duyệt').closest('a')).toHaveTextContent('10'));
        expect(within(attention).getByText('Tin tuyển dụng chờ duyệt').closest('a')).toHaveAttribute('href', '/admin/list-post-admin/');
        expect(within(attention).getByText('Công ty chờ duyệt').closest('a')).toHaveTextContent('Không tồn đọng');
        expect(within(attention).getByText('Yêu cầu hỗ trợ chờ tiếp nhận').closest('a')).toHaveTextContent('2');
        expect(within(attention).getByText('Dịch vụ đang gián đoạn').closest('a')).toHaveTextContent('1');
        expect(getAllPostByRoleAdminService).toHaveBeenCalledWith({ limit: 1, offset: 0, search: '', censorCode: 'PS3' });
        expect(getAllCompany).toHaveBeenCalledWith({ limit: 1, offset: 0, search: '', censorCode: 'CS3' });

        expect(screen.getByTestId('trend-chart')).toHaveAttribute('data-points', '30');
        expect(screen.getByText('Nhận việc 20%')).toBeInTheDocument();
        expect(screen.getByText('Công nghệ thông tin')).toBeInTheDocument();
        expect(screen.getByText('Ứng viên nộp hồ sơ')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Tin #233' })).toHaveAttribute('href', '/detail-job/233');
        expect(screen.getByText('6/7 dịch vụ hoạt động', { exact: false })).toBeInTheDocument();
        expect(screen.getByText('Gián đoạn')).toBeInTheDocument();
        expect(screen.getByText('Ngắt mạch: open')).toBeInTheDocument();

        expect(await screen.findByText("Gói bài hot")).toBeInTheDocument();
        expect(screen.getByText("Gói xem CV")).toBeInTheDocument();
        expect(screen.getByText(money('Tổng doanh thu: 120,00 US$'))).toBeInTheDocument();
        expect(getStatisticalPackagePost).toHaveBeenCalledWith({ fromDate: day(29), toDate: day(0), limit: 5, offset: 0 });
    });

    it("switches the trend metric and widens a one-day period to fourteen days", async () => {
        render(<Home />, '/admin?period=today');
        await waitFor(() => expect(getOverview).toHaveBeenCalledWith({ fromDate: day(0), toDate: day(0) }));
        expect(getOverview).toHaveBeenCalledWith({ fromDate: day(1), toDate: day(1) });
        // The series covers both the previous day and the 14-day trend comparison.
        expect(getTimeseries).toHaveBeenCalledWith({ fromDate: day(27), toDate: day(0) });
        expect(await screen.findByText(/14 ngày gần nhất/)).toBeInTheDocument();
        expect(screen.getByTestId('trend-chart')).toHaveAttribute('data-points', '14');
        await screen.findByText('9');
        fireEvent.click(screen.getByRole('tab', { name: 'Doanh thu' }));
        expect(screen.getByRole('tab', { name: 'Doanh thu' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText(money('20,00 US$'), { selector: 'strong' })).toBeInTheDocument();
    });

    it("applies one period to KPIs and revenue tables, resets their pages and keeps it in the URL", async () => {
        getStatisticalPackagePost.mockResolvedValue({ ...postPackageStats, count: 30 });
        render(<Home />, '/admin?post.page=3');
        await waitFor(() => expect(getStatisticalPackagePost).toHaveBeenCalledWith({ fromDate: day(29), toDate: day(0), limit: 5, offset: 10 }));

        fireEvent.click(screen.getByRole('button', { name: '7 ngày' }));
        await waitFor(() => expect(getOverview).toHaveBeenCalledWith({ fromDate: day(6), toDate: day(0) }));
        expect(getOverview).toHaveBeenCalledWith({ fromDate: day(13), toDate: day(7) });
        await waitFor(() => expect(getStatisticalPackagePost).toHaveBeenLastCalledWith({ fromDate: day(6), toDate: day(0), limit: 5, offset: 0 }));
        expect(getStatisticalPackageCv).toHaveBeenLastCalledWith({ fromDate: day(6), toDate: day(0), limit: 5, offset: 0 });
        expect(screen.getByTestId('location').textContent).toContain('period=7d');
        expect(screen.getByTestId('location').textContent).not.toContain('post.page');
        expect(screen.getByRole('button', { name: '7 ngày' })).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(screen.getByRole('button', { name: /Tùy chọn/ }));
        fireEvent.click(screen.getByTestId('dashboard-range'));
        await waitFor(() => expect(getOverview).toHaveBeenCalledWith({ fromDate: '2026-08-01', toDate: '2026-08-20' }));
        expect(getOverview).toHaveBeenCalledWith({ fromDate: '2026-07-12', toDate: '2026-07-31' });
        expect(screen.getByTestId('location').textContent).toContain('period=custom&from=2026-08-01&to=2026-08-20');
        expect(screen.getByText(/so với 20 ngày liền trước/)).toBeInTheDocument();
    });

    it("falls back to the default period for an invalid or future custom range", async () => {
        render(<Home />, `/admin?period=custom&from=2026-02-31&to=${dayjs().add(3, 'day').format('YYYY-MM-DD')}`);
        await waitFor(() => expect(getOverview).toHaveBeenCalledWith({ fromDate: day(29), toDate: day(0) }));
        expect(getOverview).not.toHaveBeenCalledWith(expect.objectContaining({ fromDate: '2026-02-31' }));
    });

    it("exports each revenue table for the selected period", async () => {
        render(<Home />, '/admin?period=7d');
        await screen.findByText("Gói bài hot");
        const exports = screen.getAllByRole("button", { name: /Xuất Excel/ });
        fireEvent.click(exports[0]);
        await waitFor(() => expect(CommonUtils.exportExcel).toHaveBeenCalledWith([
            { "Mã gói": 11, "Tên gói": "Gói bài hot", "Loại gói": "Loại nổi bật", "Số lượng": 4, "Tổng": "80USD" },
        ], "Doanh thu goi dang tin", `Doanh thu goi dang tin ${day(6)} - ${day(0)}`));
        expect(getStatisticalPackagePost).toHaveBeenLastCalledWith({ fromDate: day(6), toDate: day(0), limit: "", offset: "" });
        fireEvent.click(exports[1]);
        await waitFor(() => expect(CommonUtils.exportExcel).toHaveBeenCalledWith([
            { "Mã gói": 12, "Tên gói": "Gói xem CV", "Số lượng": 5, "Tổng": "70USD" },
        ], "Doanh thu goi xem ung vien", `Doanh thu goi xem ung vien ${day(6)} - ${day(0)}`));
    });

    it('clamps both revenue tables without losing the other table query', async () => {
        getStatisticalPackagePost.mockResolvedValue({ ...postPackageStats, count: 7 });
        getStatisticalPackageCv.mockResolvedValue({ ...cvPackageStats, count: 12 });
        render(<Home />, '/admin?period=7d&post.page=10&packageCv.page=10&campaign=keep');
        await waitFor(() => expect(screen.getAllByTestId('dashboard-pager').map(el => el.dataset.page)).toEqual(['1', '2']));
        expect(getStatisticalPackagePost).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5, fromDate: day(6) }));
        expect(getStatisticalPackageCv).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, fromDate: day(6) }));
        const url = screen.getByTestId('location').textContent;
        expect(url).toContain('post.page=2');
        expect(url).toContain('packageCv.page=3');
        expect(url).toContain('campaign=keep');
    });

    it('keeps only the changing statistics table busy until its new page is ready', async () => {
        const view = render(<Home />);
        await screen.findByText('Gói bài hot');
        await screen.findByText('Gói xem CV');
        const tables = [...view.container.querySelectorAll('.stable-list')];
        const pagers = screen.getAllByTestId('dashboard-pager');
        let finish;
        getStatisticalPackagePost.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        fireEvent.click(pagers[0]);
        expect(tables[0]).toHaveAttribute('aria-busy', 'true');
        expect(tables[1]).toHaveAttribute('aria-busy', 'false');
        expect(screen.getByText('Gói bài hot').closest('[inert]')).not.toBeNull();
        expect(screen.getByText('Gói xem CV').closest('[inert]')).toBeNull();
        await act(async () => finish({ ...postPackageStats, data: [{ ...postPackageStats.data[0], name: 'Gói trang kế tiếp' }] }));
        expect(tables[0]).toHaveAttribute('aria-busy', 'false');
        expect(screen.queryByText('Gói bài hot')).not.toBeInTheDocument();
        expect(screen.getByText('Gói trang kế tiếp')).toBeInTheDocument();
        expect(screen.getByTestId('location').textContent).toContain('post.page=2');
    });

    it('ignores a late overview for a period the administrator already left', async () => {
        let finishOld;
        getOverview.mockImplementation(({ fromDate }) => {
            if (fromDate === day(29)) return new Promise(resolve => { finishOld = resolve; });
            return Promise.resolve(fromDate === day(6) ? overview(42, 7, 1) : overview(10, 5, 1));
        });
        render(<Home />);
        await waitFor(() => expect(finishOld).toBeDefined());
        fireEvent.click(screen.getByRole('button', { name: '7 ngày' }));
        expect(await screen.findByText(money('42,00 US$'))).toBeInTheDocument();
        await act(async () => finishOld(overview(999, 1, 1)));
        expect(screen.queryByText(money('999,00 US$'))).not.toBeInTheDocument();
        expect(screen.getByText(money('42,00 US$'))).toBeInTheDocument();
    });

    it('reports an overview outage once, keeps other blocks and recovers on refresh', async () => {
        getOverview.mockRejectedValue(new Error('offline'));
        render(<Home />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được số liệu tổng quan');
        expect(await screen.findByText('Nhận việc 20%')).toBeInTheDocument();
        expect(screen.getByText('Ứng viên nộp hồ sơ')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Làm mới dashboard' }));
        await waitFor(() => expect(getOverview).toHaveBeenCalledTimes(4));
        expect(toast.error).toHaveBeenCalledTimes(1);

        mockAdminSources();
        fireEvent.click(screen.getByRole('button', { name: 'Làm mới dashboard' }));
        expect(await screen.findByText(money('375,30 US$'))).toBeInTheDocument();
        expect(screen.queryByText(/Bấm Làm mới để thử lại/)).not.toBeInTheDocument();
    });

    it('shows unknown work counts instead of zero when their sources fail', async () => {
        getAllPostByRoleAdminService.mockRejectedValue(new Error('offline'));
        getAllCompany.mockResolvedValue({ errCode: 1 });
        supportRequest.mockRejectedValue(new Error('offline'));
        getSystemStatus.mockResolvedValue({ errCode: 403 });
        render(<Home />);
        await waitFor(() => expect(supportRequest).toHaveBeenCalled());
        const attention = screen.getByRole('region', { name: 'Việc cần xử lý' });
        await waitFor(() => expect(within(attention).getAllByText('Chưa có số liệu')).toHaveLength(3));
        expect(within(attention).getByText('Chưa kiểm tra được')).toBeInTheDocument();
        expect(await screen.findByText('Không lấy được trạng thái dịch vụ.')).toBeInTheDocument();
        expect(within(attention).queryByText('Không tồn đọng')).not.toBeInTheDocument();
    });
});

describe("company dashboard", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        resetAdminAttentionForTests();
        getStatisticalTypePost.mockResolvedValue(typeStats);
        getStatisticalCv.mockResolvedValue({ errCode: 0, count: 6, data: [{
            id: 90,
            total: 3,
            postDetailData: { name: "Frontend Engineer" },
            userPostData: { firstName: "An", lastName: "Trần" },
        }] });
    });

    it("loads and filters the company CV table without requesting administrator data", async () => {
        localStorage.setItem("userData", JSON.stringify({
            id: 8, companyId: 42, roleCode: "EMPLOYER", firstName: "Nhà", lastName: "Tuyển dụng",
            companyStatusCode: "S1", companyCensorCode: "CS1",
        }));
        render(<Home />);
        expect(await screen.findByText(/Xin chào Nhà Tuyển dụng/)).toBeInTheDocument();
        expect(await screen.findByText("Frontend Engineer")).toBeInTheDocument();
        expect(screen.getByText("Công nghệ")).toBeInTheDocument();
        expect(screen.getByText("Lĩnh vực khác")).toBeInTheDocument();
        expect(getStatisticalCv).toHaveBeenCalledWith(expect.objectContaining({ companyId: 42, limit: 5, offset: 0 }));
        expect(getStatisticalPackagePost).not.toHaveBeenCalled();
        expect(getOverview).not.toHaveBeenCalled();
        expect(getAllPostByRoleAdminService).not.toHaveBeenCalled();
        expect(screen.getByRole('link', { name: /Đăng tin mới/ })).toHaveAttribute('href', '/admin/add-post/');
        expect(screen.getByRole('link', { name: /Quy trình tuyển dụng/ })).toHaveAttribute('href', '/admin/pipeline/');

        fireEvent.click(screen.getByTestId("dashboard-range"));
        await waitFor(() => expect(getStatisticalCv).toHaveBeenLastCalledWith({
            companyId: 42, fromDate: "2026-08-01", toDate: "2026-08-20", limit: 5, offset: 0,
        }));
        fireEvent.click(screen.getByTestId("dashboard-pager"));
        await waitFor(() => expect(getStatisticalCv).toHaveBeenLastCalledWith({
            companyId: 42, fromDate: "2026-08-01", toDate: "2026-08-20", limit: 5, offset: 5,
        }));
    });

    it("hides shortcuts the account is not allowed to use", async () => {
        localStorage.setItem('userData', JSON.stringify({ id: 8, companyId: 42, roleCode: 'COMPANY', companyStatusCode: 'S1', companyCensorCode: 'CS3' }));
        render(<Home />);
        await screen.findByText('Frontend Engineer');
        expect(screen.queryByRole('navigation', { name: 'Lối tắt' })).not.toBeInTheDocument();
    });

    it("shows a repeated chart API failure only once until a successful refresh", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 8, companyId: 42, roleCode: "EMPLOYER" }));
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

    it('repairs malformed dashboard dates without discarding the restored page', async () => {
        localStorage.setItem('userData', JSON.stringify({ id: 8, companyId: 42, roleCode: 'EMPLOYER' }));
        getStatisticalCv.mockResolvedValue({ errCode: 0, count: 15, data: [] });
        render(<Home />, '/admin?cv.page=3&cv.fromDate=2026-02-31&cv.toDate=invalid');
        await waitFor(() => expect(getStatisticalCv).toHaveBeenCalled());
        const today = day(0);
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
