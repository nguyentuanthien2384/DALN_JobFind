import userService from '../services/userService';

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
        if (!canUpdateUser(req, req.body.id)) {
            return res.status(403).json({
                errCode: 3,
                errMessage: 'Bạn không có quyền cập nhật hồ sơ của người dùng khác'
            });
        }
        let data = await userService.updateUserData(req.body);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
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
        // Ho so ca nhan chua email, dia chi, ngay sinh va file CV. Ung vien chi
        // duoc xem ho so cua chinh minh; nha tuyen dung va admin duoc xem ho so
        // ung vien khac (phuc vu man hinh tim ung vien).
        const role = req.user?.userAccountData?.roleCode;
        const canViewOthers = role === 'ADMIN' || role === 'EMPLOYER' || role === 'COMPANY';
        if (!canViewOthers && Number(req.query.id) !== Number(req.user.id)) {
            return res.status(403).json({
                errCode: 3,
                errMessage: 'Bạn không có quyền xem hồ sơ của người dùng khác'
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
    setDataUserSetting
}
