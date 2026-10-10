const schedule = require('node-schedule');
import e from "express";
import db from "../models/index";
import getStringMailTemplate from "./mailTemplate";
const { Op } = require("sequelize");
const nodemailer = require('nodemailer');
const { createSkillMatcher, prepareSkillText } = require('./skillMatch');
// SQL LIKE chi loc so bo ("%C%" cua ky nang "C" khop moi tin), nen lay mot nhom
// tin ngau nhien roi so khop ky nang lai bang cung quy tac voi cham diem CV.
const SUGGESTION_LIMIT = 5
const SUGGESTION_POOL = 50
// node-schedule: lap lich tac vu dinh ky trong tien trinh Node (tuong tu cron).
// RecurrenceRule duoi day chay 08:00 moi ngay theo mui gio UTC+7 ('Asia/Vientiane'
// cung lech gio voi Viet Nam): gui email goi y viec lam (sendJobMail) va cap lai 5 luot
// xem CV mien phi cho moi cong ty (updateFreeViewCv). Cu 10 phut doi soat giao dich
// PayPal dang cho (PAYMENT_RECONCILE_RULE, cu phap cron). Launcher local tat cac lich
// nay (SCHEDULED_JOBS_ENABLED=false) de khong gui email that khi phat trien.
let rule = new schedule.RecurrenceRule();
rule.dayOfWeek = [0, 1, 2, 3, 4, 5, 6]
rule.hour = 8
rule.minute = 0
rule.second = 0
rule.tz = 'Asia/Vientiane'
let myRuleSecond = '*/10 * * * * *' // 10 is 10s

let sendmail = async (mailTemplate, userMail) => {
    var transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_APP,
            pass: process.env.EMAIL_APP_PASSWORD,
        }
    });

    var mailOptions = {
        from: process.env.EMAIL_APP,
        to: userMail,
        subject: 'Gợi ý việc làm cho bạn',
        html: mailTemplate
    };


    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error)
        }
    });
}

let getTemplateMail = async (infoUser) => {
    try {
        const timeStampOfMonthAgo = 2592000000
        let listpost = await db.Post.findAll({
            limit: SUGGESTION_POOL,
            // offset: 0,
            where: {
                timePost: {
                    [Op.gte] : new Date().getTime() - timeStampOfMonthAgo,
                },
                statusCode: 'PS1',
                [Op.and]: [
                    // Chi goi y tin con han nop ho so, cung dieu kien voi trang tim viec.
                    db.Sequelize.where(db.Sequelize.cast(db.sequelize.col('Post.timeEnd'), 'SIGNED'), {
                        [Op.gt]: Date.now()
                    }),
                    db.Sequelize.where(db.sequelize.col('postDetailData.jobTypePostData.code'), {
                        [Op.like]: `%${infoUser.categoryJobCode}%`
                    }),
                    // db.Sequelize.where(db.sequelize.col('postDetailData.provincePostData.code'), {
                    //     [Op.like]: `%${infoUser.addressCode}%`
                    // }),
                    // db.Sequelize.where(db.sequelize.col('postDetailData.salaryTypePostData.code'), {
                    //     [Op.like]: `%${infoUser.salaryJobCode}%`
                    // }),
                    // db.Sequelize.where(db.sequelize.col('postDetailData.expTypePostData.code'), {
                    //     [Op.like]: `%${infoUser.experienceJobCode}%`
                    // }),
                    db.Sequelize.where(db.sequelize.col('postDetailData.descriptionHTML'), {
                        [Op.or]: infoUser.listSkills
                    }),
                ],
            },
            include: [
                {
                    model: db.DetailPost, as: 'postDetailData', attributes: {
                        exclude: ['statusCode']
                    },
                    include: [
                        { model: db.Allcode, as: 'jobTypePostData', attributes: ['value', 'code'] },
                        { model: db.Allcode, as: 'workTypePostData', attributes: ['value', 'code'] },
                        { model: db.Allcode, as: 'salaryTypePostData', attributes: ['value', 'code'] },
                        { model: db.Allcode, as: 'jobLevelPostData', attributes: ['value', 'code'] },
                        { model: db.Allcode, as: 'genderPostData', attributes: ['value', 'code'] },
                        { model: db.Allcode, as: 'provincePostData', attributes: ['value', 'code'] },
                        { model: db.Allcode, as: 'expTypePostData', attributes: ['value', 'code'] }
                    ],
                },
            ],
            order:  db.sequelize.literal('rand()'),
            raw: true,
            nest: true,
        })
        let postsWithCompany = []
        for (let post of listpost || []) {
            if (postsWithCompany.length >= SUGGESTION_LIMIT) break
            const description = prepareSkillText(post.postDetailData?.descriptionHTML)
            if (!infoUser.skillMatchers.some((matcher) => matcher.matches(description))) continue
            let user = await db.User.findOne({
                where: { id: post.userId },
                attributes: {
                    exclude: ['userId']
                }
            })
            // Nguoi dang da bi xoa hoac roi cong ty: bo qua rieng tin do, khong
            // de mot tin loi lam mat ca email goi y cua ung vien.
            if (!user || !user.companyId) continue
            let company = await db.Company.findOne({
                where: { id: user.companyId }
            })
            if (!company) continue
            post.companyData = company
            postsWithCompany.push(post)
        }
        if (postsWithCompany.length > 0) {
            return getStringMailTemplate(postsWithCompany, infoUser)
        }
        else {
            return 0
        }


    } catch (error) {
        console.log(error)
        return 0
    }
}

