import React from "react";
import { render, screen } from "@testing-library/react";
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
jest.mock("./Company/AddCompany", () => () => <main>ADD COMPANY</main>);
jest.mock("./User/UserInfo", () => () => <main>USER INFO</main>);
jest.mock("./Post/ManagePost", () => () => <main>MANAGE POST</main>);

const ADMIN = { id: 1, roleCode: "ADMIN" };
const COMPANY = { id: 2, roleCode: "COMPANY", companyId: 7 };
const EMPLOYER = { id: 3, roleCode: "EMPLOYER", companyId: 7 };
const UNATTACHED_EMPLOYER = { id: 4, roleCode: "EMPLOYER" };

const renderAdmin = (route, user = ADMIN) => {
    mockRoute = route;
    return render(<HomeAdmin user={user} />);
};

describe("admin layout shell", () => {
    beforeEach(() => localStorage.clear());

    it("composes the shared header, menu, home content and footer", () => {
        renderAdmin("/");
        expect(screen.getByText("ADMIN HEADER")).toBeInTheDocument();
        expect(screen.getByText("ADMIN MENU")).toBeInTheDocument();
        expect(screen.getByText("ADMIN HOME")).toBeInTheDocument();
        expect(screen.getByText(/Bản quyền/)).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Tin nhắn tuyển dụng" })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Quy trình ứng viên" })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Báo cáo hệ thống" })).toHaveAttribute("href", "/admin/reports");
        expect(screen.queryByText("TO DO LIST")).not.toBeInTheDocument();
        expect(screen.queryByText("Feb 11 2018")).not.toBeInTheDocument();
        expect(document.querySelector('footer a[href="#"]')).toBeNull();
    });

    it("selects the requested nested administration route", () => {
        renderAdmin("/reports");
        expect(screen.getByText("ADMIN REPORT")).toBeInTheDocument();
        expect(screen.queryByText("ADMIN HOME")).not.toBeInTheDocument();
    });

    it.each([
        ["/chat", ADMIN, "/forbidden"],
        ["/chat", UNATTACHED_EMPLOYER, "/forbidden"],
        ["/list-post", UNATTACHED_EMPLOYER, "/forbidden"],
        ["/add-company", EMPLOYER, "/forbidden"],
    ])("returns 403 for disallowed nested route %s", (route, user, destination) => {
        renderAdmin(route, user);
        expect(screen.getByTestId("redirect")).toHaveTextContent(destination);
    });

    it("allows an attached employer to use recruiting and chat routes", () => {
        const { unmount } = renderAdmin("/chat", EMPLOYER);
        expect(screen.getByText("ADMIN CHAT")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Tin nhắn tuyển dụng" })).toHaveAttribute("href", "/admin/chat");
        expect(screen.getByRole("link", { name: "Quy trình ứng viên" })).toHaveAttribute("href", "/admin/pipeline");
        unmount();

        renderAdmin("/list-post", EMPLOYER);
        expect(screen.getByText("MANAGE POST")).toBeInTheDocument();
    });

    it("redirects an unattached employer away from dashboard without rendering it", () => {
        renderAdmin("/", UNATTACHED_EMPLOYER);

        expect(screen.getByTestId("redirect")).toHaveTextContent("/admin/add-company/");
        expect(screen.queryByText("ADMIN HOME")).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Tin nhắn tuyển dụng" })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Quy trình ứng viên" })).not.toBeInTheDocument();
    });

    it("allows an unattached employer only company creation and self-profile routes", () => {
        const { unmount } = renderAdmin("/add-company", UNATTACHED_EMPLOYER);
        expect(screen.getByText("ADD COMPANY")).toBeInTheDocument();
        unmount();

        renderAdmin("/user-info", UNATTACHED_EMPLOYER);
        expect(screen.getByText("USER INFO")).toBeInTheDocument();
    });

    it("allows an attached COMPANY to chat but denies company creation", () => {
        const { unmount } = renderAdmin("/chat", COMPANY);
        expect(screen.getByText("ADMIN CHAT")).toBeInTheDocument();
        unmount();

        renderAdmin("/add-company", COMPANY);
        expect(screen.getByTestId("redirect")).toHaveTextContent("/forbidden");
    });

    it.each([
        ["/payment/cancel", "orderData"],
        ["/paymentCv/cancel", "orderCvData"],
    ])("renders the PayPal cancellation route %s", (route, storageKey) => {
        localStorage.setItem(storageKey, JSON.stringify({ amount: 1 }));
        renderAdmin(route, COMPANY);

        expect(screen.getByText("Thanh toán đã được hủy")).toBeInTheDocument();
        expect(localStorage.getItem(storageKey)).toBeNull();
    });
});
