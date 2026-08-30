import packageService from '../services/packagePostService';
import { emitDashboardChanged } from '../config/socket';

let getAllPackage = async (req, res) => {
    try {
        let data = await packageService.getAllPackage(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let getPackageById = async (req, res) => {
    try {
        let data = await packageService.getPackageById(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let getPackageByType = async (req, res) => {
    try {
        let data = await packageService.getPackageByType(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let getPaymentLink = async (req, res) => {
    try {
        let data = await packageService.getPaymentLink(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let paymentOrderSuccess = async (req, res) => {
    try {
        // Never let a PayPal callback credit a user selected by the client.
        let data = await packageService.paymentOrderSuccess({
            ...req.body,
            userId: req.user.id
        });
        // Mua goi thanh cong -> bang doanh thu goi bai dang cua admin doi ngay.
        if (data.errCode === 0) emitDashboardChanged('payment-post');
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let setActiveTypePackage = async (req, res) => {
    try {
        let data = await packageService.setActiveTypePackage(req.body);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let creatNewPackagePost = async (req, res) => {
    try {
        let data = await packageService.creatNewPackagePost(req.body);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let updatePackagePost = async (req, res) => {
    try {
        let data = await packageService.updatePackagePost(req.body);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let getStatisticalPackage = async (req, res) => {
    try {
        let data = await packageService.getStatisticalPackage(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let getHistoryTrade = async (req, res) => {
    try {
        const isAdmin = req.user?.userAccountData?.roleCode === 'ADMIN';
        let data = await packageService.getHistoryTrade({
            ...req.query,
            companyId: isAdmin ? req.query.companyId : req.user.companyId
        });
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let getSumByYear = async (req, res) => {
    try {
        let data = await packageService.getSumByYear(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

module.exports = {
    getPackageByType : getPackageByType,
    getPaymentLink: getPaymentLink,
    paymentOrderSuccess: paymentOrderSuccess,
    getAllPackage: getAllPackage,
    setActiveTypePackage: setActiveTypePackage,
    getPackageById: getPackageById,
    creatNewPackagePost: creatNewPackagePost,
    updatePackagePost: updatePackagePost,
    getStatisticalPackage: getStatisticalPackage,
    getHistoryTrade: getHistoryTrade,
    getSumByYear: getSumByYear
}
