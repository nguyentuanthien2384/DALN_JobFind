import {
    getDefaultRouteForUser,
    getUserPermissions,
    hasAllPermissions,
    hasAnyPermission,
    hasCompanyMembership,
    hasPermission,
    isKnownRole,
    PERMISSIONS,
    ROLES,
} from "./accessControl";

const expectExactPermissions = (user, expected) => {
    expect([...getUserPermissions(user)].sort()).toEqual([...expected].sort());
};

describe("frontend access-control policy", () => {
    it("recognizes only the four backend role codes", () => {
        Object.values(ROLES).forEach((roleCode) => expect(isKnownRole(roleCode)).toBe(true));
        [undefined, null, "", "admin", "USER", "ROOT"].forEach((roleCode) =>
            expect(isKnownRole(roleCode)).toBe(false)
        );
    });

    it.each([
        [{ roleCode: ROLES.COMPANY, companyId: 7 }, true],
        [{ roleCode: ROLES.EMPLOYER, companyId: "7" }, true],
        [{ roleCode: ROLES.EMPLOYER }, false],
        [{ roleCode: ROLES.EMPLOYER, companyId: null }, false],
        [{ roleCode: ROLES.EMPLOYER, companyId: "" }, false],
        [null, false],
    ])("detects company membership from the authenticated identity %#", (user, expected) => {
        expect(hasCompanyMembership(user)).toBe(expected);
    });

    it("gives ADMIN platform administration and dashboard permissions but never chat", () => {
        const user = { id: 1, roleCode: ROLES.ADMIN };

        expectExactPermissions(user, [
            PERMISSIONS.MANAGE_PROFILE,
            PERMISSIONS.ACCESS_ADMIN_AREA,
            PERMISSIONS.VIEW_ADMIN_HOME,
            PERMISSIONS.VIEW_PLATFORM_REPORTS,
            PERMISSIONS.MANAGE_USERS,
            PERMISSIONS.MANAGE_REFERENCE_DATA,
            PERMISSIONS.MANAGE_PACKAGES,
            PERMISSIONS.MODERATE_COMPANIES,
            PERMISSIONS.MODERATE_POSTS,
        ]);
        expect(hasPermission(user, PERMISSIONS.USE_CHAT)).toBe(false);
        expect(hasPermission(user, PERMISSIONS.MANAGE_POSTS)).toBe(false);
    });

    it("gives a COMPANY with companyId its tenant, dashboard and chat permissions", () => {
        const user = { id: 2, roleCode: ROLES.COMPANY, companyId: 9 };

        expectExactPermissions(user, [
            PERMISSIONS.MANAGE_PROFILE,
            PERMISSIONS.ACCESS_ADMIN_AREA,
            PERMISSIONS.VIEW_ADMIN_HOME,
            PERMISSIONS.USE_CHAT,
            PERMISSIONS.MANAGE_COMPANY,
            PERMISSIONS.MANAGE_TEAM,
            PERMISSIONS.MANAGE_POSTS,
            PERMISSIONS.PURCHASE_PACKAGES,
            PERMISSIONS.MANAGE_CANDIDATES,
            PERMISSIONS.VIEW_TRANSACTIONS,
        ]);
        expect(hasPermission(user, PERMISSIONS.CREATE_COMPANY)).toBe(false);
        expect(hasPermission(user, PERMISSIONS.VIEW_PLATFORM_REPORTS)).toBe(false);
    });

    it("fails a COMPANY without companyId closed to profile-only administration", () => {
        const user = { id: 3, roleCode: ROLES.COMPANY };

        expectExactPermissions(user, [
            PERMISSIONS.MANAGE_PROFILE,
            PERMISSIONS.ACCESS_ADMIN_AREA,
        ]);
        expect(hasAnyPermission(user, [
            PERMISSIONS.VIEW_ADMIN_HOME,
            PERMISSIONS.USE_CHAT,
            PERMISSIONS.MANAGE_COMPANY,
            PERMISSIONS.MANAGE_POSTS,
        ])).toBe(false);
    });

    it("gives an EMPLOYER with companyId recruiting, dashboard and chat permissions", () => {
        const user = { id: 4, roleCode: ROLES.EMPLOYER, companyId: 12 };

        expectExactPermissions(user, [
            PERMISSIONS.MANAGE_PROFILE,
            PERMISSIONS.ACCESS_ADMIN_AREA,
            PERMISSIONS.VIEW_ADMIN_HOME,
            PERMISSIONS.USE_CHAT,
            PERMISSIONS.MANAGE_POSTS,
            PERMISSIONS.MANAGE_CANDIDATES,
        ]);
        expect(hasAnyPermission(user, [
            PERMISSIONS.MANAGE_COMPANY,
            PERMISSIONS.MANAGE_TEAM,
            PERMISSIONS.PURCHASE_PACKAGES,
            PERMISSIONS.VIEW_TRANSACTIONS,
        ])).toBe(false);
    });

    it("limits an EMPLOYER without companyId to company creation and self profile", () => {
        const user = { id: 5, roleCode: ROLES.EMPLOYER };

        expectExactPermissions(user, [
            PERMISSIONS.MANAGE_PROFILE,
            PERMISSIONS.ACCESS_ADMIN_AREA,
            PERMISSIONS.CREATE_COMPANY,
        ]);
        expect(hasAnyPermission(user, [
            PERMISSIONS.VIEW_ADMIN_HOME,
            PERMISSIONS.USE_CHAT,
            PERMISSIONS.MANAGE_POSTS,
            PERMISSIONS.MANAGE_CANDIDATES,
        ])).toBe(false);
    });

    it("allows CANDIDATE profile, candidate area and chat only", () => {
        const user = { id: 6, roleCode: ROLES.CANDIDATE };

        expectExactPermissions(user, [
            PERMISSIONS.MANAGE_PROFILE,
            PERMISSIONS.USE_CHAT,
            PERMISSIONS.VIEW_CANDIDATE_AREA,
        ]);
        expect(hasPermission(user, PERMISSIONS.ACCESS_ADMIN_AREA)).toBe(false);
        expect(hasPermission(user, PERMISSIONS.VIEW_ADMIN_HOME)).toBe(false);
    });

    it("fails closed for absent or unknown identities and returns independent sets", () => {
        expectExactPermissions(null, []);
        expectExactPermissions({ roleCode: "ROOT" }, []);
        expect(hasPermission({ roleCode: ROLES.ADMIN }, "unknown.permission")).toBe(false);
        expect(hasPermission({ roleCode: ROLES.ADMIN }, undefined)).toBe(false);

        const first = getUserPermissions({ roleCode: ROLES.ADMIN });
        first.add(PERMISSIONS.USE_CHAT);
        expect(getUserPermissions({ roleCode: ROLES.ADMIN }).has(PERMISSIONS.USE_CHAT)).toBe(false);
    });

    it("supports any/all permission checks without turning an empty any-list into access", () => {
        const employer = { roleCode: ROLES.EMPLOYER, companyId: 2 };

        expect(hasAnyPermission(employer, [
            PERMISSIONS.MANAGE_USERS,
            PERMISSIONS.MANAGE_POSTS,
        ])).toBe(true);
        expect(hasAllPermissions(employer, [
            PERMISSIONS.MANAGE_POSTS,
            PERMISSIONS.MANAGE_CANDIDATES,
        ])).toBe(true);
        expect(hasAllPermissions(employer, [
            PERMISSIONS.MANAGE_POSTS,
            PERMISSIONS.MANAGE_TEAM,
        ])).toBe(false);
        expect(hasAnyPermission(employer, [])).toBe(false);
        expect(hasAllPermissions(employer, [])).toBe(true);
    });

    it.each([
        [{ roleCode: ROLES.CANDIDATE }, "/candidate/info"],
        [{ roleCode: ROLES.ADMIN }, "/admin/"],
        [{ roleCode: ROLES.COMPANY, companyId: 3 }, "/admin/"],
        [{ roleCode: ROLES.EMPLOYER, companyId: 3 }, "/admin/"],
        [{ roleCode: ROLES.EMPLOYER }, "/admin/add-company/"],
        [{ roleCode: ROLES.COMPANY }, "/admin/user-info/"],
        [{ roleCode: "ROOT" }, "/"],
        [null, "/"],
    ])("chooses the safest landing route for identity %#", (user, expected) => {
        expect(getDefaultRouteForUser(user)).toBe(expected);
    });
});
