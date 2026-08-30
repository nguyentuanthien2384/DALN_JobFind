import express from "express";
import userController from '../controllers/userController';
import allcodeController from '../controllers/allcodeController';
import companyController from '../controllers/companyController';
import postController from '../controllers/postController';
import cvController from '../controllers/cvController'
import packageController from '../controllers/packagePostController'
import packageCvController from '../controllers/packageCvController'
import favoritePostController from '../controllers/favoritePostController'
import companyReviewController from '../controllers/companyReviewController'
import followCompanyController from '../controllers/followCompanyController'
import notificationController from '../controllers/notificationController'
import chatController from '../controllers/chatController'

import middlewareControllers from '../middlewares/jwtVerify'
import { loginLimiter, otpLimiter, registerLimiter, phoneCheckLimiter } from '../middlewares/rateLimit'
import { emitNotification } from '../config/socket'
let router = express.Router();

let initWebRoutes = (app) => {

    //=====================API USER==========================//
    // Tao tai khoan: co the goi khi chua dang nhap (tu dang ky) hoac boi admin.
    // verifyTokenOptional gan req.user neu co token hop le de controller biet
    // nguoi goi co phai admin khong (chi admin moi duoc chon quyen ADMIN).
    router.post('/api/create-new-user', registerLimiter, middlewareControllers.verifyTokenOptional, userController.handleCreateNewUser)
    router.put('/api/update-user', middlewareControllers.verifyTokenUser, userController.handleUpdateUser)
    router.post('/api/ban-user', middlewareControllers.verifyTokenAdmin ,userController.handleBanUser)
    router.post('/api/unban-user', middlewareControllers.verifyTokenAdmin ,userController.handleUnbanUser)
    router.post('/api/login', loginLimiter, userController.handleLogin)
    router.post('/api/changepassword', middlewareControllers.verifyTokenUser,userController.handleChangePassword)
    router.get('/api/get-all-user', middlewareControllers.verifyTokenAdmin,userController.getAllUser)
    router.get('/api/get-detail-user-by-id', middlewareControllers.verifyTokenUser,userController.getDetailUserById)
    router.get('/api/check-phonenumber-user', phoneCheckLimiter, userController.checkUserPhone)
    router.post('/api/request-reset-password-otp', otpLimiter, userController.requestResetPasswordOtp)
    router.post('/api/changepasswordbyPhone', otpLimiter, userController.changePaswordByPhone)
    router.put('/api/setDataUserSetting', middlewareControllers.verifyTokenUser, userController.setDataUserSetting)

    //===================API ALLCODE========================//
    router.post('/api/create-new-all-code',middlewareControllers.verifyTokenAdmin ,allcodeController.handleCreateNewAllCode)
    router.put('/api/update-all-code', middlewareControllers.verifyTokenAdmin,allcodeController.handleUpdateAllCode)
    router.delete('/api/delete-all-code', middlewareControllers.verifyTokenAdmin,allcodeController.handleDeleteAllCode)
    router.get('/api/get-all-code', allcodeController.getAllCodeService)
    router.get('/api/get-list-allcode', allcodeController.getListAllCodeService)
    router.get('/api/get-detail-all-code-by-code', allcodeController.getDetailAllcodeByCode)
    router.get('/api/get-list-job-count-post', allcodeController.getListJobTypeAndCountPost)
    router.post('/api/create-new-skill',middlewareControllers.verifyTokenAdmin ,allcodeController.handleCreateNewSkill)
    router.delete('/api/delete-skill',middlewareControllers.verifyTokenAdmin ,allcodeController.handleDeleteSkill)
    router.get('/api/get-all-skill-by-job-code', allcodeController.getAllSkillByJobCode)
    router.get('/api/get-list-skill', allcodeController.getListSkill)
    router.put('/api/update-skill', middlewareControllers.verifyTokenAdmin,allcodeController.handleUpdateSkill)
    router.get('/api/get-detail-skill-by-id',middlewareControllers.verifyTokenAdmin ,allcodeController.getDetailSkillById)


    //==================API COMPANY=========================//
    router.post('/api/create-new-company', middlewareControllers.verifyTokenUser,companyController.handleCreateNewCompany)
    router.put('/api/update-company', middlewareControllers.verifyTokenUser,companyController.handleUpdateCompany)
    router.put('/api/ban-company', middlewareControllers.verifyTokenAdmin ,companyController.handleBanCompany)
    router.put('/api/unban-company', middlewareControllers.verifyTokenAdmin ,companyController.handleUnBanCompany)
    router.put('/api/add-user-company', middlewareControllers.verifyTokenUser,companyController.handleAddUserCompany)
    router.get('/api/get-list-company', companyController.getListCompany)
    router.get('/api/get-detail-company-by-id', companyController.getDetailCompanyById)
    router.get('/api/get-detail-company-by-userId',companyController.getDetailCompanyByUserId)
    router.get('/api/get-all-user-by-companyId', middlewareControllers.verifyTokenUser,companyController.getAllUserByCompanyId)
    router.put('/api/quit-company', middlewareControllers.verifyTokenUser,companyController.handleQuitCompany)
    router.get('/api/get-all-company', middlewareControllers.verifyTokenAdmin ,companyController.getAllCompanyByAdmin)
    router.put('/api/accecpt-company', middlewareControllers.verifyTokenAdmin ,companyController.handleAccecptCompany)
    //==================API CV==========================//
    router.post('/api/create-new-cv', middlewareControllers.verifyTokenUser,cvController.handleCreateNewCV)
    router.get('/api/get-all-list-cv-by-post', middlewareControllers.verifyTokenUser,cvController.getAllListCvByPost)
    router.get('/api/get-detail-cv-by-id', middlewareControllers.verifyTokenUser,cvController.getDetailCvById)
    router.get('/api/get-all-cv-by-userId', middlewareControllers.verifyTokenUser,cvController.getAllCvByUserId)
    router.get('/api/get-statistical-cv', middlewareControllers.verifyTokenUser,cvController.getStatisticalCv)
    router.get('/api/fillter-cv-by-selection', middlewareControllers.verifyTokenUser, cvController.fillterCVBySelection)
    router.get('/api/check-see-candiate', middlewareControllers.verifyTokenUser,cvController.checkSeeCandiate)    
    //==================API POST==========================//
    router.post('/api/create-new-post', middlewareControllers.verifyTokenUser,postController.handleCreateNewPost)
    router.post('/api/create-reup-post', middlewareControllers.verifyTokenUser,postController.handleReupPost)
    router.put('/api/update-post', middlewareControllers.verifyTokenUser,postController.handleUpdatePost)
    router.put('/api/active-post', middlewareControllers.verifyTokenAdmin ,postController.handleActivePost)
    router.put('/api/ban-post', middlewareControllers.verifyTokenAdmin ,postController.handleBanPost)
    router.put('/api/accept-post', middlewareControllers.verifyTokenAdmin ,postController.handleAcceptPost)
    router.get('/api/get-list-post-admin', middlewareControllers.verifyTokenUser,postController.getListPostByAdmin)
    router.get('/api/get-all-post-admin', middlewareControllers.verifyTokenAdmin,postController.getAllPostByAdmin)
    router.get('/api/get-detail-post-by-id', postController.getDetailPostById)
    router.get('/api/get-filter-post', postController.getFilterPost)
    router.get('/api/get-related-post', postController.getRelatedPost)
    router.get('/api/get-recommended-post', middlewareControllers.verifyTokenUser,postController.getRecommendedPost)
    router.get('/api/get-statistical-post', middlewareControllers.verifyTokenUser,postController.getStatisticalTypePost)
    router.get('/api/get-note-by-post', middlewareControllers.verifyTokenUser,postController.getListNoteByPost)
    //==================API PACKAGE==========================//
    router.get('/api/get-package-by-type', middlewareControllers.verifyTokenUser,packageController.getPackageByType)
    router.get('/api/get-package-by-id', middlewareControllers.verifyTokenUser,packageController.getPackageById)
    router.get('/api/get-payment-link', middlewareControllers.verifyTokenUser,packageController.getPaymentLink)
    router.get('/api/get-all-package',middlewareControllers.verifyTokenUser,packageController.getAllPackage)
    router.post('/api/payment-success',middlewareControllers.verifyTokenUser  ,packageController.paymentOrderSuccess)
    router.put('/api/set-active-package-post', middlewareControllers.verifyTokenAdmin ,packageController.setActiveTypePackage)
    router.post('/api/create-package-post', middlewareControllers.verifyTokenAdmin ,packageController.creatNewPackagePost)
    router.put('/api/update-package-post',middlewareControllers.verifyTokenAdmin , packageController.updatePackagePost)
    router.get('/api/get-statistical-package',middlewareControllers.verifyTokenAdmin ,packageController.getStatisticalPackage)
    router.get('/api/get-history-trade-post',middlewareControllers.verifyTokenUser,packageController.getHistoryTrade)
    router.get('/api/get-sum-by-year-post',middlewareControllers.verifyTokenAdmin,packageController.getSumByYear)

    
    //==================API PACKAGE CV==========================//
    router.get('/api/get-package-cv-by-id', middlewareControllers.verifyTokenUser,packageCvController.getPackageById)
    router.get('/api/get-payment-cv-link', middlewareControllers.verifyTokenUser,packageCvController.getPaymentLink)
    router.get('/api/get-all-package-cv',middlewareControllers.verifyTokenUser,packageCvController.getAllPackage)
    router.post('/api/payment-cv-success',middlewareControllers.verifyTokenUser  ,packageCvController.paymentOrderSuccess)
    router.put('/api/set-active-package-cv', middlewareControllers.verifyTokenAdmin ,packageCvController.setActiveTypePackage)
    router.post('/api/create-package-cv', middlewareControllers.verifyTokenAdmin ,packageCvController.creatNewPackageCv)
    router.put('/api/update-package-cv',middlewareControllers.verifyTokenAdmin , packageCvController.updatePackageCv)
    router.get('/api/get-statistical-package-cv',middlewareControllers.verifyTokenAdmin ,packageCvController.getStatisticalPackageCv)
    router.get('/api/get-all-package-cv-select',middlewareControllers.verifyTokenUser,packageCvController.getAllToSelect)
    router.get('/api/get-history-trade-cv',middlewareControllers.verifyTokenUser,packageCvController.getHistoryTrade)
    router.get('/api/get-sum-by-year-cv',middlewareControllers.verifyTokenAdmin,packageCvController.getSumByYear)


    //==================API FAVORITE POST (LUU TIN)==========================//
    router.post('/api/toggle-favorite-post', middlewareControllers.verifyTokenUser, favoritePostController.handleToggleFavoritePost)
    router.get('/api/check-favorite-post', favoritePostController.checkFavoriteByUser)
    router.get('/api/get-favorite-post-by-user', middlewareControllers.verifyTokenUser, favoritePostController.getFavoritePostByUser)

    //==================API COMPANY REVIEW (DANH GIA CONG TY)================//
    router.post('/api/create-company-review', middlewareControllers.verifyTokenUser, companyReviewController.handleCreateReview)
    router.get('/api/get-review-by-company', companyReviewController.getReviewByCompany)
    router.post('/api/delete-company-review', middlewareControllers.verifyTokenUser, companyReviewController.handleDeleteReview)

    //==================API FOLLOW COMPANY (THEO DOI CONG TY)================//
    router.post('/api/toggle-follow-company', middlewareControllers.verifyTokenUser, followCompanyController.handleToggleFollowCompany)
    router.get('/api/check-follow-company', followCompanyController.checkFollowCompany)
    router.get('/api/get-followed-company-by-user', middlewareControllers.verifyTokenUser, followCompanyController.getFollowedCompanyByUser)

    //==================API NOTIFICATION (THONG BAO)=========================//
    router.get('/api/get-notification-by-user', middlewareControllers.verifyTokenUser, notificationController.getNotificationByUser)
    router.post('/api/mark-read-notification', middlewareControllers.verifyTokenUser, notificationController.handleMarkReadNotification)

    //==================API CHAT (NHAN TIN)==================================//
    router.post('/api/send-chat-message', middlewareControllers.verifyTokenUser, chatController.handleSendMessage)
    router.get('/api/get-chat-conversation', middlewareControllers.verifyTokenUser, chatController.getConversation)
    router.get('/api/get-list-chat-conversation', middlewareControllers.verifyTokenUser, chatController.getListConversation)

    //==================NOI BO: cho Notification Service goi==================//
    // Notification Service (chay trong Docker) khong giu ket noi Socket.IO voi
    // trinh duyet - backend nay moi giu. Nen no nho day ho qua endpoint nay.
    //
    // Chan bang mot khoa bi mat dung chung thay vi JWT: day la giao tiep giua hai
    // may chu, khong co nguoi dung nao dang nhap o giua. Neu chua dat khoa thi tu
    // dong tu choi, tranh viec quen cau hinh lai thanh mot cua sau mo toang.
    router.post('/internal/emit-notification', (req, res) => {
        const secret = process.env.INTERNAL_SECRET
        if (!secret || req.headers['x-internal-secret'] !== secret) {
            return res.status(403).json({ errCode: 403, errMessage: 'Forbidden' })
        }
        const { userId, notification } = req.body || {}
        if (!userId || !notification) {
            return res.status(400).json({ errCode: 1, errMessage: 'Thiếu userId hoặc notification' })
        }
        emitNotification(userId, notification)
        return res.json({ errCode: 0 })
    })

    return app.use("/", router);
}

module.exports = initWebRoutes;
