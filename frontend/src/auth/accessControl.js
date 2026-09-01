export const ROLES = Object.freeze({
    ADMIN: "ADMIN",
    COMPANY: "COMPANY",
    EMPLOYER: "EMPLOYER",
    CANDIDATE: "CANDIDATE",
});

export const PERMISSIONS = Object.freeze({
    ACCESS_ADMIN_AREA: "admin.area.access",
    VIEW_ADMIN_HOME: "admin.home.view",
    USE_CHAT: "chat.use",
    MANAGE_PROFILE: "profile.manage",
    VIEW_CANDIDATE_AREA: "candidate.area.view",
    APPLY_TO_JOB: "candidate.jobs.apply",
    SOCIAL_INTERACT: "candidate.social.interact",
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

// Tat ca tai khoan da dang nhap deu duoc quan ly ho so cua chinh minh. ADMIN la
// super-admin nen nhan moi quyen da duoc khai bao; cac vai tro con lai van bi
// gioi han theo nghiep vu va trang thai cong ty.
const COMMON_PERMISSIONS = [PERMISSIONS.MANAGE_PROFILE];

const permissionSet = (permissions) => new Set([...COMMON_PERMISSIONS, ...permissions]);

const ADMIN_PERMISSIONS = new Set(Object.values(PERMISSIONS));

const COMPANY_PERMISSIONS = permissionSet([
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

const COMPANY_PENDING_PERMISSIONS = permissionSet([
    PERMISSIONS.ACCESS_ADMIN_AREA,
    PERMISSIONS.MANAGE_COMPANY,
]);

const EMPLOYER_PERMISSIONS = permissionSet([
    PERMISSIONS.ACCESS_ADMIN_AREA,
    PERMISSIONS.VIEW_ADMIN_HOME,
    PERMISSIONS.USE_CHAT,
    PERMISSIONS.MANAGE_POSTS,
    PERMISSIONS.MANAGE_CANDIDATES,
]);

const EMPLOYER_WITHOUT_COMPANY_PERMISSIONS = permissionSet([
    PERMISSIONS.ACCESS_ADMIN_AREA,
    PERMISSIONS.CREATE_COMPANY,
]);

const CANDIDATE_PERMISSIONS = permissionSet([
    PERMISSIONS.USE_CHAT,
    PERMISSIONS.VIEW_CANDIDATE_AREA,
    PERMISSIONS.APPLY_TO_JOB,
    PERMISSIONS.SOCIAL_INTERACT,
]);

const COMPANY_WITHOUT_COMPANY_PERMISSIONS = permissionSet([
    PERMISSIONS.ACCESS_ADMIN_AREA,
]);

export const isKnownRole = (roleCode) => Object.values(ROLES).includes(roleCode);

export const hasCompanyMembership = (user) => Boolean(
    user
    && user.companyId !== null
    && user.companyId !== undefined
    && user.companyId !== ""
);

export const hasApprovedCompany = (user) => Boolean(
    hasCompanyMembership(user)
    && user.companyStatusCode === "S1"
    && user.companyCensorCode === "CS1"
);

export const getUserPermissions = (user) => {
    if (!user || !isKnownRole(user.roleCode)) return new Set();

    switch (user.roleCode) {
        case ROLES.ADMIN:
            return new Set(ADMIN_PERMISSIONS);
        case ROLES.COMPANY:
            // Tai khoan chu cong ty bat buoc phai gan voi mot cong ty cu the.
            // Neu du lieu phien bi cu/thieu companyId, chi cho vao khu quan tri
            // de sua ho so; khong mo du lieu tenant, dashboard hay chat.
            if (hasApprovedCompany(user)) return new Set(COMPANY_PERMISSIONS);
            return hasCompanyMembership(user)
                ? new Set(COMPANY_PENDING_PERMISSIONS)
                : new Set(COMPANY_WITHOUT_COMPANY_PERMISSIONS);
        case ROLES.EMPLOYER:
            return hasApprovedCompany(user)
                ? new Set(EMPLOYER_PERMISSIONS)
                : hasCompanyMembership(user)
                    ? new Set(COMPANY_WITHOUT_COMPANY_PERMISSIONS)
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
    // ADMIN has every capability but its primary workspace remains /admin.
    if (hasPermission(user, PERMISSIONS.VIEW_ADMIN_HOME)) return "/admin/";
    if (hasPermission(user, PERMISSIONS.VIEW_CANDIDATE_AREA)) return "/candidate/info";
    if (hasPermission(user, PERMISSIONS.CREATE_COMPANY)) return "/admin/add-company/";
    if (hasPermission(user, PERMISSIONS.MANAGE_COMPANY)) return "/admin/edit-company/";
    if (hasPermission(user, PERMISSIONS.ACCESS_ADMIN_AREA)) return "/admin/user-info/";
    return "/";
};
