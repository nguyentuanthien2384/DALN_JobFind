import React from "react";
import { act, render, screen } from "@testing-library/react";
import { SESSION_ENDED_EVENT } from './auth/sessionExpiry';
import App from "./App";

const mockGetCurrentAuthorizationService = jest.fn();
jest.mock("./service/userService", () => ({
    getCurrentAuthorizationService: (...args) => mockGetCurrentAuthorizationService(...args),
}));

jest.mock("react-router-dom", () => {
    const React = require("react");
    const matches = (pattern, pathname) => {
        if (pattern === "*") return true;
        if (pattern.endsWith("/*")) return pathname.startsWith(pattern.slice(0, -1));
        const expression = `^${pattern.replace(/:[^/]+/g, "[^/]+")}$`;
        return new RegExp(expression).test(pathname);
    };
    return {
        BrowserRouter: ({ children }) => children,
        Route: () => null,
        Routes: ({ children }) => {
            const pathname = global.window.location.pathname;
            const route = React.Children.toArray(children).find((child) => matches(child.props.path, pathname));
            return route ? route.props.element : null;
        },
        Navigate: ({ to }) => <div>navigate-{to}</div>,
        useLocation: () => ({ pathname: global.window.location.pathname }),
    };
});

jest.mock("./container/header/header", () => () => <div>site-header</div>);
jest.mock("./container/footer/Footer", () => () => <div>site-footer</div>);
jest.mock("./container/home/home", () => () => <div>home-page</div>);
jest.mock("./container/JobPage/JobPage", () => () => <div>job-page</div>);
jest.mock("./container/JobDetail/JobDetail", () => () => <div>job-detail-page</div>);
jest.mock("./container/About/About", () => () => <div>about-page</div>);
jest.mock("./container/Contact/Contact", () => () => <div>contact-page</div>);
jest.mock("./container/system/HomeAdmin", () => () => <div>admin-page</div>);
jest.mock("./container/login/Login", () => () => <div>login-page</div>);
jest.mock("./container/login/Register", () => () => <div>register-page</div>);
jest.mock("./container/login/ForgetPassword", () => () => <div>forget-password-page</div>);
jest.mock("./container/Candidate/HomeCandidate", () => () => <div>candidate-page</div>);
jest.mock("./container/Company/ListCompany", () => () => <div>company-page</div>);
jest.mock("./container/Company/DetailCompany", () => () => <div>company-detail-page</div>);
jest.mock("./container/Chat/ChatPage", () => () => <div>chat-page</div>);
jest.mock("./container/NotFound/NotFound", () => () => <div>not-found-page</div>);
jest.mock("./container/Forbidden/Forbidden", () => () => <div>forbidden-page</div>);

const renderAt = (path, user) => {
    localStorage.clear();
    if (user) {
        const identity = user.companyId && !user.companyStatusCode
            ? { ...user, companyStatusCode: "S1", companyCensorCode: "CS1" }
            : user;
        localStorage.setItem("userData", JSON.stringify(identity));
        localStorage.setItem("token_user", "valid-token");
    }
    window.history.replaceState({}, "", path);
    return render(<App />);
};

