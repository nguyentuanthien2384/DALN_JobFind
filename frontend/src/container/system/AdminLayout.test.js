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

const renderAdmin = (route) => {
    mockRoute = route;
    return render(<HomeAdmin />);
};

describe("admin layout shell", () => {
    it("composes the shared header, menu, home content and footer", () => {
        renderAdmin("/");
        expect(screen.getByText("ADMIN HEADER")).toBeInTheDocument();
        expect(screen.getByText("ADMIN MENU")).toBeInTheDocument();
        expect(screen.getByText("ADMIN HOME")).toBeInTheDocument();
        expect(screen.getByText(/Bản quyền/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Quy trình ứng viên" })).toHaveAttribute("href", "/admin/pipeline");
        expect(screen.queryByText("TO DO LIST")).not.toBeInTheDocument();
        expect(screen.queryByText("Feb 11 2018")).not.toBeInTheDocument();
    });

    it("selects the requested nested administration route", () => {
        renderAdmin("/reports");
        expect(screen.getByText("ADMIN REPORT")).toBeInTheDocument();
        expect(screen.queryByText("ADMIN HOME")).not.toBeInTheDocument();
    });
});
