import React from "react";
import { render, screen } from "@testing-library/react";
import About from "./About/About";
import HomeCandidate from "./Candidate/HomeCandidate";
import Contact from "./Contact/Contact";
import Footer from "./footer/Footer";
import NotFound from "./NotFound/NotFound";

let mockCurrentPath = "/";
jest.mock("react-router-dom", () => {
    const React = require("react");
    const matches = (pattern, pathname) => {
        const expression = new RegExp(
            `^${pattern.replace(/:[^/]+/g, "[^/]+")}/?$`
        );
        return expression.test(pathname);
    };
    return {
        Link: ({ to, children, ...props }) =>
            React.createElement("a", { href: to, ...props }, children),
        Route: () => null,
        Routes: ({ children }) => {
            const route = React.Children.toArray(children).find((child) =>
                matches(child.props.path, mockCurrentPath)
            );
            return route ? route.props.element : null;
        },
    };
});

jest.mock("./Candidate/CandidateInfo", () => () => <div>candidate-info-page</div>);
jest.mock("./Candidate/ManageCvCandidate", () => () => <div>candidate-cv-post-page</div>);
jest.mock("./Candidate/SettingUser", () => () => <div>candidate-settings-page</div>);
jest.mock("./Candidate/SavedJobs", () => () => <div>candidate-saved-jobs-page</div>);
jest.mock("./system/User/ChangePassword", () => () => <div>candidate-password-page</div>);
jest.mock("./system/Cv/UserCv", () => () => <div>candidate-cv-detail-page</div>);

const renderInRouter = (ui, initialEntry = "/") => {
    mockCurrentPath = initialEntry;
    return render(ui);
};

describe("public static pages", () => {
    it("renders the about content and login call to action", () => {
        // This legacy template still uses HTML `class` attributes. Suppress React's known
        // development-only diagnostic while verifying the rendered public content.
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        renderInRouter(<About />);

        expect(screen.getByRole("heading", { name: "Thông tin về tôi" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Tham gia ngay" })).toHaveAttribute(
            "href",
            "/login"
        );
        expect(screen.getByRole("heading", { name: "1. Search a job" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "2. Apply for job" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "3. Get your job" })).toBeInTheDocument();
        consoleError.mockRestore();
    });

    it("renders every contact field and published contact details", () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        render(<Contact />);

        expect(screen.getByRole("heading", { name: "Contact us" })).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Enter Message")).toHaveAttribute("name", "message");
        expect(screen.getByPlaceholderText("Enter your name")).toHaveAttribute("name", "name");
        expect(screen.getByPlaceholderText("Email")).toHaveAttribute("type", "email");
        expect(screen.getByPlaceholderText("Enter Subject")).toHaveAttribute("name", "subject");
        expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute("type", "submit");
        expect(screen.getByText("support@colorlib.com")).toBeInTheDocument();
        consoleError.mockRestore();
    });

    it("renders the footer attribution and external social destination", () => {
        render(<Footer />);

        expect(screen.getByText(/Thiền NT/)).toBeInTheDocument();
        expect(document.querySelector('a[href="https://www.facebook.com/ahitvzed/"]')).toBeTruthy();
    });

    it("offers a working home link from the not-found page", () => {
        renderInRouter(<NotFound />);

        expect(screen.getByRole("heading", { name: "404" })).toBeInTheDocument();
        expect(screen.getByText("Không tìm thấy trang bạn yêu cầu")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Về trang chủ" })).toHaveAttribute("href", "/");
    });
});

describe("HomeCandidate route shell", () => {
    it.each([
        ["/info", "candidate-info-page"],
        ["/usersetting", "candidate-settings-page"],
        ["/changepassword", "candidate-password-page"],
        ["/cv-post", "candidate-cv-post-page"],
        ["/saved-jobs", "candidate-saved-jobs-page"],
        ["/cv-detail/55", "candidate-cv-detail-page"],
    ])("maps %s to its candidate page", (path, expectedPage) => {
        renderInRouter(<HomeCandidate />, path);
        expect(screen.getByText(expectedPage)).toBeInTheDocument();
    });
});
