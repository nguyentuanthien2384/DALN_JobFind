import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { hasAllPermissions, hasAnyPermission, isKnownRole } from "./accessControl";

const RouteGuard = ({
    user,
    hasToken = true,
    allowedRoles,
    anyPermissions,
    allPermissions,
    children,
}) => {
    const location = useLocation();

    if (!user || !hasToken) {
        return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }

    const roleAllowed = !allowedRoles || allowedRoles.includes(user.roleCode);
    const anyPermissionAllowed = !anyPermissions || hasAnyPermission(user, anyPermissions);
    const allPermissionsAllowed = !allPermissions || hasAllPermissions(user, allPermissions);

    if (!isKnownRole(user.roleCode) || !roleAllowed || !anyPermissionAllowed || !allPermissionsAllowed) {
        return <Navigate to="/forbidden" replace state={{ from: location.pathname }} />;
    }

    return children;
};

export default RouteGuard;

