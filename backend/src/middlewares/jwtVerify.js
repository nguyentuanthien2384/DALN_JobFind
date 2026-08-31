const jwt = require('jsonwebtoken')
import db from "../models/index";
require('dotenv').config();
const secretString = process.env.JWT_SECRET

const isActiveAccount = (user) => (
    user && user.userAccountData && user.userAccountData.statusCode === 'S1'
)

const sendInactiveAccount = (res) => res.status(403).json({
    status: false,
    errMessage: 'Account is not active',
    refresh: true,
})

const sendAuthenticationFailure = (res) => res.status(500).json({
    status: false,
    errMessage: 'Unable to verify account',
})

const middlewareControllers = {
    verifyTokenUser: (req, res, next) => {
        const token = req.headers.authorization
        if (token) {
            const accessToken = token.split(' ')[1]
            jwt.verify(accessToken, secretString, async (err, payload) => {
                if (err) {
                    return res.status(403).json({
                        status: false,
                        errMessage: 'Token is not valid!',
                        refresh: true,
                    })
                }
                try {
                    const user = await db.User.findOne({
                        where: { id: payload.sub } ,
                        attributes: ['id', 'companyId'],
                        include: [
                            { model: db.Account, as: 'userAccountData', attributes: ['roleCode', 'statusCode'] }
                        ],
                        raw: true,
                        nest: true
                    })
                    if (!user) {
                        return res.status(404).json({
                            status: false,
                            errMessage: 'User is not exits',
                            refresh: true,
                        })
                    }
                    if (!isActiveAccount(user)) return sendInactiveAccount(res)

                    req.user = user
                    next()
                } catch (error) {
                    return sendAuthenticationFailure(res)
                }
            })
        } else {
            return res.status(401).json({
                status: false,
                message: "You're not authentication!",
                refresh: true,
            })
        }
    },
    // Dung cho route vua phuc vu khach vang lai vua phuc vu nguoi da dang nhap
    // (vi du tu dang ky vs admin tao tai khoan ho). Khong co token, hoac token
    // hong, thi van cho di tiep nhung req.user de trong.
    verifyTokenOptional: (req, res, next) => {
        const token = req.headers.authorization
        if (!token) return next()

        const accessToken = token.split(' ')[1]
        if (!accessToken) return next()

        jwt.verify(accessToken, secretString, async (err, payload) => {
            if (err) return next()
            try {
                const user = await db.User.findOne({
                    where: { id: payload.sub },
                    attributes: ['id', 'companyId'],
                    include: [
                        { model: db.Account, as: 'userAccountData', attributes: ['roleCode', 'statusCode'] }
                    ],
                    raw: true,
                    nest: true
                })
                if (isActiveAccount(user)) req.user = user
            } catch (error) {
                // Token khong doc duoc thi coi nhu khach vang lai, khong chan request.
            }
            next()
        })
    },
    verifyTokenAdmin: (req, res, next) => {
        const token = req.headers.authorization
        if (token) {
            const accessToken = token.split(' ')[1]
            jwt.verify(accessToken, secretString, async (err, payload) => {
                if (err) {
                    return res.status(403).json({
                        status: false,
                        errMessage: 'Token is not valid!',
                        refresh: true,
                    })
                }
                try {
                    const user = await db.User.findOne(
                        {
                            where: { id: payload.sub },
                            attributes: {
                                exclude: ['userId']
                            },
                            include: [
                                { model: db.Account, as: 'userAccountData' }
                            ],
                            raw: true,
                            nest: true
                        }
                    )
                    if (!user) {
                        return res.status(404).json({
                            status: false,
                            errMessage: 'User is not exits',
                            refresh: true,
                        })
                    }
                    if (!isActiveAccount(user)) return sendInactiveAccount(res)
                    if (user.userAccountData.roleCode !== 'ADMIN') {
                        return res.status(403).json({
                            status: false,
                            errMessage: 'Permission denied',
                            refresh: true,
                        })
                    }
                    req.user = user
                    next()
                } catch (error) {
                    return sendAuthenticationFailure(res)
                }
            })
        } else {
            return res.status(401).json({
                status: false,
                errMessage: "You're not authentication!",
                refresh: true,
            })
        }
    },
}

module.exports = middlewareControllers
