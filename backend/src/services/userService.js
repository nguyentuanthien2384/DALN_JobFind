import db from "../models/index";
import bcrypt from "bcryptjs";
const { Op } = require("sequelize");
import CommonUtils from '../utils/CommonUtils';
const cloudinary = require('../utils/cloudinary');
const otpStore = require('../utils/otpStore');
const { getFrontendLink } = require('../utils/frontendUrl');
const salt = bcrypt.genSaltSync(10);
require('dotenv').config();
let nodemailer = require('nodemailer');
const normalizeEmail = (email) => typeof email === 'string'
    ? email.trim().toLowerCase()
    : ''

const isValidRecipientEmail = (email) => {
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail || normalizedEmail.length > 254) return false

    const parts = normalizedEmail.split('@')
    if (parts.length !== 2) return false
    const [localPart, domain] = parts
    if (
        !localPart || localPart.length > 64
        || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')
        || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)
    ) return false

    const labels = domain.split('.')
    if (domain.length > 253 || labels.length < 2 || !labels.every(label => (
        label.length > 0
        && label.length <= 63
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    ))) return false

    if (normalizedEmail === 'example@gmail.com') return false
    const reservedDomains = ['example.com', 'example.net', 'example.org']
    if (reservedDomains.some(reserved => domain === reserved || domain.endsWith(`.${reserved}`))) {
        return false
    }
    return !['.example', '.invalid', '.test', '.local', '.localhost']
        .some(suffix => domain.endsWith(suffix))
}

