import rewardService from '../services/rewardService';
import paymentOrderService from '../services/paymentOrderService';
import { ROLES, getRoleCode, hasApprovedCompany } from '../middlewares/authorize';

const getClientIp = (req) => (
    req.headers?.['x-forwarded-for']
    || req.socket?.remoteAddress
    || req.ip
    || '127.0.0.1'
);

const requireCandidateAccess = (req, res) => {
    const roleCode = getRoleCode(req);
    if (roleCode !== ROLES.CANDIDATE) {
        res.status(403).json({
            errCode: 3,
            errMessage: 'Tính năng nạp điểm & tích điểm ứng viên chỉ dành cho tài khoản Ứng viên'
        });
        return false;
    }
    return true;
};

const requireApprovedCompanyOwner = (req, res) => {
    const roleCode = getRoleCode(req);
    if (roleCode !== ROLES.COMPANY || !hasApprovedCompany(req)) {
        res.status(403).json({
            errCode: 3,
            errMessage: 'Chỉ Chủ doanh nghiệp đã được duyệt mới có quyền mua gói dịch vụ hoặc đổi điểm Top Point'
        });
        return false;
    }
    return true;
};

const getCandidateOverview = async (req, res) => {
    try {
        if (!requireCandidateAccess(req, res)) return undefined;
        const result = await rewardService.getCandidateRewardOverview(req.user.id);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const getCandidateTransactions = async (req, res) => {
    try {
        if (!requireCandidateAccess(req, res)) return undefined;
        const result = await rewardService.getCandidateTransactions({
            userId: req.user.id,
            limit: req.query?.limit,
            offset: req.query?.offset
        });
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const claimDailyCheckin = async (req, res) => {
    try {
        if (!requireCandidateAccess(req, res)) return undefined;
        const result = await rewardService.claimDailyCheckin(req.user.id);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const claimProfileComplete = async (req, res) => {
    try {
        if (!requireCandidateAccess(req, res)) return undefined;
        const result = await rewardService.claimProfileCompleteBonus(req.user.id);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const getCompetitionReport = async (req, res) => {
    try {
        const postId = req.params?.postId || req.query?.postId;
        const result = await rewardService.getJobCompetitionReport({
            postId,
            userId: req.user?.id || null,
            roleCode: getRoleCode(req)
        });
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const unlockCompetitionReport = async (req, res) => {
    try {
        if (!requireCandidateAccess(req, res)) return undefined;
        const postId = req.params?.postId || req.body?.postId;
        const result = await rewardService.unlockJobCompetitionReport({
            postId,
            userId: req.user.id
        });
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const getEmployerOverview = async (req, res) => {
    try {
        const roleCode = getRoleCode(req);
        const isAdmin = roleCode === ROLES.ADMIN;
        const isCompanyOwner = roleCode === ROLES.COMPANY && Boolean(req.user?.companyId);
        const isApprovedRecruiter = roleCode === ROLES.EMPLOYER && hasApprovedCompany(req);

        if (!isAdmin && !isCompanyOwner && !isApprovedRecruiter) {
            return res.status(403).json({
                errCode: 3,
                errMessage: 'Bạn không có quyền xem ví điểm doanh nghiệp'
            });
        }
        const companyId = isAdmin ? (req.query?.companyId || req.user.companyId) : req.user.companyId;
        const result = await rewardService.getEmployerRewardOverview(companyId, {
            canRedeem: roleCode === ROLES.COMPANY && hasApprovedCompany(req)
        });
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const getAdminRewardsOverview = async (req, res) => {
    try {
        if (getRoleCode(req) !== ROLES.ADMIN) {
            return res.status(403).json({
                errCode: 3,
                errMessage: 'Chỉ Quản trị viên mới có quyền giám sát điểm thưởng và thanh toán toàn hệ thống'
            });
        }
        const result = await rewardService.getAdminRewardsOverview({
            limit: req.query?.limit,
            offset: req.query?.offset,
            purpose: req.query?.purpose,
            status: req.query?.status
        });
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const redeemEmployerPoints = async (req, res) => {
    try {
        if (!requireApprovedCompanyOwner(req, res)) return undefined;
        const result = await rewardService.redeemEmployerPoints({
            companyId: req.user.companyId,
            userId: req.user.id,
            itemCode: req.body?.itemCode || req.body?.rewardCode
        });
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const getPaymentCatalog = async (req, res) => {
    try {
        const roleCode = getRoleCode(req);
        const result = await paymentOrderService.getPaymentCatalog({
            userId: req.user?.id || null,
            companyId: req.user?.companyId || null,
            roleCode
        });
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const previewPromoCode = async (req, res) => {
    try {
        const requestedPurpose = String(req.body?.purpose || req.query?.purpose || '').trim().toUpperCase();
        if (requestedPurpose === 'POINT_TOPUP' && !requireCandidateAccess(req, res)) return undefined;
        if ((requestedPurpose === 'PACKAGE_POST' || requestedPurpose === 'PACKAGE_CV') && !requireApprovedCompanyOwner(req, res)) {
            return undefined;
        }
        const result = paymentOrderService.evaluatePromo({
            promoCode: req.body?.promoCode || req.query?.promoCode,
            provider: req.body?.provider || req.query?.provider,
            amountVnd: req.body?.amountVnd || req.query?.amountVnd
        });
        return res.status(200).json({ errCode: result.valid ? 0 : 2, data: result, errMessage: result.errMessage });
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const createCheckout = async (req, res) => {
    try {
        const normalizedPurpose = String(req.body?.purpose || 'POINT_TOPUP').trim().toUpperCase();
        if (normalizedPurpose === 'PACKAGE_POST' || normalizedPurpose === 'PACKAGE_CV') {
            if (!requireApprovedCompanyOwner(req, res)) return undefined;
        } else if (normalizedPurpose === 'POINT_TOPUP') {
            if (!requireCandidateAccess(req, res)) return undefined;
        } else {
            return res.status(400).json({
                errCode: 2,
                errMessage: 'Loại giao dịch thanh toán không hợp lệ'
            });
        }

        const result = await paymentOrderService.createCheckout({
            userId: req.user.id,
            companyId: req.user.companyId,
            purpose: req.body?.purpose,
            itemCode: req.body?.itemCode || req.body?.packageCode || req.body?.packageId,
            quantity: req.body?.quantity || req.body?.amount || 1,
            provider: req.body?.provider,
            promoCode: req.body?.promoCode,
            bankCode: req.body?.bankCode,
            postId: req.body?.postId,
            returnUrl: req.body?.returnUrl,
            ipAddr: getClientIp(req)
        });
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const verifyPaymentReturn = async (req, res) => {
    try {
        const roleCode = getRoleCode(req);
        if (roleCode !== ROLES.CANDIDATE && roleCode !== ROLES.COMPANY) {
            return res.status(403).json({
                errCode: 3,
                errMessage: 'Tài khoản này không có quyền xác thực giao dịch thanh toán'
            });
        }
        const params = { ...(req.query || {}), ...(req.body || {}) };
        const result = await paymentOrderService.verifyPaymentReturn({
            userId: req.user.id,
            roleCode,
            companyId: req.user.companyId || null,
            provider: params.provider,
            params
        });
        if (result?.errCode === 3) {
            return res.status(403).json(result);
        }
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const getPaymentOrders = async (req, res) => {
    try {
        const roleCode = getRoleCode(req);
        const scope = String(req.query?.scope || 'self').trim().toLowerCase();

        if (scope === 'admin' || scope === 'all') {
            if (roleCode !== ROLES.ADMIN) {
                return res.status(403).json({
                    errCode: 3,
                    errMessage: 'Chỉ Quản trị viên mới có quyền xem toàn bộ giao dịch hệ thống'
                });
            }
            const result = await paymentOrderService.getUserPaymentOrders({
                all: true,
                companyId: req.query?.companyId || null,
                userId: req.query?.userId || null,
                purpose: req.query?.purpose,
                status: req.query?.status,
                limit: req.query?.limit,
                offset: req.query?.offset
            });
            return res.status(200).json(result);
        }

        if (scope === 'company') {
            if (
                (roleCode !== ROLES.COMPANY || !hasApprovedCompany(req))
                && roleCode !== ROLES.ADMIN
            ) {
                return res.status(403).json({
                    errCode: 3,
                    errMessage: 'Bạn không có quyền xem lịch sử thanh toán của doanh nghiệp'
                });
            }
            const companyId = roleCode === ROLES.ADMIN
                ? (req.query?.companyId || req.user.companyId)
                : req.user.companyId;
            const result = await paymentOrderService.getUserPaymentOrders({
                companyId,
                purpose: req.query?.purpose,
                status: req.query?.status,
                limit: req.query?.limit,
                offset: req.query?.offset
            });
            return res.status(200).json(result);
        }

        if (roleCode !== ROLES.CANDIDATE && roleCode !== ROLES.COMPANY) {
            return res.status(403).json({
                errCode: 3,
                errMessage: 'Tài khoản này không có đơn thanh toán cá nhân'
            });
        }

        const result = await paymentOrderService.getUserPaymentOrders({
            userId: req.user.id,
            purpose: roleCode === ROLES.CANDIDATE ? 'POINT_TOPUP' : (req.query?.purpose || ''),
            status: req.query?.status,
            limit: req.query?.limit,
            offset: req.query?.offset
        });
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const vnpayIpn = async (req, res) => {
    try {
        const result = await paymentOrderService.handleVnpayIpn(req.query || {});
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ RspCode: '99', Message: 'Unknown error' });
    }
};

const momoIpn = async (req, res) => {
    try {
        const result = await paymentOrderService.handleMomoIpn(req.body || {});
        return res.status(result.httpStatus || 200).json(result.body);
    } catch (error) {
        return res.status(500).json({ resultCode: 99, message: 'Server error' });
    }
};

const zalopayCallback = async (req, res) => {
    try {
        const result = await paymentOrderService.handleZaloPayCallback(req.body || {});
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ return_code: 0, return_message: error.message });
    }
};

module.exports = {
    getCandidateOverview,
    getCandidateTransactions,
    claimDailyCheckin,
    claimProfileComplete,
    getCompetitionReport,
    unlockCompetitionReport,
    getEmployerOverview,
    getAdminRewardsOverview,
    redeemEmployerPoints,
    getPaymentCatalog,
    previewPromoCode,
    createCheckout,
    verifyPaymentReturn,
    getPaymentOrders,
    vnpayIpn,
    momoIpn,
    zalopayCallback
};
