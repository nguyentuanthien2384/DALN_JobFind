import React from "react";
import { render, screen, within } from "@testing-library/react";
import HomeAdmin from "./HomeAdmin";

let mockRoute = "/";

jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        Link: ({ to, children }) => <a href={to}>{children}</a>,
        Navigate: ({ to }) => <div data-testid="redirect">{to}</div>,
        Route: () => null,
        Routes: ({ children }) => {
            const routes = React.Children.toArray(children);
            const match = routes.find((route) => route.props.path === mockRoute)
                || routes.find((route) => route.props.path === "*");
            return match ? match.props.element : null;
        },
        useLocation: () => ({ pathname: `/admin${mockRoute}` }),
        useNavigate: () => jest.fn(),
        useParams: () => ({}),
    };
});
jest.mock("xlsx/xlsx.mjs", () => ({
    utils: { book_new: jest.fn(), json_to_sheet: jest.fn(), book_append_sheet: jest.fn() },
    writeFile: jest.fn(),
}));
jest.mock("react-markdown-editor-lite", () => () => <div />);
jest.mock("markdown-it", () => function MarkdownIt() { return { render: (text) => text }; });
jest.mock("chart.js/auto", () => ({}));
jest.mock("react-chartjs-2", () => ({ Bar: () => <div /> }));
jest.mock("./Header", () => () => <header>ADMIN HEADER</header>);
jest.mock("./Menu", () => () => <nav>ADMIN MENU</nav>);
jest.mock("./Home", () => () => <main>ADMIN HOME</main>);
jest.mock("./Report/ReportDashboard", () => () => <main>ADMIN REPORT</main>);
jest.mock("../Chat/ChatPage", () => () => <main>ADMIN CHAT</main>);
jest.mock("../../components/support/SupportInbox", () => () => <main>SUPPORT INBOX</main>);
jest.mock("./Company/AddCompany", () => () => <main>ADD COMPANY</main>);
jest.mock("./User/UserInfo", () => () => <main>USER INFO</main>);
jest.mock("./Post/ManagePost", () => () => <main>MANAGE POST</main>);
jest.mock("./Cv/FilterCv", () => () => <main>CANDIDATE SEARCH</main>);
jest.mock("./HistoryTrade/HistoryTradePost", () => () => <main>POST TRANSACTIONS</main>);
jest.mock("./HistoryTrade/HistoryTradeCv", () => () => <main>CV TRANSACTIONS</main>);
jest.mock("./PromoCode/ManagePromoCode", () => () => <main>PROMO CODES</main>);
jest.mock("../../components/interviews/InterviewCalendar", () => () => <main>INTERVIEW CALENDAR</main>);
// Layout tests only check the shell; the real list page would call /api/get-all-user.
jest.mock("./User/ManageUser", () => () => <main>MANAGE USER</main>);

const ADMIN = { id: 1, roleCode: "ADMIN" };
const COMPANY = {
    id: 2, roleCode: "COMPANY", companyId: 7,
    companyStatusCode: "S1", companyCensorCode: "CS1",
};
const EMPLOYER = {
    id: 3, roleCode: "EMPLOYER", companyId: 7,
    companyStatusCode: "S1", companyCensorCode: "CS1",
};
const UNATTACHED_EMPLOYER = { id: 4, roleCode: "EMPLOYER" };

const renderAdmin = (route, user = ADMIN) => {
    mockRoute = route;
    return render(<HomeAdmin user={user} />);
};