describe("application routes", () => {
    it('removes protected UI immediately and ignores a late auth/me success after expiry', async () => {
        let resolve;
        mockGetCurrentAuthorizationService.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
        renderAt('/chat', { id: 1, roleCode: 'CANDIDATE' });
        expect(screen.getByText('chat-page')).toBeInTheDocument();
        act(() => {
            localStorage.removeItem('token_user');
            localStorage.removeItem('userData');
            window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
        });
        expect(screen.getByText('navigate-/login')).toBeInTheDocument();
        await act(async () => resolve({ errCode: 0, data: { userId: 1, roleCode: 'CANDIDATE' } }));
        expect(localStorage.getItem('userData')).toBeNull();
        expect(screen.queryByText('chat-page')).not.toBeInTheDocument();
    });
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetCurrentAuthorizationService.mockResolvedValue({ errCode: -1 });
    });
    afterEach(() => localStorage.clear());

    it.each([
        ["/", "home-page"],
        ["/about", "about-page"],
        ["/contact", "contact-page"],
        ["/job", "job-page"],
        ["/company", "company-page"],
        ["/detail-company/12", "company-detail-page"],
        ["/detail-job/34", "job-detail-page"],
        ["/login", "login-page"],
        ["/register", "register-page"],
        ["/forget-password", "forget-password-page"],
    ])("renders the public route %s", (path, pageText) => {
        renderAt(path);
        expect(screen.getByText(pageText)).toBeInTheDocument();
        expect(screen.getByText("site-header")).toBeInTheDocument();
        expect(screen.getByText("site-footer")).toBeInTheDocument();
    });

    it.each([
        ["ADMIN", undefined],
        ["EMPLOYER", undefined],
        ["COMPANY", undefined],
        ["COMPANY", 8],
    ])(
        "allows %s users into the admin area",
        async (roleCode, companyId) => {
            renderAt("/admin/users", { id: 1, roleCode, companyId });
            expect(await screen.findByText("admin-page")).toBeInTheDocument();
        }
    );

    it.each([
        ["ADMIN", undefined],
        ["CANDIDATE", undefined],
        ["COMPANY", 3],
        ["EMPLOYER", 3],
    ])(
        "allows an authenticated %s with the required company context to use chat",
        (roleCode, companyId) => {
            renderAt("/chat/9", { id: 1, roleCode, companyId });
            expect(screen.getByText("chat-page")).toBeInTheDocument();
        }
    );

    it.each([
        ["COMPANY", undefined],
        ["EMPLOYER", undefined],
    ])(
        "returns 403 for chat when %s lacks backend chat permission",
        (roleCode, companyId) => {
            renderAt("/chat/9", { id: 1, roleCode, companyId });
            expect(screen.getByText("navigate-/forbidden")).toBeInTheDocument();
            expect(screen.queryByText("chat-page")).not.toBeInTheDocument();
        }
    );

    it("requires authentication for chat", () => {
        renderAt("/chat");
        expect(screen.getByText("navigate-/login")).toBeInTheDocument();
    });

    it("returns 403 for recruiter chat while the company is pending approval", () => {
        renderAt("/chat", {
            id: 1,
            roleCode: "COMPANY",
            companyId: 3,
            companyStatusCode: "S1",
            companyCensorCode: "CS3",
        });
        expect(screen.getByText("navigate-/forbidden")).toBeInTheDocument();
    });

    it("redirects a guest away from the admin area", () => {
        renderAt("/admin/users");
        expect(screen.getByText("navigate-/login")).toBeInTheDocument();
    });

    it("sends an authenticated candidate to the forbidden page instead of login", () => {
        renderAt("/admin/users", { id: 1, roleCode: "CANDIDATE" });
        expect(screen.getByText("navigate-/forbidden")).toBeInTheDocument();
        expect(screen.queryByText("admin-page")).not.toBeInTheDocument();
    });

    it("does not trust persisted user data when its authentication token is missing", () => {
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        window.history.replaceState({}, "", "/admin/users");
        render(<App />);
        expect(screen.getByText("navigate-/login")).toBeInTheDocument();
    });

    it("refreshes a legacy company session before granting operational permissions", async () => {
        mockGetCurrentAuthorizationService.mockResolvedValueOnce({
            errCode: 0,
            data: {
                userId: 8,
                roleCode: "COMPANY",
                companyId: 4,
                companyStatusCode: "S1",
                companyCensorCode: "CS1",
            },
        });
        localStorage.setItem("userData", JSON.stringify({
            id: 8,
            roleCode: "COMPANY",
            companyId: 4,
            firstName: "Legacy",
        }));
        localStorage.setItem("token_user", "valid-token");
        window.history.replaceState({}, "", "/chat");

        render(<App />);
        expect(screen.getByRole("status")).toHaveTextContent("Đang xác minh quyền truy cập");
        expect(await screen.findByText("chat-page")).toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem("userData"))).toEqual(expect.objectContaining({
            id: 8,
            firstName: "Legacy",
            companyStatusCode: "S1",
            companyCensorCode: "CS1",
        }));
    });

    it("keeps a legacy company session restricted when authorization cannot be refreshed", async () => {
        localStorage.setItem("userData", JSON.stringify({
            id: 8,
            roleCode: "COMPANY",
            companyId: 4,
        }));
        localStorage.setItem("token_user", "valid-token");
        window.history.replaceState({}, "", "/chat");

        render(<App />);
        expect(await screen.findByText("navigate-/forbidden")).toBeInTheDocument();
        expect(screen.queryByText("chat-page")).not.toBeInTheDocument();
    });

    it("allows candidates into their protected area with the shared layout", async () => {
        renderAt("/candidate/info", { id: 2, roleCode: "CANDIDATE" });
        expect(await screen.findByText("candidate-page")).toBeInTheDocument();
        expect(screen.getByText("site-header")).toBeInTheDocument();
        expect(screen.getByText("site-footer")).toBeInTheDocument();
    });

    it("allows ADMIN into the candidate area as a super-admin", async () => {
        renderAt("/candidate/info", { id: 1, roleCode: "ADMIN" });
        expect(await screen.findByText("candidate-page")).toBeInTheDocument();
        expect(screen.getByText("site-header")).toBeInTheDocument();
        expect(screen.getByText("site-footer")).toBeInTheDocument();
    });

    it("redirects a guest away from the candidate area", () => {
        renderAt("/candidate/info");
        expect(screen.getByText("navigate-/login")).toBeInTheDocument();
    });

    it.each(["EMPLOYER", "COMPANY"])(
        "sends an authenticated recruiter role %s away from the candidate area",
        (roleCode) => {
            renderAt("/candidate/info", { id: 1, roleCode, companyId: 4 });
            expect(screen.getByText("navigate-/forbidden")).toBeInTheDocument();
            expect(screen.queryByText("candidate-page")).not.toBeInTheDocument();
        }
    );

    it("renders a dedicated forbidden route with the shared public layout", () => {
        renderAt("/forbidden", { id: 1, roleCode: "CANDIDATE" });
        expect(screen.getByText("forbidden-page")).toBeInTheDocument();
        expect(screen.getByText("site-header")).toBeInTheDocument();
        expect(screen.getByText("site-footer")).toBeInTheDocument();
    });

    it("uses the not-found page for an unknown route", () => {
        renderAt("/does-not-exist");
        expect(screen.getByText("not-found-page")).toBeInTheDocument();
    });

    it("recovers from malformed persisted login data instead of crashing public routes", () => {
        localStorage.clear();
        localStorage.setItem("userData", "{broken-json");
        window.history.replaceState({}, "", "/");

        expect(() => render(<App />)).not.toThrow();
        expect(screen.getByText("home-page")).toBeInTheDocument();
        expect(localStorage.getItem("userData")).toBeNull();
    });
});