const sendJobMail = () => {
    schedule.scheduleJob(rule, async function () {
        try {
            let listUserGetMail = await db.UserSetting.findAll({
                where: {
                    isTakeMail: 1
                },
                include: [
                    {
                        model: db.User, as: 'userSettingData',
                        attributes: ['id', 'firstName', 'lastName', 'image', 'email']
                    }
                ],
                raw: true,
                nest: true
            })
            for (let user of listUserGetMail) {
                let listSkills = await db.UserSkill.findAll({
                    where: {userId: user.userId},
                    include: db.Skill,
                    raw: true,
                    nest: true
                })
                const skillNames = listSkills.map(item => item.Skill?.name).filter(name => createSkillMatcher(name))
                // Chua khai bao ky nang thi khong co co so de goi y: Op.or rong khien
                // Sequelize bo han dieu kien ky nang va gui tin ngau nhien cua ca nganh.
                if (!skillNames.length) continue
                user.listSkills = skillNames.map(name => ({ [Op.like]: `%${name}%` }))
                user.skillMatchers = skillNames.map(createSkillMatcher)
                let mailTemplate = await getTemplateMail(user)
                if (mailTemplate !== 0) {
                        sendmail(mailTemplate, user.userSettingData.email)
                    }
                }
        } catch (error) {
            console.log(error)
        }
        console.log('đã gửi')
    });

}

const updateFreeViewCv = () => {
    schedule.scheduleJob(rule, async function () {
        try {
            await db.Company.update(
                {
                    allowCvFree: 5
                },
                {
                    where: {
                        id: {
                            [Op.ne]: null
                        }
                    },
                    silent: true
                },
            )
            console.log('update free view CV thành công')
        }
        catch (err) {
            console.log(err)
        }
    });
}


// Moi 10 phut doi soat cac giao dich PayPal da qua han nhung van PENDING (xem
// paymentIntegrityService.reconcileStalePayments). Bo qua neu luot truoc chua xong,
// va khong len lich khi chua cau hinh PayPal (moi lan tra cuu se that bai).
const PAYMENT_RECONCILE_RULE = '*/10 * * * *'
let paymentReconcileRunning = false

const runPaymentReconciliation = async () => {
    if (paymentReconcileRunning) return null
    paymentReconcileRunning = true
    try {
        return await require('../services/paymentIntegrityService').reconcileStalePayments()
    } catch (err) {
        console.error('Payment reconciliation failed:', err.message)
        return null
    } finally {
        paymentReconcileRunning = false
    }
}

const reconcilePayments = () => {
    if (!(process.env.PAYPAL_CLIENT_ID || process.env.CLIENT_ID)) return null
    return schedule.scheduleJob(PAYMENT_RECONCILE_RULE, runPaymentReconciliation)
}

module.exports = {
    sendJobMail,
    updateFreeViewCv,
    reconcilePayments,
    runPaymentReconciliation
}