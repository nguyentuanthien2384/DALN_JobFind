import React from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { act, fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import CommonUtils from "../../util/CommonUtils";
import { getHistoryTradeCv, getHistoryTradePost, getSumByYearCv, getSumByYearPost } from "../../service/userService";
import { getAuditLogs, getDistribution, getOverview, getSystemFunnel, getTimeseries } from "../../service/adminReportService";
import ChartPost from "./Chart/ChartPost";
import ChartCv from "./Chart/ChartCv";
import HistoryTradePost from "./HistoryTrade/HistoryTradePost";
import HistoryTradeCv from "./HistoryTrade/HistoryTradeCv";
import ReportDashboard from "./Report/ReportDashboard";

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
jest.mock("../../service/userService", () => ({
    getHistoryTradeCv: jest.fn(),
    getHistoryTradePost: jest.fn(),
    getSumByYearCv: jest.fn(),
    getSumByYearPost: jest.fn(),
}));
jest.mock("../../service/adminReportService", () => ({
    getAuditLogs: jest.fn(),
    getDistribution: jest.fn(),
    getOverview: jest.fn(),
    getSystemFunnel: jest.fn(),
    getTimeseries: jest.fn(),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("chart.js/auto", () => ({}));
jest.mock("react-chartjs-2", () => ({
    Bar: ({ data }) => <div data-testid="monthly-chart" data-chart={JSON.stringify(data)} />,
}));
jest.mock("../../util/useAutoRefresh", () => (loader) => ({
    capNhatLuc: new Date("2026-08-30T00:00:00Z"),
    dangTai: false,
    lamMoi: jest.fn(() => loader()),
}));
jest.mock("./AutoRefreshInfo", () => ({ onLamMoi }) => (
    <button type="button" onClick={onLamMoi}>Làm mới</button>
));
jest.mock("react-paginate", () => (props) => (
    <button type="button" data-testid="next-page" data-page={props.forcePage} onClick={() => props.onPageChange({ selected: 1 })}>page</button>
));
jest.mock("antd", () => {
    const Select = ({ options = [], value, onChange }) => (
        <select aria-label="Năm" value={value} onChange={(event) => onChange(Number(event.target.value))}>
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    );
    const RangePicker = ({ onChange, value }) => <div data-testid="range-value" data-value={value?.map(date => date.format("YYYY-MM-DD")).join("/")}>
        <button type="button" data-testid="set-range" onClick={() => onChange([
            { format: () => "2026-08-01" },
            { format: () => "2026-08-20" },
        ])}>range</button>
        <button type="button" data-testid="clear-range" onClick={() => onChange(null)}>clear</button>
    </div>;
    return {
        Col: ({ children }) => <div>{children}</div>,
        Row: ({ children }) => <div>{children}</div>,
        Select,
        DatePicker: { RangePicker },
    };
});
jest.mock("recharts", () => {
    const React = require("react");
    const passthrough = ({ children }) => <div>{children}</div>;
    return {
        ResponsiveContainer: passthrough,
        LineChart: ({ data, children }) => <div data-testid="line-chart" data-series={JSON.stringify(data)}>{children}</div>,
        BarChart: ({ data, children }) => <div data-testid="bar-chart" data-series={JSON.stringify(data)}>{children}</div>,
        PieChart: passthrough,
        Pie: ({ children }) => <div>{children}</div>,
        Cell: () => <span />,
        Line: () => <span />,
        Bar: () => <span />,
        XAxis: () => <span />,
        YAxis: () => <span />,
        CartesianGrid: () => <span />,
        Tooltip: () => <span />,
        Legend: () => <span />,
    };
});

const LocationProbe = () => {
    const location = useLocation();
    const navigate = useNavigate();
    return <><span data-testid="location">{location.pathname + location.search}</span><button onClick={() => navigate(-1)}>Back</button></>;
};
const render = (view, entry = '/admin/history') => renderView(<MemoryRouter initialEntries={[entry]}>{view}<LocationProbe /></MemoryRouter>);

const chartPages = [
    { label: "post", Component: ChartPost, service: getSumByYearPost, heading: "Đồ thị doanh thu các gói bài đăng" },
    { label: "CV", Component: ChartCv, service: getSumByYearCv, heading: "Đồ thị doanh thu các gói xem ứng viên" },
];

describe("revenue charts", () => {
    beforeEach(() => jest.clearAllMocks());

    it.each(chartPages)("maps sparse $label revenue into all twelve months and reloads for another year", async (config) => {
        config.service.mockResolvedValue({ errCode: 0, data: [{ month: 2, total: 120 }, { month: 12, total: 900 }] });
        render(<config.Component />);
        const currentYear = new Date().getFullYear();
        expect(await screen.findByText(config.heading)).toBeInTheDocument();
        await waitFor(() => expect(config.service).toHaveBeenCalledWith(currentYear));
        await waitFor(() => {
            const payload = JSON.parse(screen.getByTestId("monthly-chart").getAttribute("data-chart"));
            expect(payload.datasets[0].data).toEqual([0, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0, 900]);
        });
        fireEvent.change(screen.getByLabelText("Năm"), { target: { value: "2024" } });
        await waitFor(() => expect(config.service).toHaveBeenLastCalledWith(2024));
    });
});

const historyPages = [
    {
        label: "post",
        Component: HistoryTradePost,
        service: getHistoryTradePost,
        item: {
            id: "ORDER-P",
            amount: 2,
            createdAt: "2026-08-10T08:30:00Z",
            packageOrderData: { name: "Gói hot", price: 5, isHot: 1 },
            userOrderData: { firstName: "Minh", lastName: "Trần" },
        },
        workbook: "History Trade Post",
        exportedName: "Gói hot",
    },
    {
        label: "CV",
        Component: HistoryTradeCv,
        service: getHistoryTradeCv,
        item: {
            id: "ORDER-C",
            amount: 3,
            createdAt: "2026-08-11T08:30:00Z",
            packageOrderCvData: { name: "Gói CV", price: 7 },
            userOrderCvData: { firstName: "Lan", lastName: "Lê" },
        },
        workbook: "History Trade Cv",
        exportedName: "Gói CV",
    },
];

describe("trade history", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 3, companyId: 42 }));
    });

    it.each(historyPages)("filters, pages and exports the $label purchase history", async (config) => {
        config.service.mockResolvedValue({ errCode: 0, count: 7, data: [config.item] });
        render(<config.Component />);
        expect(await screen.findByText(config.item.id)).toBeInTheDocument();
        expect(config.service).toHaveBeenCalledWith({ limit: 5, offset: 0, fromDate: "", toDate: "", companyId: 42 });

        fireEvent.click(screen.getByTestId("set-range"));
        await waitFor(() => expect(config.service).toHaveBeenLastCalledWith(expect.objectContaining({
            fromDate: "2026-08-01", toDate: "2026-08-20", offset: 0, companyId: 42,
        })));
        fireEvent.click(screen.getByTestId("next-page"));
        await waitFor(() => expect(config.service).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5, companyId: 42 })));

        fireEvent.click(screen.getByRole("button", { name: /Xuất excel/ }));
        await waitFor(() => expect(CommonUtils.exportExcel).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ "Tên gói": config.exportedName, "Mã giao dịch": config.item.id })]),
            config.workbook,
            config.workbook
        ));
        expect(config.service).toHaveBeenLastCalledWith(expect.objectContaining({
            limit: "", offset: "", fromDate: "2026-08-01", toDate: "2026-08-20", companyId: 42,
        }));
    });
    it.each(historyPages)('restores $label history page and filters on reload and browser back', async (config) => {
        config.service.mockResolvedValue({ errCode: 0, count: 30, data: [config.item] });
        const first = render(<config.Component />, '/admin/history?page=3&fromDate=2026-07-01&toDate=2026-07-31&source=keep');
        expect(await screen.findByText(config.item.id)).toBeInTheDocument();
        expect(config.service).toHaveBeenCalledTimes(1);
        expect(config.service).toHaveBeenLastCalledWith({ limit: 5, offset: 10, fromDate: '2026-07-01', toDate: '2026-07-31', companyId: 42 });
        expect(screen.getByTestId('next-page')).toHaveAttribute('data-page', '2');
        expect(screen.getByTestId('range-value')).toHaveAttribute('data-value', '2026-07-01/2026-07-31');
        fireEvent.click(screen.getByTestId('next-page'));
        await waitFor(() => expect(config.service).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5, fromDate: '2026-07-01', toDate: '2026-07-31' })));
        const url = screen.getByTestId('location').textContent;
        expect(url).toContain('page=2');
        expect(url).toContain('source=keep');
        first.unmount();
        render(<config.Component />, url);
        await waitFor(() => expect(config.service).toHaveBeenCalledTimes(3));
        expect(config.service).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5, fromDate: '2026-07-01', toDate: '2026-07-31' }));
        fireEvent.click(screen.getByTestId('set-range'));
        await waitFor(() => expect(config.service).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, fromDate: '2026-08-01', toDate: '2026-08-20' })));
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        await waitFor(() => expect(config.service).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5, fromDate: '2026-07-01', toDate: '2026-07-31' })));
        fireEvent.click(screen.getByRole('button', { name: /Xuất excel/ }));
        await waitFor(() => expect(config.service).toHaveBeenLastCalledWith(expect.objectContaining({ limit: '', offset: '', fromDate: '2026-07-01', toDate: '2026-07-31' })));
    });

    it.each(historyPages)('clamps $label history only after a successful total and ignores obsolete responses', async (config) => {
        let finishOld;
        config.service.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
        config.service.mockResolvedValue({ errCode: 0, count: 30, data: [config.item] });
        render(<config.Component />, '/admin/history?page=8');
        expect(screen.getByTestId('next-page')).toHaveAttribute('data-page', '7');
        fireEvent.click(screen.getByTestId('next-page'));
        expect(await screen.findByText(config.item.id)).toBeInTheDocument();
        await act(async () => finishOld({ errCode: 0, count: 0, data: [] }));
        expect(screen.getByTestId('location').textContent).toContain('page=2');
        expect(screen.getByText(config.item.id)).toBeInTheDocument();
    });

    it.each(historyPages)('returns an out-of-range $label history URL to the final available page', async (config) => {
        config.service.mockResolvedValue({ errCode: 0, count: 7, data: [config.item] });
        render(<config.Component />, '/admin/history?page=8&fromDate=2026-07-01&toDate=2026-07-31');
        expect(await screen.findByText(config.item.id)).toBeInTheDocument();
        expect(config.service).toHaveBeenCalledTimes(2);
        expect(config.service).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5, fromDate: '2026-07-01', toDate: '2026-07-31' }));
        expect(screen.getByTestId('location').textContent).toContain('page=2');
    });

    it.each(historyPages)('repairs invalid $label history dates while retaining its page', async (config) => {
        config.service.mockResolvedValue({ errCode: 0, count: 30, data: [config.item] });
        render(<config.Component />, '/admin/history?page=3&fromDate=2026-02-31&toDate=invalid');
        await screen.findByText(config.item.id);
        expect(config.service).toHaveBeenLastCalledWith({ companyId: 42, limit: 5, offset: 10, fromDate: '', toDate: '' });
        expect(screen.getByTestId('location').textContent).toContain('page=3');
        expect(screen.getByTestId('location').textContent).not.toContain('fromDate');
        expect(screen.getByTestId('location').textContent).not.toContain('toDate');
        expect(screen.getByTestId('range-value')).not.toHaveAttribute('data-value');
    });

    it.each(historyPages)('does not display rows from the previous $label history page after a load failure', async (config) => {
        config.service.mockResolvedValueOnce({ errCode: 0, count: 30, data: [config.item] });
        config.service.mockRejectedValue(new Error('offline'));
        render(<config.Component />, '/admin/history?page=3');
        await screen.findByText(config.item.id);
        fireEvent.click(screen.getByTestId('next-page'));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Không tải được lịch sử thanh toán'));
        expect(screen.queryByText(config.item.id)).not.toBeInTheDocument();
        expect(screen.getByTestId('location').textContent).toContain('page=2');
    });

});

