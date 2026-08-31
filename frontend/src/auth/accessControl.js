export const ROLES = Object.freeze({
    ADMIN: "ADMIN",
    COMPANY: "COMPANY",
    EMPLOYER: "EMPLOYER",
    CANDIDATE: "CANDIDATE",
});

export const PERMISSIONS = Object.freeze({
    VIEW_ADMIN_HOME: "admin.home.view",
    USE_CHAT: "chat.use",
    MANAGE_PROFILE: "profile.manage",
    VIEW_CANDIDATE_AREA: "candidate.area.view",
    VIEW_PLATFORM_REPORTS: "platform.reports.view",
    MANAGE_USERS: "users.manage",
    MANAGE_REFERENCE_DATA: "reference-data.manage",
    MANAGE_PACKAGES: "packages.manage",
    MODERATE_COMPANIES: "companies.moderate",
    MODERATE_POSTS: "posts.moderate",
    CREATE_COMPANY: "company.create",
    MANAGE_COMPANY: "company.manage",
    MANAGE_TEAM: "company.team.manage",
    MANAGE_POSTS: "company.posts.manage",
    PURCHASE_PACKAGES: "company.packages.purchase",
    MANAGE_CANDIDATES: "company.candidates.manage",
    VIEW_TRANSACTIONS: "company.transactions.view",
});

const COMMON_PERMISSIONS = [PERMISSIONS.USE_CHAT, PERMISSIONS.MANAGE_PROFILE];

const permissionSet = (permissions) => new Set([...COMMON_PERMISSIONS, ...permissions]);

const ADMIN_PERMISSIONS = permissionSet([
    PERMISSIONS.VIEW_ADMIN_HOME,
    PERMISSIONS.VIEW_PLATFORM_REPORTS,
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.MANAGE_REFERENCE_DATA,
    PERMISSIONS.MANAGE_PACKAGES,
    PERMISSIONS.MODERATE_COMPANIES,
    PERMISSIONS.MODERATE_POSTS,
]);

const COMPANY_PERMISSIONS = permissionSet([
    PERMISSIONS.VIEW_ADMIN_HOME,
    PERMISSIONS.MANAGE_COMPANY,
    PERMISSIONS.MANAGE_TEAM,
    PERMISSIONS.MANAGE_POSTS,
    PERMISSIONS.PURCHASE_PACKAGES,
    PERMISSIONS.MANAGE_CANDIDATES,
    PERMISSIONS.VIEW_TRANSACTIONS,
]);

const EMPLOYER_PERMISSIONS = permissionSet([
    PERMISSIONS.VIEW_ADMIN_HOME,
    PERMISSIONS.MANAGE_POSTS,
    PERMISSIONS.MANAGE_CANDIDATES,
]);

const EMPLOYER_WITHOUT_COMPANY_PERMISSIONS = permissionSet([
    PERMISSIONS.VIEW_ADMIN_HOME,
    PERMISSIONS.CREATE_COMPANY,
]);

const CANDIDATE_PERMISSIONS = permissionSet([
    PERMISSIONS.VIEW_CANDIDATE_AREA,
]);

export const isKnownRole = (roleCode) => Object.values(ROLES).includes(roleCode);

export const getUserPermissions = (user) => {
    if (!user || !isKnownRole(user.roleCode)) return new Set();

    switch (user.roleCode) {
        case ROLES.ADMIN:
            return new Set(ADMIN_PERMISSIONS);
        case ROLES.COMPANY:
            // Tai khoan chu cong ty bat buoc phai gan voi mot cong ty cu the.
            // Neu du lieu phien bi cu/thieu companyId, chi cho dung quyen chung.
            return user.companyId ? new Set(COMPANY_PERMISSIONS) : permissionSet([]);
        case ROLES.EMPLOYER:
            return user.companyId
                ? new Set(EMPLOYER_PERMISSIONS)
                : new Set(EMPLOYER_WITHOUT_COMPANY_PERMISSIONS);
        case ROLES.CANDIDATE:
            return new Set(CANDIDATE_PERMISSIONS);
        default:
            return new Set();
    }
};

export const hasPermission = (user, permission) =>
    Boolean(permission) && getUserPermissions(user).has(permission);

export const hasAnyPermission = (user, permissions = []) =>
    permissions.some((permission) => hasPermission(user, permission));

export const hasAllPermissions = (user, permissions = []) =>
    permissions.every((permission) => hasPermission(user, permission));

export const getDefaultRouteForUser = (user) => {
    if (hasPermission(user, PERMISSIONS.VIEW_CANDIDATE_AREA)) return "/candidate/info";
    if (hasPermission(user, PERMISSIONS.VIEW_ADMIN_HOME)) return "/admin/";
    return "/";
};