let sendmail = (note, userMail, link = null) => {
    let transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_APP,
            pass: process.env.EMAIL_APP_PASSWORD,
        }
    });

    let mailOptions = {
        from: process.env.EMAIL_APP,
        to: userMail,
        subject: 'Thông báo từ trang Job Finder',
        html: note
    };
    if (link)
    {
        mailOptions.html = note + ` xem thông tin <a href='${getFrontendLink(link)}'>Tại đây</a> `
    }

    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error.message)
        } else {
        }
    });
}
let hashUserPasswordFromBcrypt = (password) => {
    return new Promise(async (resolve, reject) => {
        try {
            let hashPassword = await bcrypt.hashSync(password, salt);
            resolve(hashPassword);
        } catch (error) {
            reject(error)
        }
    })
}
let checkUserPhone = (userPhone) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!userPhone) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters!'
                })
            } else {
                let account = await db.Account.findOne({
                    where: { phonenumber: userPhone }
                })
                if (account) {
                    resolve(true)
                } else {
                    resolve(false)
                }
            }


        } catch (error) {
            reject(error)
        }
    })
}
let handleCreateNewUser = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.phonenumber || !data.lastName || !data.firstName || !data.email) {
                resolve({
                    errCode: 2,
                    errMessage: 'Missing required parameters !'
                })
            } else {
                const normalizedEmail = normalizeEmail(data.email)
                if (!isValidRecipientEmail(normalizedEmail)) {
                    resolve({
                        errCode: 4,
                        errMessage: 'Email không hợp lệ hoặc không thể nhận thư'
                    })
                    return
                }
                data.email = normalizedEmail

                // Quyen cua tai khoan moi phai duoc chan theo nguoi tao, neu khong
                // bat ky khach vang lai nao cung tu dang ky duoc mot tai khoan ADMIN.
                // Cac muc nay khop voi danh sach ma man hinh Dang ky / Them nguoi dung
                // dang cho chon.
                let allowedRoles
                if (data.creatorRoleCode === 'ADMIN') {
                    allowedRoles = ['ADMIN', 'CANDIDATE', 'EMPLOYER', 'COMPANY']
                } else if (data.creatorRoleCode === 'COMPANY' && data.creatorCompanyId) {
                    allowedRoles = ['EMPLOYER', 'COMPANY']
                } else if (!data.creatorRoleCode) {
                    // Khach chua dang nhap duoc tu dang ky hai vai tro cong khai.
                    allowedRoles = ['CANDIDATE', 'EMPLOYER']
                } else {
                    // Tai khoan da dang nhap nhung khong co quyen quan ly user
                    // khong duoc loi dung endpoint dang ky de tao tai khoan ho.
                    allowedRoles = []
                }
                if (!allowedRoles.includes(data.roleCode)) {
                    resolve({
                        errCode: 3,
                        errMessage: 'Bạn không có quyền tạo tài khoản với vai trò này'
                    })
                    return
                }

                // companyId la ranh gioi tenant, tuyet doi khong duoc tin tu
                // payload dang ky cong khai. Khach/EMPLOYER/CANDIDATE tu dang ky
                // luon bat dau ngoai cong ty; COMPANY da xac thuc chi gan duoc
                // nhan su vao chinh cong ty minh. ADMIN moi co the chon tenant.
                if (data.creatorRoleCode === 'COMPANY') {
                    data.companyId = data.creatorCompanyId
                } else if (data.creatorRoleCode === 'ADMIN'
                    && ['COMPANY', 'EMPLOYER'].includes(data.roleCode)) {
                    data.companyId = data.companyId || null
                } else {
                    data.companyId = null
                }

                let check = await checkUserPhone(data.phonenumber);
                if (check) {
                    resolve({
                        errCode: 1,
                        errMessage: 'Số điện thoại đã tồn tại !'
                    })
                } else {
                    let imageUrl = ""
                    let isHavePass = true
                    if (!data.password) {
                        data.password = `${new Date().getTime().toString()}`
                        isHavePass = false
                    }
                    let hashPassword = await hashUserPasswordFromBcrypt(data.password);
                    if (data.image) {
                        const uploadedResponse = await cloudinary.uploader.upload(data.image, {
                            upload_preset: 'dev_setups'
                        })
                        imageUrl = uploadedResponse.url
                    }
                    let params = {
                        firstName: data.firstName,
                        lastName: data.lastName,
                        address: data.address,
                        genderCode: data.genderCode,
                        image: imageUrl,
                        dob: data.dob,
                        companyId: data.companyId,
                        email: data.email
                    }
                    if (data.companyId){
                        params.companyId = data.companyId
                    }
                    let user = await db.User.create(params)
                    if (user)
                    {
                        await db.Account.create({
                            phonenumber: data.phonenumber,
                            password: hashPassword,
                            roleCode: data.roleCode,
                            statusCode: 'S1',
                            userId: user.id
                        })
                    }
                    if (!isHavePass) {
                        let note = `<h3>Tài khoản đã tạo thành công</h3>
                                    <p>Tài khoản: ${data.phonenumber}</p>
                                    <p>Mật khẩu: ${data.password}</p>
                        `
                        sendmail(note,data.email)                        
                    }
                    resolve({
                        errCode: 0,
                        message: 'Tạo tài khoản thành công'
                    })
                }

            }

        } catch (error) {
            reject(error.message)
        }
    })
}

let banUser = (userId) => {
    return new Promise(async (resolve, reject) => {
        try {

            if (!userId) {
                resolve({
                    errCode: 1,
                    errMessage: `Missing required parameters !`
                })
            } else {
                let foundUser = await db.User.findOne({
                    where: { id: userId },
                    attributes: {
                        exclude: ['userId']
                    }
                })
                if (!foundUser) {
                    resolve({
                        errCode: 2,
                        errMessage: `Người dùng không tồn tại`
                    })
                }
                else{
                    let account = await db.Account.findOne({
                        where: {userId: userId},
                        raw: false
                    })
                    if (account)
                    {
                        account.statusCode = 'S2'
                        await account.save()
                        resolve({
                            errCode: 0,
                            message: `Người dùng đã ngừng kích hoạt`
                        })
                    } else {
                        resolve({
                            errCode: 2,
                            errMessage: `Tài khoản người dùng không tồn tại`
                        })
                    }
                }
            }

        } catch (error) {
            reject(error)
        }
    })
}