const reportResponses = () => ({
    overview: {
        errCode: 0,
        data: {
            nguoiDung: { tong: 120, moi: 6 },
            congTy: 18,
            tinTuyenDung: { dangHienThi: 27, choDuyet: 3 },
            hoSoUngTuyen: { tong: 80, daTuyen: 9 },
            doanhThu: { tong: 3500, goiTin: 2200, goiXemCv: 1300 },
        },
    },
    timeseries: {
        errCode: 0,
        data: {
            tinTuyenDung: [{ ngay: "2026-08-01", soLuong: 2 }],
            nguoiDungMoi: [{ ngay: "2026-08-01", soLuong: 4 }],
            hoSoUngTuyen: [{ ngay: "2026-08-02", soLuong: 5 }],
        },
    },
    distribution: { errCode: 0, data: {
        theoNganhNghe: [{ ten: "IT", soLuong: 10 }],
        theoTinhThanh: [{ ten: "Hà Nội", soLuong: 8 }],
        theoVaiTro: [{ ten: "Ứng viên", soLuong: 50 }],
    } },
    funnel: { errCode: 0, data: { tyLeTuyen: 12, pheu: [{ ten: "Nộp CV", soLuong: 80 }] } },
    logs: { errCode: 0, data: [{
        _id: "log-1", createdAt: "2026-08-29T10:00:00Z", kind: "action",
        name: "Duyệt công ty", actorId: 1, actorRole: "ADMIN", targetType: "company", targetId: 9,
    }] },
});

