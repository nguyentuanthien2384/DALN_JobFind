import React from "react";
import { render, screen } from "@testing-library/react";
import App from "./App";

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

const renderAt = (path, user) => {
    localStorage.clear();
    if (user) localStorage.setItem("userData", JSON.stringify(user));
    window.history.replaceState({}, "", path);
    return render(<App />);
};

describe("application routes", () => {
    afterEach(() => localStorage.clear());

    it.each([
        ["/", "home-page"],
        ["/about", "about-page"],
        ["/contact", "contact-page"],
        ["/job", "job-page"],
        ["/company", "company-page"],
        ["/detail-company/12", "company-detail-page"],
        ["/detail-job/34", "job-detail-page"],
        ["/chat", "chat-page"],
        ["/chat/9", "chat-page"],
        ["/login", "login-page"],
        ["/register", "register-page"],
        ["/forget-password", "forget-password-page"],
    ])("renders the public route %s", (path, pageText) => {
        renderAt(path);
        expect(screen.getByText(pageText)).toBeInTheDocument();
        expect(screen.getByText("site-header")).toBeInTheDocument();
        expect(screen.getByText("site-footer")).toBeInTheDocument();
    });

    it.each(["ADMIN", "EMPLOYER", "COMPANY"])(
        "allows %s users into the admin area",
        (roleCode) => {
            renderAt("/admin/users", { id: 1, roleCode });
            expect(screen.getByText("admin-page")).toBeInTheDocument();
        }
    );

    it.each([null, "CANDIDATE"])(
        "redirects an unauthorized %s user away from the admin area",
        (roleCode) => {
            renderAt("/admin/users", roleCode ? { id: 1, roleCode } : null);
            expect(screen.getByText("navigate-/login")).toBeInTheDocument();
            expect(screen.queryByText("admin-page")).not.toBeInTheDocument();
        }
    );

    it("allows candidates into their protected area with the shared layout", () => {
        renderAt("/candidate/info", { id: 2, roleCode: "CANDIDATE" });
        expect(screen.getByText("candidate-page")).toBeInTheDocument();
        expect(screen.getByText("site-header")).toBeInTheDocument();
        expect(screen.getByText("site-footer")).toBeInTheDocument();
    });

    it.each([null, "ADMIN", "EMPLOYER", "COMPANY"])(
        "redirects a non-candidate %s user away from the candidate area",
        (roleCode) => {
            renderAt("/candidate/info", roleCode ? { id: 1, roleCode } : null);
            expect(screen.getByText("navigate-/login")).toBeInTheDocument();
            expect(screen.queryByText("candidate-page")).not.toBeInTheDocument();
        }
    );

    it("uses the not-found page for an unknown route", () => {
        renderAt("/does-not-exist");
        expect(screen.getByText("not-found-page")).toBeInTheDocument();
    });
});