let unbanUser = (userId) => {
    return new Promise(async (resolve, reject) => {
        try {

            if (!userId) {
                resolve({
                    errCode: 1,
                    errMessage: `Missing required parameters !`
                })
            } else {
                let foundUser = await db.User.findOne({
                    where: { id: userId },
                    attributes: {
                        exclude: ['userId']
                    }
                })
                if (!foundUser) {
                    resolve({
                        errCode: 2,
                        errMessage: `Người dùng không tồn tại`
                    })
                }
                else{
                    let account = await db.Account.findOne({
                        where: {userId: userId},
                        raw: false
                    })
                    if (account)
                    {
                        account.statusCode = 'S1'
                        await account.save()
                        resolve({
                            errCode: 0,
                            message: `Người dùng đã kích hoạt`
                        })
                    } else {
                        resolve({
                            errCode: 2,
                            errMessage: `Tài khoản người dùng không tồn tại`
                        })
                    }
                }
            }

        } catch (error) {
            reject(error)
        }
    })
}
let updateUserData = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.id) {
                resolve({
                    errCode: 2,
                    errMessage: `Missing required parameters`
                })
            } else {
                const hasEmailUpdate = Object.prototype.hasOwnProperty.call(data, 'email')
                const normalizedEmail = hasEmailUpdate ? normalizeEmail(data.email) : null
                if (hasEmailUpdate && !isValidRecipientEmail(normalizedEmail)) {
                    resolve({
                        errCode: 4,
                        errMessage: 'Email không hợp lệ hoặc không thể nhận thư'
                    })
                    return
                }

                let user = await db.User.findOne({
                    where: { id: data.id },
                    raw: false,
                    attributes: {
                        exclude: ['userId']
                    }
                })
                let account = await db.Account.findOne({
                    where: {userId: data.id},
                    raw:false
                })
                if (user && account) {
                    if (data.roleCode && data.allowRoleChange) {
                        const validRoles = Array.isArray(data.allowedRoleCodes)
                            ? data.allowedRoleCodes
                            : []
                        if (!validRoles.includes(data.roleCode)) {
                            resolve({
                                errCode: 3,
                                errMessage: 'Vai trò người dùng không hợp lệ'
                            })
                            return
                        }
                    }
                    user.firstName = data.firstName
                    user.lastName = data.lastName
                    user.address = data.address
                    user.genderCode = data.genderCode
                    user.dob = data.dob
                    if (hasEmailUpdate) user.email = normalizedEmail
                    if (data.image) {
                        let imageUrl = ""
                        const uploadedResponse = await cloudinary.uploader.upload(data.image, {
                            upload_preset: 'dev_setups'
                        })
                        imageUrl = uploadedResponse.url
                        user.image = imageUrl
                    }
                    await user.save();
                    if (data.roleCode && data.allowRoleChange) {
                        account.roleCode = data.roleCode
                    }
                    await account.save();
                    let temp = {
                        address: user.address,
                        companyId: user.companyId,
                        dob: user.dob,
                        email: user.email,
                        firstName: user.firstName,
                        genderCode: user.genderCode,
                        id: user.id,
                        image: user.image,
                        lastName: user.lastName,
                        roleCode: account.roleCode
                    }
                    delete temp.file
                    resolve({
                        errCode: 0,
                        message: 'Đã chỉnh sửa thành công',
                        user: temp
                    })
                } else {
                    resolve({
                        errCode: 1,
                        errMessage: 'User not found!'
                    })
                }
            }

        } catch (error) {
            reject(error)
        }
    })
}
// Che bot dia chi mail truoc khi tra ve cho client: du de nguoi dung nhan ra hom
// thu cua minh, nhung khong tiet lo dia chi day du cho nguoi dang do so dien thoai.
let maskEmail = (email) => {
    if (!email || !email.includes('@')) return ''
    let [name, domain] = email.split('@')
    let visible = name.slice(0, 2)
    return `${visible}${'*'.repeat(Math.max(name.length - 2, 1))}@${domain}`
}