describe("admin report dashboard", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const response = reportResponses();
        getOverview.mockResolvedValue(response.overview);
        getTimeseries.mockResolvedValue(response.timeseries);
        getDistribution.mockResolvedValue(response.distribution);
        getSystemFunnel.mockResolvedValue(response.funnel);
        getAuditLogs.mockResolvedValue(response.logs);
    });

    it("loads every report source, merges daily activity and refreshes when the range changes", async () => {
        render(<ReportDashboard />);
        expect(screen.getByText("Đang tải số liệu…")).toBeInTheDocument();
        expect(await screen.findByText("Báo cáo & Thống kê")).toBeInTheDocument();
        expect(screen.getByText("120")).toBeInTheDocument();
        expect(screen.getByText(/3 chờ duyệt/)).toBeInTheDocument();
        expect(screen.getByText("Duyệt công ty")).toBeInTheDocument();
        expect(screen.getByText("Tỷ lệ tuyển 12%")).toBeInTheDocument();
        const merged = JSON.parse(screen.getByTestId("line-chart").getAttribute("data-series"));
        expect(merged).toEqual([
            { ngay: "1/8", tin: 2, nguoiDung: 4 },
            { ngay: "2/8", hoSo: 5 },
        ]);
        expect(getAuditLogs).toHaveBeenCalledWith({ limit: 15 });

        fireEvent.change(screen.getByRole("combobox"), { target: { value: "7" } });
        await waitFor(() => expect(getOverview).toHaveBeenCalledTimes(2));
        expect(getTimeseries).toHaveBeenCalledTimes(2);
    });

    it("keeps the dashboard usable when optional datasets are empty and reports overview failure", async () => {
        getOverview.mockResolvedValue({ errCode: 1 });
        getTimeseries.mockResolvedValue({ errCode: 0, data: { tinTuyenDung: [], nguoiDungMoi: [], hoSoUngTuyen: [] } });
        getDistribution.mockResolvedValue({ errCode: 0, data: {} });
        getSystemFunnel.mockResolvedValue({ errCode: 0, data: {} });
        getAuditLogs.mockResolvedValue({ errCode: 0, data: [] });
        render(<ReportDashboard />);
        expect(await screen.findByText("Báo cáo & Thống kê")).toBeInTheDocument();
        expect(toast.error).toHaveBeenCalledWith("Không tải được số liệu tổng quan");
        expect(screen.getByText("Chưa có dữ liệu trong khoảng thời gian này")).toBeInTheDocument();
        expect(screen.getByText("Chưa có hoạt động nào được ghi")).toBeInTheDocument();
    });
});
