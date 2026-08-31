import React from "react";
import { render, screen } from "@testing-library/react";
import Forbidden from "./Forbidden";

jest.mock("react-router-dom", () => ({
    Link: ({ to, children, ...props }) => (
        <a href={to} {...props}>{children}</a>
    ),
}));

const renderPage = (user) => {
    if (user) {
        localStorage.setItem("userData", JSON.stringify(user));
    }
    return render(<Forbidden />);
};

describe("Forbidden", () => {
    beforeEach(() => localStorage.clear());

    it("explains the 403 response and sends a candidate back to their own area", () => {
        renderPage({ id: 7, roleCode: "CANDIDATE" });

        expect(screen.getByRole("alert")).toHaveTextContent("403");
        expect(screen.getByRole("heading", {
            name: "Bạn không có quyền truy cập",
        })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Về khu vực của tôi" }))
            .toHaveAttribute("href", "/candidate/info");
        expect(screen.getByRole("link", { name: "Về trang chủ" }))
            .toHaveAttribute("href", "/");
    });

    it("uses the public home page when there is no authenticated user", () => {
        renderPage(null);

        expect(screen.getByRole("link", { name: "Về khu vực của tôi" }))
            .toHaveAttribute("href", "/");
    });
});