// Buoc 1 cua luong quen mat khau: gui ma OTP toi email gan voi so dien thoai.
let requestResetPasswordOtp = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.phonenumber) {
                resolve({
                    errCode: 1,
                    errMessage: 'Thiếu số điện thoại'
                })
                return
            }
            let account = await db.Account.findOne({
                where: { phonenumber: data.phonenumber },
                include: [{ model: db.User, as: 'userAccountData', attributes: ['email', 'firstName', 'lastName'] }],
                raw: true,
                nest: true
            })
            if (!account) {
                resolve({
                    errCode: 1,
                    errMessage: 'SĐT không tồn tại'
                })
                return
            }
            let email = account.userAccountData && account.userAccountData.email
            if (!email) {
                resolve({
                    errCode: 3,
                    errMessage: 'Tài khoản chưa có email, vui lòng liên hệ quản trị viên để đặt lại mật khẩu'
                })
                return
            }

            let { code, waitSeconds } = otpStore.issueOtp(data.phonenumber)
            if (!code) {
                resolve({
                    errCode: 4,
                    errMessage: `Vui lòng đợi ${waitSeconds} giây trước khi yêu cầu mã mới`
                })
                return
            }

            let note = `<h3>Đặt lại mật khẩu Job Finder</h3>
                        <p>Mã xác thực của bạn là: <b style="font-size:20px;letter-spacing:3px">${code}</b></p>
                        <p>Mã có hiệu lực trong 5 phút. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.</p>`
            sendmail(note, email)

            // Khi chua cau hinh EMAIL_APP (moi truong dev) thi mail khong the gui di
            // duoc, in ma ra console de con chay thu duoc luong nay.
            if (!process.env.EMAIL_APP || process.env.EMAIL_APP.includes('youremail')) {
                console.log(`[DEV] Ma OTP dat lai mat khau cho ${data.phonenumber}: ${code}`)
            }

            resolve({
                errCode: 0,
                errMessage: 'Đã gửi mã xác thực',
                email: maskEmail(email)
            })
        } catch (error) {
            reject(error)
        }
    })
}

