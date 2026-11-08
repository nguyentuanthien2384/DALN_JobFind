import React from 'react';
import { Navigate } from 'react-router-dom';
import { readJsonStorage } from '../../../util/storage';
import AdminRewardsOverview from './AdminRewardsOverview';
import EmployerRewardsSection from './EmployerRewardsSection';

const RewardsWorkspace = ({ user: suppliedUser = null }) => {
    const activeUser = suppliedUser || readJsonStorage('userData');
    const roleCode = activeUser?.roleCode;

    if (roleCode === 'ADMIN') {
        return <AdminRewardsOverview />;
    }

    if (roleCode === 'COMPANY' || roleCode === 'EMPLOYER') {
        return <EmployerRewardsSection user={activeUser} />;
    }

    return <Navigate to="/forbidden" replace />;
};

export default RewardsWorkspace;
