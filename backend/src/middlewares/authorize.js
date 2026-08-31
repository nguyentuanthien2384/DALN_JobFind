// Central RBAC policy for the monolith API. Authentication is deliberately
// separate: jwtVerify reloads the current account from the database, then this
// module decides whether that current role may perform a named action.

const ROLES = Object.freeze({
    ADMIN: 'ADMIN',
    COMPANY: 'COMPANY',
    EMPLOYER: 'EMPLOYER',
    CANDIDATE: 'CANDIDATE'
});

const PERMISSIONS = Object.freeze({
    ACCOUNT_SELF: 'account:self',
    ADMINISTRATION: 'administration:manage',
    COMPANY_CREATE: 'company:create',
    COMPANY_PRIVATE_READ: 'company:private:read',
    COMPANY_MANAGE: 'company:manage',
    COMPANY_TEAM_MANAGE: 'company:team:manage',
    COMPANY_TEAM_EXIT: 'company:team:exit',
    JOB_MANAGE: 'job:manage',
    RECRUITMENT_READ: 'recruitment:read',
    RECRUITMENT_REPORT_READ: 'recruitment:report:read',
    CANDIDATE_APPLY: 'candidate:apply',
    CANDIDATE_PROFILE_READ: 'candidate:profile:read',
    CANDIDATE_SEARCH: 'candidate:search',
    RECOMMENDATION_READ: 'recommendation:read',
    PACKAGE_CATALOG_READ: 'package:catalog:read',
    PACKAGE_PURCHASE: 'package:purchase',
    PACKAGE_HISTORY_READ: 'package:history:read',
    SOCIAL_INTERACT: 'social:interact',
    NOTIFICATION_READ: 'notification:read',
    CHAT: 'chat:use'
});

const allRoles = Object.freeze(Object.values(ROLES));

// requiresCompanyForRoles is evaluated in addition to the role. It prevents an
// EMPLOYER account which has not joined a company from reaching tenant data.
const permissionMatrix = Object.freeze({
    [PERMISSIONS.ACCOUNT_SELF]: { roles: allRoles },
    [PERMISSIONS.ADMINISTRATION]: { roles: [ROLES.ADMIN] },
    [PERMISSIONS.COMPANY_CREATE]: {
        // The registration flow creates an EMPLOYER first; an unattached
        // employer may then establish a company and becomes its COMPANY owner.
        roles: [ROLES.EMPLOYER],
        requiresNoCompany: true
    },
    [PERMISSIONS.COMPANY_PRIVATE_READ]: {
        roles: [ROLES.ADMIN, ROLES.COMPANY],
        requiresCompanyForRoles: [ROLES.COMPANY]
    },
    [PERMISSIONS.COMPANY_MANAGE]: {
        roles: [ROLES.COMPANY],
        requiresCompanyForRoles: [ROLES.COMPANY]
    },
    [PERMISSIONS.COMPANY_TEAM_MANAGE]: {
        roles: [ROLES.COMPANY],
        requiresCompanyForRoles: [ROLES.COMPANY]
    },
    [PERMISSIONS.COMPANY_TEAM_EXIT]: {
        roles: [ROLES.COMPANY, ROLES.EMPLOYER],
        requiresCompanyForRoles: [ROLES.COMPANY, ROLES.EMPLOYER]
    },
    [PERMISSIONS.JOB_MANAGE]: {
        roles: [ROLES.COMPANY, ROLES.EMPLOYER],
        requiresCompanyForRoles: [ROLES.COMPANY, ROLES.EMPLOYER]
    },
    [PERMISSIONS.RECRUITMENT_READ]: {
        roles: [ROLES.ADMIN, ROLES.COMPANY, ROLES.EMPLOYER],
        requiresCompanyForRoles: [ROLES.COMPANY, ROLES.EMPLOYER]
    },
    [PERMISSIONS.RECRUITMENT_REPORT_READ]: {
        roles: [ROLES.ADMIN, ROLES.COMPANY, ROLES.EMPLOYER],
        requiresCompanyForRoles: [ROLES.COMPANY, ROLES.EMPLOYER]
    },
    [PERMISSIONS.CANDIDATE_APPLY]: { roles: [ROLES.CANDIDATE] },
    // Resource-level checks still restrict this mixed route to self, an admin,
    // a same-company job application, or a purchased CandidateView entitlement.
    [PERMISSIONS.CANDIDATE_PROFILE_READ]: { roles: allRoles },
    [PERMISSIONS.CANDIDATE_SEARCH]: {
        roles: [ROLES.ADMIN, ROLES.COMPANY, ROLES.EMPLOYER],
        requiresCompanyForRoles: [ROLES.COMPANY, ROLES.EMPLOYER]
    },
    [PERMISSIONS.RECOMMENDATION_READ]: { roles: [ROLES.CANDIDATE] },
    [PERMISSIONS.PACKAGE_CATALOG_READ]: { roles: [ROLES.ADMIN, ROLES.COMPANY] },
    [PERMISSIONS.PACKAGE_PURCHASE]: {
        roles: [ROLES.COMPANY],
        requiresCompanyForRoles: [ROLES.COMPANY]
    },
    [PERMISSIONS.PACKAGE_HISTORY_READ]: {
        roles: [ROLES.ADMIN, ROLES.COMPANY],
        requiresCompanyForRoles: [ROLES.COMPANY]
    },
    [PERMISSIONS.SOCIAL_INTERACT]: { roles: [ROLES.CANDIDATE] },
    [PERMISSIONS.NOTIFICATION_READ]: { roles: allRoles },
    [PERMISSIONS.CHAT]: {
        roles: [ROLES.CANDIDATE, ROLES.COMPANY, ROLES.EMPLOYER],
        requiresCompanyForRoles: [ROLES.COMPANY, ROLES.EMPLOYER]
    }
});

const getRoleCode = (req) => req.user?.userAccountData?.roleCode || null;

const hasCompany = (req) => (
    req.user?.companyId !== null
    && req.user?.companyId !== undefined
    && req.user?.companyId !== ''
);

const isPermissionGranted = (req, permission) => {
    const rule = permissionMatrix[permission];
    if (!rule || !req.user) return false;

    const roleCode = getRoleCode(req);
    if (!rule.roles.includes(roleCode)) return false;
    if (rule.requiresNoCompany && hasCompany(req)) return false;
    if (rule.requiresCompanyForRoles?.includes(roleCode) && !hasCompany(req)) return false;
    return true;
};

const getGrantedPermissions = (req) => Object.keys(permissionMatrix)
    .filter((permission) => isPermissionGranted(req, permission));

const authorize = (permission) => {
    if (!permissionMatrix[permission]) {
        // A misspelled/forgotten policy must fail closed during development and
        // production instead of silently making a route public.
        return (req, res) => res.status(500).json({
            errCode: -1,
            errMessage: 'Authorization policy is not configured'
        });
    }

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                errCode: 401,
                errMessage: 'Authentication required',
                refresh: true
            });
        }
        if (!isPermissionGranted(req, permission)) {
            return res.status(403).json({
                errCode: 3,
                errMessage: 'Bạn không có quyền thực hiện thao tác này'
            });
        }

        req.authorization = {
            permission,
            roleCode: getRoleCode(req),
            companyId: hasCompany(req) ? Number(req.user.companyId) : null
        };
        return next();
    };
};

module.exports = {
    ROLES,
    PERMISSIONS,
    permissionMatrix,
    getRoleCode,
    isPermissionGranted,
    getGrantedPermissions,
    authorize
};
