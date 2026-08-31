import React from "react";
import { render, screen } from "@testing-library/react";
import RouteGuard from "./RouteGuard";
import { PERMISSIONS, ROLES } from "./accessControl";

let mockPathname = "/secure";

jest.mock("react-router-dom", () => ({
    Navigate: ({ to, state }) => (
        <div data-testid="redirect" data-from={state?.from}>
            {to}
        </div>
    ),
    useLocation: () => ({ pathname: mockPathname }),
}));

const renderGuard = (props = {}, pathname = "/secure") => {
    mockPathname = pathname;
    return render(
        <RouteGuard {...props}>
            <div>protected-content</div>
        </RouteGuard>
    );
};

describe("RouteGuard", () => {
    const approved = (roleCode, companyId) => ({
        roleCode, companyId, companyStatusCode: "S1", companyCensorCode: "CS1",
    });
    it.each([
        [{ hasToken: true }, "missing user"],
        [{ user: { roleCode: ROLES.ADMIN }, hasToken: false }, "missing token"],
    ])("redirects authentication failure to login and preserves the origin (%s)", (props) => {
        renderGuard(props);

        expect(screen.getByTestId("redirect")).toHaveTextContent("/login");
        expect(screen.getByTestId("redirect")).toHaveAttribute("data-from", "/secure");
        expect(screen.queryByText("protected-content")).not.toBeInTheDocument();
    });

    it("lets a known authenticated role through when no authorization constraint is supplied", () => {
        renderGuard({ user: { roleCode: ROLES.ADMIN } });
        expect(screen.getByText("protected-content")).toBeInTheDocument();
    });

    it("rejects an unknown persisted role as forbidden rather than treating it as logged out", () => {
        renderGuard({ user: { roleCode: "ROOT" }, hasToken: true });

        expect(screen.getByTestId("redirect")).toHaveTextContent("/forbidden");
        expect(screen.getByTestId("redirect")).toHaveAttribute("data-from", "/secure");
        expect(screen.queryByText("protected-content")).not.toBeInTheDocument();
    });

    it("enforces allowedRoles independently of permissions", () => {
        renderGuard({
            user: { roleCode: ROLES.CANDIDATE },
            allowedRoles: [ROLES.ADMIN, ROLES.COMPANY],
        });
        expect(screen.getByTestId("redirect")).toHaveTextContent("/forbidden");
    });

    it("allows a route when at least one anyPermissions entry is granted", () => {
        renderGuard({
            user: approved(ROLES.EMPLOYER, 8),
            anyPermissions: [PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_POSTS],
        });
        expect(screen.getByText("protected-content")).toBeInTheDocument();
    });

    it.each([
        [{ roleCode: ROLES.ADMIN }, "ADMIN cannot chat"],
        [{ roleCode: ROLES.COMPANY }, "COMPANY without companyId cannot chat"],
        [{ roleCode: ROLES.EMPLOYER }, "EMPLOYER without companyId cannot chat"],
    ])("returns forbidden when anyPermissions is not granted: %s", (user) => {
        renderGuard({ user, anyPermissions: [PERMISSIONS.USE_CHAT] });
        expect(screen.getByTestId("redirect")).toHaveTextContent("/forbidden");
    });

    it("requires every allPermissions entry", () => {
        const user = approved(ROLES.EMPLOYER, 8);
        renderGuard({
            user,
            allPermissions: [PERMISSIONS.MANAGE_POSTS, PERMISSIONS.MANAGE_TEAM],
        });
        expect(screen.getByTestId("redirect")).toHaveTextContent("/forbidden");
    });

    it("combines role, any and all constraints when all are satisfied", () => {
        const user = approved(ROLES.COMPANY, 8);
        renderGuard({
            user,
            allowedRoles: [ROLES.COMPANY],
            anyPermissions: [PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_COMPANY],
            allPermissions: [PERMISSIONS.MANAGE_PROFILE, PERMISSIONS.USE_CHAT],
        });
        expect(screen.getByText("protected-content")).toBeInTheDocument();
    });
});
