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
import { authorize, PERMISSIONS } from '../middlewares/authorize'
import { loginLimiter, otpLimiter, registerLimiter, phoneCheckLimiter } from '../middlewares/rateLimit'
import { emitNotification } from '../config/socket'
let router = express.Router();

// Keep authentication and authorization visibly paired on every private route.
// The role is reloaded from the database by verifyTokenUser, so changing or
// disabling an account takes effect immediately without waiting for JWT expiry.
const protectedBy = (permission) => [
    middlewareControllers.verifyTokenUser,
    authorize(permission)
];

let initWebRoutes = (app) => {

    //=====================API USER==========================//
    // Tao tai khoan: co the goi khi chua dang nhap (tu dang ky) hoac boi admin.
    // verifyTokenOptional gan req.user neu co token hop le de controller biet
    // nguoi goi co phai admin khong (chi admin moi duoc chon quyen ADMIN).
    router.post('/api/create-new-user', registerLimiter, middlewareControllers.verifyTokenOptional, userController.handleCreateNewUser)
    router.get('/api/auth/me', ...protectedBy(PERMISSIONS.ACCOUNT_SELF), userController.getCurrentAuthorization)
    router.put('/api/update-user', ...protectedBy(PERMISSIONS.ACCOUNT_SELF), userController.handleUpdateUser)
    router.post('/api/ban-user', ...protectedBy(PERMISSIONS.ADMINISTRATION), userController.handleBanUser)
    router.post('/api/unban-user', ...protectedBy(PERMISSIONS.ADMINISTRATION), userController.handleUnbanUser)
    router.post('/api/login', loginLimiter, userController.handleLogin)
    router.post('/api/changepassword', ...protectedBy(PERMISSIONS.ACCOUNT_SELF), userController.handleChangePassword)
    router.get('/api/get-all-user', ...protectedBy(PERMISSIONS.ADMINISTRATION), userController.getAllUser)
    router.get('/api/get-detail-user-by-id', ...protectedBy(PERMISSIONS.CANDIDATE_PROFILE_READ), userController.getDetailUserById)
    router.get('/api/check-phonenumber-user', phoneCheckLimiter, userController.checkUserPhone)
    router.post('/api/request-reset-password-otp', otpLimiter, userController.requestResetPasswordOtp)
    router.post('/api/changepasswordbyPhone', otpLimiter, userController.changePaswordByPhone)
    router.put('/api/setDataUserSetting', ...protectedBy(PERMISSIONS.ACCOUNT_SELF), userController.setDataUserSetting)

    //===================API ALLCODE========================//
    router.post('/api/create-new-all-code', ...protectedBy(PERMISSIONS.ADMINISTRATION), allcodeController.handleCreateNewAllCode)
    router.put('/api/update-all-code', ...protectedBy(PERMISSIONS.ADMINISTRATION), allcodeController.handleUpdateAllCode)
    router.delete('/api/delete-all-code', ...protectedBy(PERMISSIONS.ADMINISTRATION), allcodeController.handleDeleteAllCode)
    router.get('/api/get-all-code', allcodeController.getAllCodeService)
    router.get('/api/get-list-allcode', allcodeController.getListAllCodeService)
    router.get('/api/get-detail-all-code-by-code', allcodeController.getDetailAllcodeByCode)
    router.get('/api/get-list-job-count-post', allcodeController.getListJobTypeAndCountPost)
    router.post('/api/create-new-skill', ...protectedBy(PERMISSIONS.ADMINISTRATION), allcodeController.handleCreateNewSkill)
    router.delete('/api/delete-skill', ...protectedBy(PERMISSIONS.ADMINISTRATION), allcodeController.handleDeleteSkill)
    router.get('/api/get-all-skill-by-job-code', allcodeController.getAllSkillByJobCode)
    router.get('/api/get-list-skill', allcodeController.getListSkill)
    router.put('/api/update-skill', ...protectedBy(PERMISSIONS.ADMINISTRATION), allcodeController.handleUpdateSkill)
    router.get('/api/get-detail-skill-by-id', ...protectedBy(PERMISSIONS.ADMINISTRATION), allcodeController.getDetailSkillById)


    //==================API COMPANY=========================//
    router.post('/api/create-new-company', ...protectedBy(PERMISSIONS.COMPANY_CREATE), companyController.handleCreateNewCompany)
    router.put('/api/update-company', ...protectedBy(PERMISSIONS.COMPANY_MANAGE), companyController.handleUpdateCompany)
    router.put('/api/ban-company', ...protectedBy(PERMISSIONS.ADMINISTRATION), companyController.handleBanCompany)
    router.put('/api/unban-company', ...protectedBy(PERMISSIONS.ADMINISTRATION), companyController.handleUnBanCompany)
    router.put('/api/add-user-company', ...protectedBy(PERMISSIONS.COMPANY_TEAM_MANAGE), companyController.handleAddUserCompany)
    router.get('/api/get-list-company', companyController.getListCompany)
    router.get('/api/get-detail-company-by-id', companyController.getDetailCompanyById)
    router.get('/api/get-detail-company-by-userId', ...protectedBy(PERMISSIONS.COMPANY_PRIVATE_READ), companyController.getDetailCompanyByUserId)
    router.get('/api/get-all-user-by-companyId', ...protectedBy(PERMISSIONS.COMPANY_TEAM_MANAGE), companyController.getAllUserByCompanyId)
    router.put('/api/quit-company', ...protectedBy(PERMISSIONS.COMPANY_TEAM_EXIT), companyController.handleQuitCompany)
    router.get('/api/get-all-company', ...protectedBy(PERMISSIONS.ADMINISTRATION), companyController.getAllCompanyByAdmin)
    router.put('/api/accecpt-company', ...protectedBy(PERMISSIONS.ADMINISTRATION), companyController.handleAccecptCompany)
    //==================API CV==========================//
    router.post('/api/create-new-cv', ...protectedBy(PERMISSIONS.CANDIDATE_APPLY), cvController.handleCreateNewCV)
    router.get('/api/get-all-list-cv-by-post', ...protectedBy(PERMISSIONS.RECRUITMENT_READ), cvController.getAllListCvByPost)
    router.get('/api/get-detail-cv-by-id', ...protectedBy(PERMISSIONS.CANDIDATE_PROFILE_READ), cvController.getDetailCvById)
    router.get('/api/get-all-cv-by-userId', ...protectedBy(PERMISSIONS.CANDIDATE_PROFILE_READ), cvController.getAllCvByUserId)
    router.get('/api/get-statistical-cv', ...protectedBy(PERMISSIONS.RECRUITMENT_REPORT_READ), cvController.getStatisticalCv)
    router.get('/api/fillter-cv-by-selection', ...protectedBy(PERMISSIONS.CANDIDATE_SEARCH), cvController.fillterCVBySelection)
    router.get('/api/check-see-candiate', ...protectedBy(PERMISSIONS.CANDIDATE_SEARCH), cvController.checkSeeCandiate)
    //==================API POST==========================//
    router.post('/api/create-new-post', ...protectedBy(PERMISSIONS.JOB_MANAGE), postController.handleCreateNewPost)
    router.post('/api/create-reup-post', ...protectedBy(PERMISSIONS.JOB_MANAGE), postController.handleReupPost)
    router.put('/api/update-post', ...protectedBy(PERMISSIONS.JOB_MANAGE), postController.handleUpdatePost)
    router.put('/api/active-post', ...protectedBy(PERMISSIONS.ADMINISTRATION), postController.handleActivePost)
    router.put('/api/ban-post', ...protectedBy(PERMISSIONS.ADMINISTRATION), postController.handleBanPost)
    router.put('/api/accept-post', ...protectedBy(PERMISSIONS.ADMINISTRATION), postController.handleAcceptPost)
    router.get('/api/get-list-post-admin', ...protectedBy(PERMISSIONS.RECRUITMENT_READ), postController.getListPostByAdmin)
    router.get('/api/get-all-post-admin', ...protectedBy(PERMISSIONS.ADMINISTRATION), postController.getAllPostByAdmin)
    // Khach chi xem duoc tin da duyet; admin/nha tuyen dung cung cong ty co the
    // xem tin dang cho duyet. Controller quyet dinh scope tu danh tinh optional.
    router.get('/api/get-detail-post-by-id', middlewareControllers.verifyTokenOptional, postController.getDetailPostById)
    router.get('/api/get-filter-post', postController.getFilterPost)
    router.get('/api/get-related-post', postController.getRelatedPost)
    router.get('/api/get-recommended-post', ...protectedBy(PERMISSIONS.RECOMMENDATION_READ), postController.getRecommendedPost)
    router.get('/api/get-statistical-post', ...protectedBy(PERMISSIONS.RECRUITMENT_REPORT_READ), postController.getStatisticalTypePost)
    router.get('/api/get-note-by-post', ...protectedBy(PERMISSIONS.RECRUITMENT_READ), postController.getListNoteByPost)
    //==================API PACKAGE==========================//
    router.get('/api/get-package-by-type', ...protectedBy(PERMISSIONS.PACKAGE_CATALOG_READ), packageController.getPackageByType)
    router.get('/api/get-package-by-id', ...protectedBy(PERMISSIONS.PACKAGE_CATALOG_READ), packageController.getPackageById)
    router.get('/api/get-payment-link', ...protectedBy(PERMISSIONS.PACKAGE_PURCHASE), packageController.getPaymentLink)
    router.get('/api/get-all-package', ...protectedBy(PERMISSIONS.PACKAGE_CATALOG_READ), packageController.getAllPackage)
    router.post('/api/payment-success', ...protectedBy(PERMISSIONS.PACKAGE_PURCHASE), packageController.paymentOrderSuccess)
    router.put('/api/set-active-package-post', ...protectedBy(PERMISSIONS.ADMINISTRATION), packageController.setActiveTypePackage)
    router.post('/api/create-package-post', ...protectedBy(PERMISSIONS.ADMINISTRATION), packageController.creatNewPackagePost)
    router.put('/api/update-package-post', ...protectedBy(PERMISSIONS.ADMINISTRATION), packageController.updatePackagePost)
    router.get('/api/get-statistical-package', ...protectedBy(PERMISSIONS.ADMINISTRATION), packageController.getStatisticalPackage)
    router.get('/api/get-history-trade-post', ...protectedBy(PERMISSIONS.PACKAGE_HISTORY_READ), packageController.getHistoryTrade)
    router.get('/api/get-sum-by-year-post', ...protectedBy(PERMISSIONS.ADMINISTRATION), packageController.getSumByYear)

    
    //==================API PACKAGE CV==========================//
    router.get('/api/get-package-cv-by-id', ...protectedBy(PERMISSIONS.PACKAGE_CATALOG_READ), packageCvController.getPackageById)
    router.get('/api/get-payment-cv-link', ...protectedBy(PERMISSIONS.PACKAGE_PURCHASE), packageCvController.getPaymentLink)
    router.get('/api/get-all-package-cv', ...protectedBy(PERMISSIONS.PACKAGE_CATALOG_READ), packageCvController.getAllPackage)
    router.post('/api/payment-cv-success', ...protectedBy(PERMISSIONS.PACKAGE_PURCHASE), packageCvController.paymentOrderSuccess)
    router.put('/api/set-active-package-cv', ...protectedBy(PERMISSIONS.ADMINISTRATION), packageCvController.setActiveTypePackage)
    router.post('/api/create-package-cv', ...protectedBy(PERMISSIONS.ADMINISTRATION), packageCvController.creatNewPackageCv)
    router.put('/api/update-package-cv', ...protectedBy(PERMISSIONS.ADMINISTRATION), packageCvController.updatePackageCv)
    router.get('/api/get-statistical-package-cv', ...protectedBy(PERMISSIONS.ADMINISTRATION), packageCvController.getStatisticalPackageCv)
    router.get('/api/get-all-package-cv-select', ...protectedBy(PERMISSIONS.PACKAGE_CATALOG_READ), packageCvController.getAllToSelect)
    router.get('/api/get-history-trade-cv', ...protectedBy(PERMISSIONS.PACKAGE_HISTORY_READ), packageCvController.getHistoryTrade)
    router.get('/api/get-sum-by-year-cv', ...protectedBy(PERMISSIONS.ADMINISTRATION), packageCvController.getSumByYear)


    //==================API FAVORITE POST (LUU TIN)==========================//
    router.post('/api/toggle-favorite-post', ...protectedBy(PERMISSIONS.SOCIAL_INTERACT), favoritePostController.handleToggleFavoritePost)
    router.get('/api/check-favorite-post', middlewareControllers.verifyTokenOptional, favoritePostController.checkFavoriteByUser)
    router.get('/api/get-favorite-post-by-user', ...protectedBy(PERMISSIONS.SOCIAL_INTERACT), favoritePostController.getFavoritePostByUser)

    //==================API COMPANY REVIEW (DANH GIA CONG TY)================//
    router.post('/api/create-company-review', ...protectedBy(PERMISSIONS.SOCIAL_INTERACT), companyReviewController.handleCreateReview)
    router.get('/api/get-review-by-company', companyReviewController.getReviewByCompany)
    router.post('/api/delete-company-review', ...protectedBy(PERMISSIONS.SOCIAL_INTERACT), companyReviewController.handleDeleteReview)

    //==================API FOLLOW COMPANY (THEO DOI CONG TY)================//
    router.post('/api/toggle-follow-company', ...protectedBy(PERMISSIONS.SOCIAL_INTERACT), followCompanyController.handleToggleFollowCompany)
    router.get('/api/check-follow-company', middlewareControllers.verifyTokenOptional, followCompanyController.checkFollowCompany)
    router.get('/api/get-followed-company-by-user', ...protectedBy(PERMISSIONS.SOCIAL_INTERACT), followCompanyController.getFollowedCompanyByUser)

    //==================API NOTIFICATION (THONG BAO)=========================//
    router.get('/api/get-notification-by-user', ...protectedBy(PERMISSIONS.NOTIFICATION_READ), notificationController.getNotificationByUser)
    router.post('/api/mark-read-notification', ...protectedBy(PERMISSIONS.NOTIFICATION_READ), notificationController.handleMarkReadNotification)

    //==================API CHAT (NHAN TIN)==================================//
    router.post('/api/send-chat-message', ...protectedBy(PERMISSIONS.CHAT), chatController.handleSendMessage)
    router.get('/api/get-chat-conversation', ...protectedBy(PERMISSIONS.CHAT), chatController.getConversation)
    router.get('/api/get-list-chat-conversation', ...protectedBy(PERMISSIONS.CHAT), chatController.getListConversation)

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
