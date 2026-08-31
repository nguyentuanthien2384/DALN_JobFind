import companyService from '../services/companyService';

let handleCreateNewCompany = async (req, res) => {
    try {
        let data = await companyService.handleCreateNewCompany({
            ...req.body,
            userId: req.user.id
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
let handleUpdateCompany = async (req, res) => {
    try {
        // A company member may only update the company recorded on their
        // authenticated user. body.id used to make cross-company edits possible.
        let data = await companyService.handleUpdateCompany({
            ...req.body,
            id: req.user.companyId
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
let handleBanCompany = async (req, res) => {
    try {
        let data = await companyService.handleBanCompany(req.body.id);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let handleUnBanCompany = async (req, res) => {
    try {
        let data = await companyService.handleUnBanCompany(req.body.id);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let handleAddUserCompany = async (req, res) => {
    try {
        let data = await companyService.handleAddUserCompany({
            ...req.body,
            companyId: req.user.companyId
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
let getListCompany = async (req, res) => {
    try {
        let data = await companyService.getListCompany(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let getDetailCompanyById = async (req, res) => {
    try {
        let data = await companyService.getDetailCompanyById(req.query.id);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let getDetailCompanyByUserId = async (req, res) => {
    try {
        const isAdmin = req.user?.userAccountData?.roleCode === 'ADMIN';
        // The private variant may include verification documents. Company
        // owners are bound to their token; only an admin may select a target.
        let data = await companyService.getDetailCompanyByUserId(isAdmin
            ? req.query
            : { userId: req.user.id, companyId: req.user.companyId });
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let getAllUserByCompanyId = async (req, res) => {
    try {
        let data = await companyService.getAllUserByCompanyId({
            ...req.query,
            companyId: req.user.companyId
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
let handleQuitCompany = async (req, res) => {
    try {
        const requesterRoleCode = req.user.userAccountData?.roleCode;
        // COMPANY accounts use this endpoint to dismiss an employee; EMPLOYER
        // accounts may only remove themselves. Keep actor and target explicit so
        // a client-supplied userId is never mistaken for the authenticated actor.
        const targetUserId = requesterRoleCode === 'COMPANY'
            ? req.body.userId
            : req.user.id;
        let data = await companyService.handleQuitCompany({
            ...req.body,
            userId: req.user.id,
            targetUserId,
            requesterUserId: req.user.id,
            requesterCompanyId: req.user.companyId,
            requesterRoleCode
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

let getAllCompanyByAdmin = async (req, res) => {
    try {
        let data = await companyService.getAllCompanyByAdmin(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let handleAccecptCompany = async (req, res) => {
    try {
        let data = await companyService.handleAccecptCompany(req.body);
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
    handleCreateNewCompany: handleCreateNewCompany,
    handleBanCompany: handleBanCompany,
    handleUnBanCompany: handleUnBanCompany,
    handleUpdateCompany: handleUpdateCompany,
    handleAddUserCompany: handleAddUserCompany,
    getListCompany: getListCompany,
    getDetailCompanyById: getDetailCompanyById,
    getDetailCompanyByUserId: getDetailCompanyByUserId,
    getAllUserByCompanyId: getAllUserByCompanyId,
    handleQuitCompany: handleQuitCompany,
    getAllCompanyByAdmin: getAllCompanyByAdmin,
    handleAccecptCompany : handleAccecptCompany
}