// Buoc 2: doi mat khau. Bat buoc phai kem ma OTP hop le, neu khong bat ky ai
// biet so dien thoai deu doi duoc mat khau cua nguoi khac.
let changePaswordByPhone = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.phonenumber || !data.password || !data.otp) {
                resolve({
                    errCode: 1,
                    errMessage: 'Thiếu số điện thoại, mật khẩu mới hoặc mã xác thực'
                })
                return
            }
            if (String(data.password).length < 6) {
                resolve({
                    errCode: 5,
                    errMessage: 'Mật khẩu phải có ít nhất 6 ký tự'
                })
                return
            }

            let account = await db.Account.findOne({
                where: { phonenumber: data.phonenumber },
                raw: false
            })
            if (!account) {
                resolve({
                    errCode: 1,
                    errMessage: 'SĐT không tồn tại'
                })
                return
            }

            let check = otpStore.verifyOtp(data.phonenumber, data.otp)
            if (!check.valid) {
                resolve({
                    errCode: 2,
                    errMessage: check.errMessage
                })
                return
            }

            account.password = await hashUserPasswordFromBcrypt(data.password);
            await account.save();
            resolve({
                errCode: 0,
                errMessage: 'ok'
            })
        } catch (error) {
            reject(error)
        }
    })
}
let handleLogin = (data) => {
    return new Promise(async (resolve, reject) => {
        try {

            if (!data.phonenumber || !data.password) {
                resolve({
                    errCode: 4,
                    errMessage: 'Missing required parameters!'
                })
            }
            else {
                let userData = {};

                let isExist = await checkUserPhone(data.phonenumber);

                if (isExist) {
                    let account = await db.Account.findOne({
                        where: { phonenumber: data.phonenumber },
                        raw: true
                    })
                    if (account) {
                        let check = await bcrypt.compareSync(data.password, account.password);
                        if (check) {
                            if (account.statusCode == 'S1')
                            {
                                let user = await db.User.findOne({
                                    attributes: {
                                        exclude: ['userId','file']
                                    },
                                    where: {id: account.userId  },
                                    include: [
                                        {
                                            model: db.Company,
                                            as: 'userCompanyData',
                                            attributes: ['id', 'statusCode', 'censorCode'],
                                            required: false
                                        }
                                    ],
                                    raw: true,
                                    nest: true
                                })
                                user.roleCode = account.roleCode
                                user.companyStatusCode = user.userCompanyData?.statusCode || null
                                user.companyCensorCode = user.userCompanyData?.censorCode || null
                                delete user.userCompanyData
                                userData.errMessage = 'Ok';
                                userData.errCode = 0;
                                userData.user= user;
                                userData.token = CommonUtils.encodeToken(
                                    user.id, account.roleCode, user.companyId ?? null
                                )
                            }
                            else {
                                userData.errCode = 1;
                                userData.errMessage = 'Tài khoản của bạn đã bị khóa';
                            }
                        }
                        else {
                            userData.errCode = 2;
                            userData.errMessage = 'Số điện thoại hoặc mật khẩu không chính xác';
                        }
                    } else {
                        userData.errCode = 3;
                        userData.errMessage = 'User not found!'
                    }
                } else {
                    userData.errCode = 2;
                    userData.errMessage = `Số điện thoại hoặc mật khẩu không chính xác`
                }
                resolve(userData)
            }


        } catch (error) {
            reject(error)
        }
    })
}
let handleChangePassword = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.id || !data.password || !data.oldpassword) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameter!'
                })
            } else {
                let account = await db.Account.findOne({
                    where: { userId: data.id },
                    raw: false
                })
                if (!account) {
                    resolve({
                        errCode: 3,
                        errMessage: 'Tài khoản không tồn tại'
                    })
                }
                else if (await bcrypt.compareSync(data.oldpassword, account.password)) {
                    account.password = await hashUserPasswordFromBcrypt(data.password);
                    await account.save();
                    resolve({
                        errCode: 0,
                        errMessage: 'ok'
                    })
                }
                else {
                    resolve({
                        errCode: 2,
                        errMessage: 'Mật khẩu cũ không chính xác'
                    })
                }

            }
        } catch (error) {
            reject(error)
        }
    })
}
let getAllUser = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.limit || data.offset === undefined || data.offset === null || data.offset === '') {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameter !'
                })
            } else {
                let objectFilter = {
                    limit: +data.limit,
                    offset: +data.offset,
                    attributes: {
                        exclude: ['password']
                    },
                    include: [
                        { model: db.Allcode, as: 'roleData' ,attributes: ['code','value'] }, 
                        { model: db.Allcode, as: 'statusAccountData',attributes: ['code','value']},
                        { model: db.User, as: 'userAccountData', attributes: {
                            exclude: ['userId']
                        },
                            include: [
                                { model: db.Allcode, as: 'genderData', attributes: ['value', 'code'] },
                            ]
                        }
                    ],
                    raw: true,
                    nest: true,
                }
                if (data.search) {
                    objectFilter.where = {phonenumber: {[Op.like]: `%${data.search}%`}}
                }
                let res = await db.Account.findAndCountAll(objectFilter)
                resolve({
                    errCode: 0,
                    data: res.rows,
                    count: res.count
                })
            }

        } catch (error) {
            reject(error.message)
        }
    })
}
let getDetailUserById = (userid) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!userid) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters!'
                })
            } else {
                let res = await db.Account.findOne({
                    where: { userId: userid, statusCode: 'S1' },
                    attributes: {
                        exclude: ['password']
                    },
                    include: [
                        { model: db.Allcode, as: 'roleData', attributes: ['value', 'code'] },
                        { model: db.User, as: 'userAccountData', attributes: {
                            exclude: ['userId'],
                        },
                            include: [
                                { model: db.Allcode, as: 'genderData', attributes: ['value', 'code'] },
                                { model: db.UserSetting, as: 'userSettingData'},
                            ]
                        },
                    ],
                    raw: true,
                    nest: true
                })
                if (!res || !res.userAccountData) {
                    resolve({
                        errCode: 2,
                        errMessage: 'Không tìm thấy người dùng'
                    })
                    return
                }
                if (res.userAccountData.userSettingData && res.userAccountData.userSettingData.file) {
                    res.userAccountData.userSettingData.file = Buffer.from(res.userAccountData.userSettingData.file, 'base64').toString('binary');
                }
                let listSkills = await db.UserSkill.findAll({
                    where: {userId: res.userAccountData.id},
                    include: db.Skill,
                    raw: true,
                    nest: true
                })
                res.listSkills= listSkills
                resolve({
                    errCode: 0,
                    data: res,
                })
            }
        } catch (error) {
            reject(error.message)
        }
    })
}