describe("admin layout shell", () => {
    beforeEach(() => localStorage.clear());

    it("composes the shared header, menu, home content and footer", async () => {
        renderAdmin("/");
        expect(screen.getByText("ADMIN HEADER")).toBeInTheDocument();
        expect(screen.getByText("ADMIN MENU")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("Đang tải giao diện");
        expect(screen.getByText(/Bản quyền/)).toBeVisible();
        expect(await screen.findByText("ADMIN HOME")).toBeInTheDocument();
        expect(screen.getByText(/Bản quyền/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Tin nhắn tuyển dụng" })).toHaveAttribute("href", "/admin/chat");
        expect(screen.getByRole("link", { name: "Quy trình ứng viên" })).toHaveAttribute("href", "/admin/pipeline");
        expect(screen.getByRole("link", { name: "Báo cáo hệ thống" })).toHaveAttribute("href", "/admin/reports");
        expect(screen.queryByText("TO DO LIST")).not.toBeInTheDocument();
        expect(screen.queryByText("Feb 11 2018")).not.toBeInTheDocument();
        expect(document.querySelector('footer a[href="#"]')).toBeNull();
    });

    it("labels each page with a breadcrumb, its primary action and the browser tab title", async () => {
        const dashboard = renderAdmin("/");
        expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
        expect(document.title).toBe("Tổng quan · Quản trị JobFind");
        dashboard.unmount();

        const list = renderAdmin("/list-user");
        const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
        expect(trail).toHaveTextContent("Hệ thống");
        expect(within(trail).getByText("Người dùng").closest("li")).toHaveAttribute("aria-current", "page");
        expect(screen.getByRole("link", { name: "Thêm người dùng" })).toHaveAttribute("href", "/admin/add-user/");
        expect(document.title).toBe("Người dùng · Quản trị JobFind");
        expect(await screen.findByText("MANAGE USER")).toBeInTheDocument();
        list.unmount();
        expect(document.title).not.toContain("Người dùng");

        // A page outside the menu links back to the list it belongs to.
        renderAdmin("/note/51");
        const nested = screen.getByRole("navigation", { name: "Breadcrumb" });
        expect(within(nested).getByRole("link", { name: "Tin tuyển dụng" })).toHaveAttribute("href", "/admin/list-post-admin/");
        expect(within(nested).getByText("Lịch sử kiểm duyệt").closest("li")).toHaveAttribute("aria-current", "page");
        expect(screen.queryByRole("link", { name: /^Thêm/ })).not.toBeInTheDocument();
    });

    it("resolves shared routes against the recruiter's own menu", () => {
        renderAdmin("/edit-user/9", COMPANY);
        const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
        expect(within(trail).getByRole("link", { name: "Danh sách nhân viên" })).toHaveAttribute("href", "/admin/list-employer/");
        expect(trail).toHaveTextContent("Chỉnh sửa người dùng");
        expect(within(trail).getAllByRole("link")[0]).toHaveAttribute("href", "/admin/");
    });

    it.each([
        ["/list-candiate", "Tìm kiếm ứng viên", "Tuyển dụng", "CANDIDATE SEARCH"],
        ["/history-post", "Lịch sử gói bài đăng", "Lịch sử giao dịch", "POST TRANSACTIONS"],
        ["/history-cv", "Lịch sử gói xem ứng viên", "Lịch sử giao dịch", "CV TRANSACTIONS"],
        ["/list-promo-code", "Mã giảm giá", "Kinh doanh", "PROMO CODES"],
        ["/list-post", "Tin tuyển dụng", "Kiểm duyệt & hỗ trợ", "MANAGE POST"],
    ])("labels an ADMIN feature opened directly at %s", async (route, label, parent, content) => {
        renderAdmin(route, ADMIN);
        expect(await screen.findByText(content)).toBeInTheDocument();
        const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
        expect(trail).toHaveTextContent(parent);
        expect(within(trail).getByText(label, { exact: true }).closest("li"))
            .toHaveAttribute("aria-current", "page");
        expect(document.title).toBe(`${label} · Quản trị JobFind`);
    });

    it("selects the requested nested administration route", async () => {
        renderAdmin("/reports");
        expect(await screen.findByText("ADMIN REPORT")).toBeInTheDocument();
        expect(screen.queryByText("ADMIN HOME")).not.toBeInTheDocument();
    });

    it.each([
        ["/chat", UNATTACHED_EMPLOYER, "/forbidden"],
        ["/list-post", UNATTACHED_EMPLOYER, "/forbidden"],
        ["/add-company", EMPLOYER, "/forbidden"],
    ])("returns 403 for disallowed nested route %s", (route, user, destination) => {
        renderAdmin(route, user);
        expect(screen.getByTestId("redirect")).toHaveTextContent(destination);
    });

    it("allows ADMIN to open the chat route", async () => {
        renderAdmin("/chat", ADMIN);
        expect(await screen.findByText("ADMIN CHAT")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Tin nhắn tuyển dụng" })).toHaveAttribute("href", "/admin/chat");
    });
    it('allows only ADMIN to open the support queue', async () => {
        const view = renderAdmin('/support', ADMIN);
        expect(await screen.findByText('SUPPORT INBOX')).toBeInTheDocument();
        view.unmount();
        renderAdmin('/support', COMPANY);
        expect(screen.getByTestId('redirect')).toHaveTextContent('/forbidden');
    });

    it("allows an attached employer to use recruiting and chat routes", async () => {
        const { unmount } = renderAdmin("/chat", EMPLOYER);
        expect(await screen.findByText("ADMIN CHAT")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Tin nhắn tuyển dụng" })).toHaveAttribute("href", "/admin/chat");
        expect(screen.getByRole("link", { name: "Quy trình ứng viên" })).toHaveAttribute("href", "/admin/pipeline");
        unmount();

        renderAdmin("/list-post", EMPLOYER);
        expect(await screen.findByText("MANAGE POST")).toBeInTheDocument();
    });

    it.each([COMPANY, EMPLOYER])("opens the interview calendar for an approved recruiter", async (user) => {
        renderAdmin("/interviews", user);
        expect(await screen.findByText("INTERVIEW CALENDAR")).toBeInTheDocument();
        expect(document.title).toBe("Lịch phỏng vấn · Quản trị JobFind");
        expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Quản lý ứng viên");
    });

    it.each([
        UNATTACHED_EMPLOYER,
        { ...COMPANY, companyCensorCode: "CS2" },
    ])("denies the calendar when the employer has no approved company", (user) => {
        renderAdmin("/interviews", user);
        expect(screen.getByTestId("redirect")).toHaveTextContent("/forbidden");
        expect(screen.queryByText("INTERVIEW CALENDAR")).not.toBeInTheDocument();
    });

    it("redirects an unattached employer away from dashboard without rendering it", () => {
        renderAdmin("/", UNATTACHED_EMPLOYER);

        expect(screen.getByTestId("redirect")).toHaveTextContent("/admin/add-company/");
        expect(screen.queryByText("ADMIN HOME")).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Tin nhắn tuyển dụng" })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Quy trình ứng viên" })).not.toBeInTheDocument();
    });

    it("allows an unattached employer only company creation and self-profile routes", async () => {
        const { unmount } = renderAdmin("/add-company", UNATTACHED_EMPLOYER);
        expect(await screen.findByText("ADD COMPANY")).toBeInTheDocument();
        unmount();

        renderAdmin("/user-info", UNATTACHED_EMPLOYER);
        expect(await screen.findByText("USER INFO")).toBeInTheDocument();
    });

    it("allows an attached COMPANY to chat but denies company creation", async () => {
        const { unmount } = renderAdmin("/chat", COMPANY);
        expect(await screen.findByText("ADMIN CHAT")).toBeInTheDocument();
        unmount();

        renderAdmin("/add-company", COMPANY);
        expect(screen.getByTestId("redirect")).toHaveTextContent("/forbidden");
    });

    it.each([
        ["/payment/cancel", "orderData"],
        ["/paymentCv/cancel", "orderCvData"],
    ])("renders the PayPal cancellation route %s", async (route, storageKey) => {
        localStorage.setItem(storageKey, JSON.stringify({ amount: 1 }));
        renderAdmin(route, COMPANY);

        expect(await screen.findByText("Thanh toán đã được hủy")).toBeInTheDocument();
        expect(localStorage.getItem(storageKey)).toBeNull();
    });
});
