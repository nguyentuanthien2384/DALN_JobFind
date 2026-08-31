import userService from '../services/userService';
import { canAccessCandidateProfile, canManageCompanyUser } from '../utils/authorization';
import { getGrantedPermissions } from '../middlewares/authorize';

const canUpdateUser = (req, targetUserId) => {
    const roleCode = req.user?.userAccountData?.roleCode;
    return roleCode === 'ADMIN' || Number(req.user?.id) === Number(targetUserId);
};


let handleCreateNewUser = async (req, res) => {
    try {
        // Quyen cua tai khoan moi khong duoc tin tuong tu body: neu khong chan,
        // bat ky ai cung tu dang ky duoc mot tai khoan ADMIN.
        let data = await userService.handleCreateNewUser({
            ...req.body,
            creatorRoleCode: req.user?.userAccountData?.roleCode || null,
            creatorCompanyId: req.user?.companyId || null
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
let handleUpdateUser = async (req, res) => {
    try {
        const isAdmin = req.user?.userAccountData?.roleCode === 'ADMIN';
        const isSelf = Number(req.user?.id) === Number(req.body.id);
        const canManageTeamMember = !isAdmin && !isSelf
            && await canManageCompanyUser(req, req.body.id);
        if (!canUpdateUser(req, req.body.id) && !canManageTeamMember) {
            return res.status(403).json({
                errCode: 3,
                errMessage: 'Bạn không có quyền cập nhật hồ sơ của người dùng khác'
            });
        }
        // A normal user may edit their profile, but never their role. The role
        // in the browser is not an authority; only an ADMIN route may change it.
        const updateData = { ...req.body };
        if (isAdmin) {
            updateData.allowedRoleCodes = ['ADMIN', 'COMPANY', 'EMPLOYER', 'CANDIDATE'];
        } else if (canManageTeamMember) {
            // Chu cong ty co the gan dong chu/nhan vien trong cung cong ty,
            // nhung khong the nang thanh ADMIN hay chuyen thanh CANDIDATE.
            updateData.allowedRoleCodes = ['COMPANY', 'EMPLOYER'];
        } else {
            delete updateData.roleCode;
            updateData.id = req.user.id;
        }
        updateData.allowRoleChange = Boolean(isAdmin || canManageTeamMember);
        let data = await userService.updateUserData(updateData);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let getCurrentAuthorization = async (req, res) => {
    return res.status(200).json({
        errCode: 0,
        data: {
            userId: Number(req.user.id),
            roleCode: req.user.userAccountData.roleCode,
            companyId: req.user.companyId === null || req.user.companyId === undefined
                ? null
                : Number(req.user.companyId),
            permissions: getGrantedPermissions(req)
        }
    });
}
let handleBanUser = async (req, res) => {
    try {
        let data = await userService.banUser(req.body.data.id);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let handleUnbanUser = async (req, res) => {
    try {
        let data = await userService.unbanUser(req.body.data.id);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let handleLogin = async (req, res) => {
    try {
        let data = await userService.handleLogin(req.body);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let handleChangePassword = async (req, res) => {
    try {
        // Khong lay id tu client: tai khoan dang dang nhap chi duoc doi mat khau cua minh.
        let data = await userService.handleChangePassword({
            ...req.body,
            id: req.user.id
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
let getAllUser = async (req, res) => {
    try {
        let data = await userService.getAllUser(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let getDetailUserById = async (req, res) => {
    try {
        // Ho so chua thong tin lien he va file CV. Role nha tuyen dung khong du:
        // cong ty phai mo khoa dung ung vien; candidate tu xem va admin duoc mien.
        const allowed = await canAccessCandidateProfile(req, req.query.id);
        if (!allowed) {
            return res.status(403).json({
                errCode: 3,
                errMessage: 'Bạn chưa mở quyền xem hồ sơ ứng viên này'
            });
        }
        let data = await userService.getDetailUserById(req.query.id);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let checkUserPhone = async (req, res) => {
    try {
        let data = await userService.checkUserPhone(req.query.phonenumber);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let requestResetPasswordOtp = async (req, res) => {
    try {
        let data = await userService.requestResetPasswordOtp(req.body);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let changePaswordByPhone = async (req, res) => {
    try {
    let data = await userService.changePaswordByPhone(req.body);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let setDataUserSetting = async (req, res) => {
    try {
        if (!canUpdateUser(req, req.body.id)) {
            return res.status(403).json({
                errCode: 3,
                errMessage: 'Bạn không có quyền cập nhật cài đặt của người dùng khác'
            });
        }
        let data = await userService.setDataUserSetting(req.body);
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
    handleCreateNewUser: handleCreateNewUser,
    handleUpdateUser: handleUpdateUser,
    handleBanUser: handleBanUser,
    handleUnbanUser: handleUnbanUser,
    handleLogin: handleLogin,
    handleChangePassword: handleChangePassword,
    getAllUser: getAllUser,
    getDetailUserById: getDetailUserById,
    checkUserPhone: checkUserPhone,changePaswordByPhone,
    requestResetPasswordOtp,
    setDataUserSetting,
    getCurrentAuthorization
}