let setDataUserSetting = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.id || !data.data) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameters!'
                })
            } else {
                let user = await db.User.findOne({
                    where: {id: data.id},
                    attributes: {
                        exclude: ['userId']
                    },
                })
                if (user) {
                    let userSetting = await db.UserSetting.findOne({
                        where: {userId: user.id},
                        raw: false,
                    })
                    if (userSetting) {
                        userSetting.salaryJobCode = data.data.salaryJobCode
                        userSetting.categoryJobCode = data.data.categoryJobCode
                        userSetting.addressCode = data.data.addressCode
                        userSetting.experienceJobCode = data.data.experienceJobCode
                        userSetting.isTakeMail = data.data.isTakeMail
                        userSetting.isFindJob = data.data.isFindJob 
                        userSetting.file = data.data.file
                        await userSetting.save()
                    }
                    else {
                        let params = {
                            salaryJobCode: data.data.salaryJobCode,
                            categoryJobCode : data.data.categoryJobCode,
                            addressCode : data.data.addressCode,
                            experienceJobCode : data.data.experienceJobCode,
                            file : data.data.file,
                            userId: user.id
                        }
                        if (data.data.isTakeMail) params.isTakeMail = data.data.isTakeMail
                        if (data.data.isFindJob) params.isFindJob = data.data.isFindJob
                        await db.UserSetting.create(params)
                    }
                    if (data.data.listSkills && Array.isArray(data.data.listSkills)) {
                        await db.UserSkill.destroy({
                            where: {userId: user.id}
                        })
                        let objUserSkill = data.data.listSkills.map(item=>{
                            return {
                                UserId: user.id,
                                SkillId: item
                            }
                        })
                        await db.UserSkill.bulkCreate(objUserSkill)
                    }
                    resolve({
                        errCode: 0,
                        errMessage: "Hệ thống đã ghi nhận lựa chọn"
                    })
                }
                else {
                    resolve({
                        errCode: 2,
                        errMessage: "Không tồn tại người dùng này"
                    })
                }
            }
        } catch (error) {
            reject(error)
        }
    })
}


module.exports = {
    handleCreateNewUser: handleCreateNewUser,
    banUser: banUser,
    unbanUser: unbanUser,
    updateUserData: updateUserData,
    handleLogin: handleLogin,
    handleChangePassword: handleChangePassword,
    getAllUser: getAllUser,
    getDetailUserById: getDetailUserById,
    checkUserPhone: checkUserPhone, changePaswordByPhone,
    requestResetPasswordOtp,
    setDataUserSetting
}
