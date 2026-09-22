import { saveAndRevokeSessions } from './accountSecurityService';
import db from "../models/index";
import bcrypt from "bcryptjs";
import crypto from 'crypto';
const { Op, fn, col, where: sqlWhere, Transaction } = require("sequelize");
import { normalizeEmail, isValidRecipientEmail, validateNewPassword, validateRegistration } from '../utils/accountValidation';
import CommonUtils from '../utils/CommonUtils';
const cloudinary = require('../utils/cloudinary');
const otpStore = require('../utils/otpStore');
const { getFrontendLink } = require('../utils/frontendUrl');
require('dotenv').config();
let nodemailer = require('nodemailer');
let sendmail = (note, userMail, link = null) => {
    if (!process.env.EMAIL_APP || !process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_APP.includes('youremail')) {
        return Promise.resolve(false);
    }
    let transporter = nodemailer.createTransport({
        service: 'gmail',
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
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

    return new Promise(resolve => transporter.sendMail(mailOptions, error => {
        if (error) console.error('AUTH_EMAIL_DELIVERY_FAILED');
        resolve(!error);
    }));
}
let hashUserPasswordFromBcrypt = (password) => {
    return new Promise(async (resolve, reject) => {
        try {
            let hashPassword = await bcrypt.hashSync(password, bcrypt.genSaltSync(10));
            resolve(hashPassword);
        } catch (error) {
            reject(error)
        }
    })
}
let checkUserPhone = (userPhone) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (typeof userPhone !== 'string' || !userPhone.trim() || userPhone.length > 32) {
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
const registrationError = (field, message, errCode = 2) => Object.assign(new Error(message), {
    field, fieldErrors: { [field]: message }, errCode
});
const emailCondition = email => sqlWhere(fn('LOWER', fn('TRIM', col('email'))), email);
const isRetryableTransactionError = error => [1205, 1213].includes(Number(error?.original?.errno || error?.parent?.errno));
const credentialTransaction = async (work, existingTransaction) => {
    if (existingTransaction) return work(existingTransaction);
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await db.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, work);
        } catch (error) {
            if (attempt >= 2 || !isRetryableTransactionError(error)) throw error;
        }
    }
};
const lockCredentialKeys = async (keys, transaction) => {
    for (const key of [...new Set(keys.map(value => crypto.createHash('sha256').update(value).digest('hex')))].sort()) {
        // A no-op upsert takes an exclusive InnoDB row lock until commit. Unlike
        // advisory locks, it is also released automatically on rollback/connection loss.
        await db.sequelize.query('INSERT INTO `AuthRegistrationLocks` (`key`) VALUES (:key) ON DUPLICATE KEY UPDATE `key` = VALUES(`key`)', {
            replacements: { key }, transaction
        });
    }
};
const assertEmailAvailable = async (email, transaction, exceptUserId = null) => {
    const conditions = [emailCondition(email)];
    if (exceptUserId !== null) conditions.push({ id: { [Op.ne]: exceptUserId } });
    // A locking read sees the latest committed data even when the caller already
    // started a REPEATABLE READ transaction (e.g. social onboarding).
    const matches = await db.User.findAll({ where: { [Op.and]: conditions }, attributes: ['id'],
        limit: 1, transaction, lock: transaction.LOCK.UPDATE });
    if (matches.length) throw registrationError('email', 'Email này đã được sử dụng. Hãy đăng nhập hoặc dùng email khác.', 4);
};
export const createRegisteredAccount = async (data, { transaction, allowedRoles = ['CANDIDATE', 'EMPLOYER'], companyId = null, imageUrl = '' } = {}) => {
    const errors = validateRegistration(data);
    if (Object.keys(errors).length) throw Object.assign(new Error(Object.values(errors)[0]), { errCode: errors.email ? 4 : 2, fieldErrors: errors });
    if (!allowedRoles.includes(data.roleCode)) throw registrationError('roleCode', 'Bạn không có quyền tạo tài khoản với vai trò này', 3);
    const email = normalizeEmail(data.email);
    const phonenumber = data.phonenumber.trim();
    const password = await hashUserPasswordFromBcrypt(data.password);
    return credentialTransaction(async tx => {
        await lockCredentialKeys([`email:${email}`, `phone:${phonenumber}`], tx);
        const duplicatePhone = await db.Account.findOne({ where: { phonenumber }, transaction: tx, lock: tx.LOCK.UPDATE });
        if (duplicatePhone) throw registrationError('phonenumber', 'Số điện thoại đã tồn tại !', 1);
        await assertEmailAvailable(email, tx);
        const user = await db.User.create({
            firstName: data.firstName.trim(), lastName: data.lastName.trim(), email,
            address: data.address, genderCode: data.genderCode, dob: data.dob,
            image: imageUrl, companyId
        }, { transaction: tx });
        await db.Account.create({ phonenumber, password, roleCode: data.roleCode, statusCode: 'S1', userId: user.id }, { transaction: tx });
        return user;
    }, transaction);
};
let handleCreateNewUser = async (input = {}) => {
    const data = { ...input };
    let allowedRoles = [];
    if (data.creatorRoleCode === 'ADMIN') allowedRoles = ['ADMIN', 'CANDIDATE', 'EMPLOYER', 'COMPANY'];
    else if (data.creatorRoleCode === 'COMPANY' && data.creatorCompanyId) allowedRoles = ['EMPLOYER', 'COMPANY'];
    else if (!data.creatorRoleCode) allowedRoles = ['CANDIDATE', 'EMPLOYER'];
    if (!allowedRoles.includes(data.roleCode)) return { errCode: 3, errMessage: 'Bạn không có quyền tạo tài khoản với vai trò này' };
    let companyId = null;
    if (data.creatorRoleCode === 'COMPANY') companyId = data.creatorCompanyId;
    else if (data.creatorRoleCode === 'ADMIN' && ['COMPANY', 'EMPLOYER'].includes(data.roleCode)) companyId = data.companyId || null;
    // Only authorized administrators/team managers retain generated passwords.
    // Public registration must supply its own password.
    const generatedPassword = Boolean(data.creatorRoleCode && (data.password === undefined || data.password === null || data.password === ''));
    if (generatedPassword) data.password = crypto.randomBytes(24).toString('base64url');
    try {
        const errors = validateRegistration(data);
        if (Object.keys(errors).length) return { errCode: errors.email ? 4 : 2, errMessage: Object.values(errors)[0], fieldErrors: errors };
        let imageUrl = '';
        if (data.image) {
            const uploaded = await cloudinary.uploader.upload(data.image, { upload_preset: 'dev_setups' });
            imageUrl = uploaded.url;
        }
        await createRegisteredAccount(data, { allowedRoles, companyId, imageUrl });
        if (generatedPassword) {
            await sendmail(`<h3>Tài khoản đã tạo thành công</h3><p>Tài khoản: ${data.phonenumber.trim()}</p><p>Mật khẩu: ${data.password}</p>`, normalizeEmail(data.email));
        }
        return { errCode: 0, message: 'Tạo tài khoản thành công' };
    } catch (error) {
        if (error.fieldErrors) return { errCode: error.errCode, errMessage: error.message, fieldErrors: error.fieldErrors };
        if (error.name === 'SequelizeUniqueConstraintError') return { errCode: 1, errMessage: 'Số điện thoại đã tồn tại !', fieldErrors: { phonenumber: 'Số điện thoại đã tồn tại !' } };
        throw error;
    }
};

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
                        await saveAndRevokeSessions(account)
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
let updateUserData = async (data = {}) => {
    if (!data.id) return { errCode: 2, errMessage: 'Missing required parameters' };
    const hasEmailUpdate = Object.prototype.hasOwnProperty.call(data, 'email');
    const email = hasEmailUpdate ? normalizeEmail(data.email) : null;
    if (hasEmailUpdate && !isValidRecipientEmail(email)) return { errCode: 4, errMessage: 'Email không hợp lệ hoặc không thể nhận thư' };
    try {
        return await credentialTransaction(async transaction => {
            if (hasEmailUpdate) await lockCredentialKeys([`email:${email}`], transaction);
            const account = await db.Account.findOne({ where: { userId: data.id }, raw: false, transaction, lock: transaction.LOCK.UPDATE });
            const user = await db.User.findOne({ where: { id: data.id }, raw: false, attributes: { exclude: ['userId'] }, transaction, lock: transaction.LOCK.UPDATE });
            if (!user || !account) return { errCode: 1, errMessage: 'User not found!' };
            if (data.roleCode && data.allowRoleChange && !(Array.isArray(data.allowedRoleCodes) && data.allowedRoleCodes.includes(data.roleCode))) {
                return { errCode: 3, errMessage: 'Vai trò người dùng không hợp lệ' };
            }
            if (hasEmailUpdate && email !== normalizeEmail(user.email)) await assertEmailAvailable(email, transaction, user.id);
            for (const field of ['firstName', 'lastName', 'address', 'genderCode', 'dob']) {
                if (Object.prototype.hasOwnProperty.call(data, field)) user[field] = data[field];
            }
            if (hasEmailUpdate) user.email = email;
            if (data.image) {
                const uploaded = await cloudinary.uploader.upload(data.image, { upload_preset: 'dev_setups' });
                user.image = uploaded.url;
            }
            await user.save({ transaction });
            if (data.roleCode && data.allowRoleChange) account.roleCode = data.roleCode;
            await account.save({ transaction });
            return { errCode: 0, message: 'Đã chỉnh sửa thành công', user: {
                address: user.address, companyId: user.companyId, dob: user.dob, email: user.email,
                firstName: user.firstName, genderCode: user.genderCode, id: user.id, image: user.image,
                lastName: user.lastName, roleCode: account.roleCode
            } };
        });
    } catch (error) {
        if (error.fieldErrors) return { errCode: error.errCode, errMessage: error.message, fieldErrors: error.fieldErrors };
        throw error;
    }
};
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
            if (typeof data.phonenumber !== 'string' || !data.phonenumber.trim() || data.phonenumber.length > 32) {
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
            if (!await sendmail(note, email)) {
                otpStore.clearOtp(data.phonenumber)
                resolve({ errCode: 503, errMessage: 'Chưa gửi được mã xác thực. Dịch vụ email chưa sẵn sàng, vui lòng thử lại sau hoặc liên hệ quản trị viên.' })
                return
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
            if (typeof data.phonenumber !== 'string' || !data.phonenumber.trim() || data.phonenumber.length > 32
                || !data.password || typeof data.otp !== 'string' || !data.otp || data.otp.length > 64) {
                resolve({
                    errCode: 1,
                    errMessage: 'Thiếu số điện thoại, mật khẩu mới hoặc mã xác thực'
                })
                return
            }
            const passwordError = validateNewPassword(data.password);
            if (passwordError) {
                resolve({
                    errCode: 5,
                    errMessage: passwordError, fieldErrors: { password: passwordError }
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
            await saveAndRevokeSessions(account);
            resolve({
                errCode: 0,
                errMessage: 'ok'
            })
        } catch (error) {
            reject(error)
        }
    })
}
let handleLogin = async (data = {}) => {
    const identifier = data.identifier !== undefined ? data.identifier : data.phonenumber !== undefined ? data.phonenumber : data.email;
    const invalid = { errCode: 2, errMessage: 'Email, số điện thoại hoặc mật khẩu không chính xác' };
    if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 254
        || typeof data.password !== 'string' || !data.password || Buffer.byteLength(data.password, 'utf8') > 1024) return invalid;
    const value = identifier.trim();
    let account;
    if (value.includes('@')) {
        const email = normalizeEmail(value);
        // Legacy datasets may contain duplicate emails. Do not pick the first
        // account or reveal which matches; those users can still use their phone.
        const users = await db.User.findAll({ where: emailCondition(email), attributes: ['id'], limit: 2, raw: true });
        if (users.length !== 1) return invalid;
        account = await db.Account.findOne({ where: { userId: users[0].id }, raw: true });
    } else {
        account = await db.Account.findOne({ where: { phonenumber: value }, raw: true });
    }
    if (!account || typeof account.password !== 'string' || !await bcrypt.compareSync(data.password, account.password)) return invalid;
    if (account.statusCode !== 'S1') return { errCode: 1, errMessage: 'Tài khoản của bạn đã bị khóa' };
    const user = await db.User.findOne({ attributes: { exclude: ['userId', 'file'] }, where: { id: account.userId },
        include: [{ model: db.Company, as: 'userCompanyData', attributes: ['id', 'statusCode', 'censorCode'], required: false }], raw: true, nest: true });
    if (!user) return invalid;
    user.roleCode = account.roleCode;
    user.companyStatusCode = user.userCompanyData?.statusCode || null;
    user.companyCensorCode = user.userCompanyData?.censorCode || null;
    delete user.userCompanyData;
    return { errCode: 0, errMessage: 'Ok', user, token: CommonUtils.encodeToken(user.id, account.roleCode, user.companyId ?? null) };
};
let handleChangePassword = (data) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data.id || !data.password || !data.oldpassword) {
                resolve({
                    errCode: 1,
                    errMessage: 'Missing required parameter!'
                })
            } else {
                const passwordError = validateNewPassword(data.password);
                if (passwordError) return resolve({ errCode: 5, errMessage: passwordError, fieldErrors: { password: passwordError } });
                if (typeof data.oldpassword !== 'string' || Buffer.byteLength(data.oldpassword, 'utf8') > 1024) return resolve({ errCode: 2, errMessage: 'Mật khẩu cũ không chính xác' });
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
                    const expectedPasswordHash = account.password;
                    account.password = await hashUserPasswordFromBcrypt(data.password);
                    try { await saveAndRevokeSessions(account, expectedPasswordHash); }
                    catch (error) {
                        if (error.message === 'CREDENTIALS_CHANGED') return resolve({ errCode: 2, errMessage: 'Mật khẩu đã thay đổi. Vui lòng đăng nhập lại.' });
                        throw error;
                    }
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
    createRegisteredAccount,
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
