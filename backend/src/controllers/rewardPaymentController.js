import rewardService from '../services/rewardService';
import paymentOrderService from '../services/paymentOrderService';
import { emitDashboardChanged } from '../config/socket';

const getClientIp = (req) => (
    req.headers?.['x-forwarded-for']
    || req.socket?.remoteAddress
    || req.ip
    || '127.0.0.1'
);

const getCandidateOverview = async (req, res) => {
    try {
        const result = await rewardService.getCandidateRewardOverview(req.user.id);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const getCandidateTransactions = async (req, res) => {
    try {
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
        const result = await rewardService.claimDailyCheckin(req.user.id);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const claimProfileComplete = async (req, res) => {
    try {
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
            userId: req.user?.id || null
        });
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const unlockCompetitionReport = async (req, res) => {
    try {
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
        const isAdmin = req.user?.userAccountData?.roleCode === 'ADMIN';
        const companyId = isAdmin ? (req.query?.companyId || req.user.companyId) : req.user.companyId;
        const result = await rewardService.getEmployerRewardOverview(companyId);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const redeemEmployerPoints = async (req, res) => {
    try {
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
        const result = await paymentOrderService.getPaymentCatalog({
            userId: req.user?.id || null,
            companyId: req.user?.companyId || null
        });
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const previewPromoCode = async (req, res) => {
    try {
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
        const params = { ...(req.query || {}), ...(req.body || {}) };
        const result = await paymentOrderService.verifyPaymentReturn({
            userId: req.user.id,
            provider: params.provider,
            params
        });
        if (result?.errCode === 0 && !result.alreadyProcessed && !result.requireSimulationAction) {
            const purpose = result.data?.purpose;
            if (purpose === 'PACKAGE_POST' || purpose === 'PACKAGE_CV') {
                try {
                    await emitDashboardChanged(
                        purpose === 'PACKAGE_POST' ? 'payment-post' : 'payment-cv',
                        { userId: req.user.id }
                    );
                } catch (err) {
                    // Khong chan phan hoi thanh toan khi socket dashboard ban.
                }
            }
        }
        return res.status(200).json(result);
    } catch (error) {
        return res.status(200).json({ errCode: -1, errMessage: 'Error from server' });
    }
};

const getPaymentOrders = async (req, res) => {
    try {
        const scope = String(req.query?.scope || '').toLowerCase();
        const result = await paymentOrderService.getUserPaymentOrders({
            userId: scope === 'company' ? null : req.user.id,
            companyId: scope === 'company' ? req.user.companyId : null,
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
