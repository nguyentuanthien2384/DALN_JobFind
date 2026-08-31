import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import About from "./About/About";
import HomeCandidate from "./Candidate/HomeCandidate";
import Contact, { createSupportDraftUrl } from "./Contact/Contact";
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
        Navigate: ({ to }) => React.createElement("span", {
            "data-testid": "navigate",
            "data-to": to,
        }),
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
    const originalContactEmail = process.env.REACT_APP_CONTACT_EMAIL;

    beforeEach(() => {
        delete process.env.REACT_APP_CONTACT_EMAIL;
    });

    afterAll(() => {
        if (originalContactEmail === undefined) {
            delete process.env.REACT_APP_CONTACT_EMAIL;
        } else {
            process.env.REACT_APP_CONTACT_EMAIL = originalContactEmail;
        }
    });

    it("renders JobFind's real about content and working calls to action", () => {
        renderInRouter(<About />);

        expect(screen.getByRole("heading", { name: "Về JobFind" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Tạo tài khoản" })).toHaveAttribute(
            "href",
            "/register"
        );
        expect(screen.getByRole("heading", { name: "1. Tìm công việc" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "2. Hoàn thiện hồ sơ" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "3. Theo dõi ứng tuyển" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Hoàn thiện hồ sơ" })).toHaveAttribute(
            "href",
            "/candidate/info"
        );
        expect(screen.queryByText(/Mollit|Margaret Lawson|FEATURED TOURS/i)).not.toBeInTheDocument();
    });

    it("renders an honest support form and existing support channel", () => {
        render(<Contact />);

        expect(screen.getByRole("heading", { name: "Liên hệ JobFind" })).toBeInTheDocument();
        expect(screen.getByLabelText("Nội dung")).toHaveAttribute("name", "message");
        expect(screen.getByLabelText("Chủ đề")).toHaveAttribute("name", "subject");
        expect(screen.getByRole("button", { name: "Chuẩn bị yêu cầu" })).toHaveAttribute(
            "type",
            "submit"
        );
        expect(screen.getByRole("link", { name: "Kho mã JobFind" })).toHaveAttribute(
            "href",
            "https://github.com/nguyentuanthien2384/DALN_JobFind"
        );
        expect(screen.queryByText("support@colorlib.com")).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Email phản hồi")).not.toBeInTheDocument();
    });

    it("validates every required contact field before creating a draft", async () => {
        const user = userEvent.setup();
        render(<Contact />);

        await user.click(screen.getByRole("button", { name: "Chuẩn bị yêu cầu" }));

        expect(screen.getAllByRole("alert")).toHaveLength(2);
        expect(screen.queryByRole("link", { name: /Mở yêu cầu hỗ trợ/ })).not.toBeInTheDocument();
    });

    it("creates an encoded GitHub support draft when contact email is not configured", async () => {
        const user = userEvent.setup();
        render(<Contact />);

        await user.type(screen.getByLabelText("Chủ đề"), "Không đăng nhập được");
        await user.type(screen.getByLabelText("Nội dung"), "Tôi nhận được thông báo không hợp lệ.");
        await user.click(screen.getByRole("button", { name: "Chuẩn bị yêu cầu" }));

        const supportLink = screen.getByRole("link", {
            name: "Mở yêu cầu hỗ trợ trên GitHub",
        });
        expect(supportLink.href).toContain(
            "github.com/nguyentuanthien2384/DALN_JobFind/issues/new"
        );
        expect(decodeURIComponent(supportLink.href)).toContain(
            "[JobFind] Không đăng nhập được"
        );
        expect(decodeURIComponent(supportLink.href)).not.toContain("Email phản hồi:");
    });

    it("collects reply details when a deployment configures its support email", () => {
        process.env.REACT_APP_CONTACT_EMAIL = "help@example.com";
        render(<Contact />);

        expect(screen.getByLabelText("Họ tên")).toBeRequired();
        expect(screen.getByLabelText("Email phản hồi")).toBeRequired();
        expect(screen.getByRole("link", { name: "help@example.com" })).toHaveAttribute(
            "href",
            "mailto:help@example.com"
        );
    });

    it("builds a mail draft when a deployment configures its support email", () => {
        const draftUrl = createSupportDraftUrl(
            {
                name: "Nguyễn Văn A",
                email: "user@example.com",
                subject: "Cần hỗ trợ",
                message: "Nội dung yêu cầu",
            },
            "help@example.com"
        );

        expect(draftUrl).toMatch(/^mailto:help@example\.com\?/);
        expect(decodeURIComponent(draftUrl)).toContain("subject=[JobFind] Cần hỗ trợ");
    });

    it("renders the JobFind copyright and external social destination", () => {
        render(<Footer />);

        expect(screen.getByText(/Bản quyền.*JobFind/)).toBeInTheDocument();
        expect(document.querySelector('a[href="https://www.facebook.com/ahitvzed/"]')).toBeTruthy();
        expect(document.querySelector('a[href="#"]')).toBeNull();
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
