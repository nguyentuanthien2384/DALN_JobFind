import axios from "../axios";


//==================USER==========================//
const getAllUsers = (data) => {
    return axios.get(`/api/get-all-user?limit=${data.limit}&offset=${data.offset}&search=${data.search}`)

}
const createNewUser = (data) => {
    return axios.post(`/api/create-new-user`, data)

}
const UpdateUserService = (data) => {
    return axios.put(`/api/update-user`, data)

}
const BanUserService = (userId) => {
    return axios.post(`/api/ban-user`, {
        data: {
            id: userId
        }
    })

}

const UnbanUserService = (userId) => {
    return axios.post(`/api/unban-user`, {
        data: {
            id: userId
        }
    })

}
const checkUserPhoneService = (phonenumber) => {
    return axios.get(`/api/check-phonenumber-user?phonenumber=${phonenumber}`)
}
const changePasswordByphone = (data) => {
    return axios.post(`/api/changepasswordbyPhone`,data)
}
// Buoc 1 cua luong quen mat khau: xin ma OTP gui ve email cua tai khoan.
const requestResetPasswordOtp = (data) => {
    return axios.post(`/api/request-reset-password-otp`, data)
}
const getDetailUserById = (id) => {
    return axios.get(`/api/get-detail-user-by-id?id=${id}`)

}
const handleLoginService = (data) => {
    return axios.post(`/api/login`, data)

}
const getCurrentAuthorizationService = () => {
    return axios.get(`/api/auth/me`)
}

const handleChangePassword = (data) => {
    return axios.post(`/api/changepassword`, data)
}

const UpdateUserSettingService = (data) => {
    return axios.put(`/api/setDataUserSetting`, data)

}

//===============ALL CODE========================//
const getAllCodeService = (type) => {
    return axios.get(`/api/get-all-code?type=${type}`)

}
const getListAllCodeService = (data) => {
    return axios.get(`/api/get-list-allcode?type=${data.type}&limit=${data.limit}&offset=${data.offset}&search=${data.search}`)

}

const getListJobTypeAndCountPost = (data) => {
    return axios.get(`/api/get-list-job-count-post?limit=${data.limit}&offset=${data.offset}`)

}

const createAllCodeService = (data) => {
    return axios.post(`/api/create-new-all-code`, data)

}

const getDetailAllcodeByCode = (code) => {
    return axios.get(`/api/get-detail-all-code-by-code?code=${code}`)

}
const UpdateAllcodeService = (data) => {
    return axios.put(`/api/update-all-code`, data)

}
const DeleteAllcodeService = (allcodeId) => {
    return axios.delete(`/api/delete-all-code`, {
        data: {
            code: allcodeId
        }
    })
}

const getListSkill = (data) => {
    return axios.get(`/api/get-list-skill?categoryJobCode=${data.categoryJobCode}&limit=${data.limit}&offset=${data.offset}&search=${data.search}`)

}

const getAllSkillByJobCode = (categoryJobCode) => {
    return axios.get(`/api/get-all-skill-by-job-code?categoryJobCode=${categoryJobCode}`)

}

const createSkilleService = (data) => {
    return axios.post(`/api/create-new-skill`, data)

}

const UpdateSkillService = (data) => {
    return axios.put(`/api/update-skill`, data)

}
const DeleteSkillService = (skillId) => {
    return axios.delete(`/api/delete-skill`, {
        data: {
            id: skillId
        }
    })
}

const getDetailSkillById = (id) => {
    return axios.get(`/api/get-detail-skill-by-id?id=${id}`)

}
//================================== COMPANY ============================
const createCompanyService = (data) => {
    return axios.post(`/api/create-new-company`, data)

}
const getDetailCompanyByUserId = (userId,companyId) => {
    return axios.get(`/api/get-detail-company-by-userId?userId=${userId}&companyId=${companyId}`)

}
const getDetailCompanyById = (id) => {
    return axios.get(`/api/get-detail-company-by-id?id=${id}`)

}
const updateCompanyService = (data) => {
    return axios.put(`/api/update-company`, data)

}
const RecruitmentService = (data) => {
    return axios.put(`/api/add-user-company`, data)

}
const getAllUserByCompanyIdService = (data) => {
    return axios.get(`/api/get-all-user-by-companyId?companyId=${data.companyId}&limit=${data.limit}&offset=${data.offset}`)

}
const QuitCompanyService = (data) => {
    return axios.put(`/api/quit-company`, data)

}
const getListCompany = (data) => {
    return axios.get(`/api/get-list-company?limit=${data.limit}&offset=${data.offset}&search=${data.search}`)

}

const getAllCompany = (data) => {
    return axios.get(`/api/get-all-company?limit=${data.limit}&offset=${data.offset}&search=${data.search}&censorCode=${data.censorCode}`)
}

const banCompanyService = (data) => {
    return axios.put(`/api/ban-company`, data)
}

const unbanCompanyService = (data) => {
    return axios.put(`/api/unban-company`, data)

}

const accecptCompanyService = (data) => {
    return axios.put(`/api/accecpt-company`, data)

}

//======================== POST ====================================//

const createPostService = (data) => {
    return axios.post(`/api/create-new-post`, data)

}
const reupPostService = (data) => {
    return axios.post(`/api/create-reup-post`, data)

}
const updatePostService = (data) => {
    return axios.put(`/api/update-post`, data)

}
const activePostService = (data) => {
    return axios.put(`/api/active-post`, data)

}
const banPostService = (data) => {
    return axios.put(`/api/ban-post`, data)
}
const acceptPostService = (data) => {
    return axios.put(`/api/accept-post`, data)
}
const getAllPostByAdminService = (data) => {
    return axios.get(`/api/get-list-post-admin?companyId=${data.companyId}&limit=${data.limit}&offset=${data.offset}&search=${data.search}&censorCode=${data.censorCode}`)

}
const getAllPostByRoleAdminService = (data) => {
    return axios.get(`/api/get-all-post-admin?limit=${data.limit}&offset=${data.offset}&search=${data.search}&censorCode=${data.censorCode}`)

}
const getDetailPostByIdService = (id) => {
    return axios.get(`/api/get-detail-post-by-id?id=${id}`)
}
const getListPostService = (data) => {
    const encodedSearch = encodeURIComponent(data?.search || '')
    if (data.isHot === 1)
    {
        return axios.get(`/api/get-filter-post?limit=${data.limit}&offset=${data.offset}&categoryJobCode=${data.categoryJobCode}&addressCode=${data.addressCode}&salaryJobCode=${data.salaryJobCode}&categoryJoblevelCode=${data.categoryJoblevelCode}&categoryWorktypeCode=${data.categoryWorktypeCode}&experienceJobCode=${data.experienceJobCode}&sortName=${data.sortName}&isHot=${data.isHot}&search=${encodedSearch}`)

    }
    return axios.get(`/api/get-filter-post?limit=${data.limit}&offset=${data.offset}&categoryJobCode=${data.categoryJobCode}&addressCode=${data.addressCode}&salaryJobCode=${data.salaryJobCode}&categoryJoblevelCode=${data.categoryJoblevelCode}&categoryWorktypeCode=${data.categoryWorktypeCode}&experienceJobCode=${data.experienceJobCode}&sortName=${data.sortName}&search=${encodedSearch}`)
}

const getStatisticalTypePost = (limit) => {
    return axios.get(`/api/get-statistical-post?limit=${limit}`)
}

const getListNoteByPost = (data) => {
    return axios.get(`/api/get-note-by-post?limit=${data.limit}&offset=${data.offset}&id=${data.id}`)
}
//======================== PACKAGE ====================================//
const getPackageByType = (isHot) => {
    return axios.get(`/api/get-package-by-type?isHot=${isHot}`)
}

const getPackageById = (id) => {
    return axios.get(`/api/get-package-by-id?id=${id}`)
}

const getPaymentLink = (id,amount) => {
    return axios.get(`/api/get-payment-link?id=${id}&amount=${amount}`)
}

const paymentOrderSuccessService = (data) => {
    return axios.post(`/api/payment-success`, data)
}

const getAllPackage = (data) => {
    return axios.get(`/api/get-all-package?limit=${data.limit}&offset=${data.offset}&search=${data.search}`)
}

const setActiveTypePackage= (data) => {
    return axios.put(`/api/set-active-package-post`, data)
}

const createPackagePost= (data) => {
    return axios.post(`/api/create-package-post`, data)
}

const updatePackagePost = (data) => {
    return axios.put(`/api/update-package-post`, data)
}

const getStatisticalPackagePost = (data) => {
    return axios.get(`/api/get-statistical-package?limit=${data.limit}&offset=${data.offset}&fromDate=${data.fromDate}&toDate=${data.toDate}`)
}


//======================== PACKAGE CV ====================================//
const getPackageByIdCv = (id) => {
    return axios.get(`/api/get-package-cv-by-id?id=${id}`)
}

const getPaymentLinkCv = (id,amount) => {
    return axios.get(`/api/get-payment-cv-link?id=${id}&amount=${amount}`)
}

const paymentOrderSuccessServiceCv = (data) => {
    return axios.post(`/api/payment-cv-success`, data)
}

const getAllPackageCv = (data) => {
    return axios.get(`/api/get-all-package-cv?limit=${data.limit}&offset=${data.offset}&search=${data.search}`)
}

const getAllToSelect = () => {
    return axios.get(`/api/get-all-package-cv-select`)
}

const setActiveTypePackageCv= (data) => {
    return axios.put(`/api/set-active-package-cv`, data)
}

const createPackageCv= (data) => {
    return axios.post(`/api/create-package-cv`, data)
}

const updatePackageCv = (data) => {
    return axios.put(`/api/update-package-cv`, data)
}

const getStatisticalPackageCv = (data) => {
    return axios.get(`/api/get-statistical-package-cv?limit=${data.limit}&offset=${data.offset}&fromDate=${data.fromDate}&toDate=${data.toDate}`)
}

const getHistoryTradeCv = (data) => {
    return axios.get(`/api/get-history-trade-cv?limit=${data.limit}&offset=${data.offset}&fromDate=${data.fromDate}&toDate=${data.toDate}&companyId=${data.companyId}`)
}

const getHistoryTradePost = (data) => {
    return axios.get(`/api/get-history-trade-post?limit=${data.limit}&offset=${data.offset}&fromDate=${data.fromDate}&toDate=${data.toDate}&companyId=${data.companyId}`)
}

const getSumByYearPost = (year) => {
    return axios.get(`/api/get-sum-by-year-post?year=${year}`)
}

const getSumByYearCv = (year) => {
    return axios.get(`/api/get-sum-by-year-cv?year=${year}`)
}

//===============FAVORITE POST (LƯU TIN)========================//
const toggleFavoritePostService = (data) => {
    return axios.post(`/api/toggle-favorite-post`, data)
}
const checkFavoritePostService = (data) => {
    return axios.get(`/api/check-favorite-post?userId=${data.userId}&postId=${data.postId}`)
}
const getFavoritePostByUserService = (data) => {
    return axios.get(`/api/get-favorite-post-by-user?userId=${data.userId}&limit=${data.limit}&offset=${data.offset}`)
}

//===============RELATED POST (VIỆC LÀM TƯƠNG TỰ)===============//
const getRelatedPostService = (data) => {
    return axios.get(`/api/get-related-post?postId=${data.postId}&limit=${data.limit}`)
}

//===============COMPANY REVIEW (ĐÁNH GIÁ CÔNG TY)==============//
const createCompanyReviewService = (data) => {
    return axios.post(`/api/create-company-review`, data)
}
const getReviewByCompanyService = (data) => {
    return axios.get(`/api/get-review-by-company?companyId=${data.companyId}&limit=${data.limit}&offset=${data.offset}`)
}
const deleteCompanyReviewService = (data) => {
    return axios.post(`/api/delete-company-review`, data)
}


//===============FOLLOW COMPANY (THEO DÕI CÔNG TY)==============//
const toggleFollowCompanyService = (data) => {
    return axios.post(`/api/toggle-follow-company`, data)
}
const checkFollowCompanyService = (data) => {
    return axios.get(`/api/check-follow-company?companyId=${data.companyId}&userId=${data.userId || ''}`)
}
const getFollowedCompanyByUserService = (data) => {
    return axios.get(`/api/get-followed-company-by-user?userId=${data.userId}&limit=${data.limit}&offset=${data.offset}`)
}

//===============NOTIFICATION (THÔNG BÁO)=======================//
const getNotificationByUserService = (data) => {
    return axios.get(`/api/get-notification-by-user?userId=${data.userId}&limit=${data.limit}&offset=${data.offset}`)
}
const markReadNotificationService = (data) => {
    return axios.post(`/api/mark-read-notification`, data)
}

//===============RECOMMENDED POST (GỢI Ý VIỆC LÀM)==============//
const getRecommendedPostService = (data) => {
    return axios.get(`/api/get-recommended-post?userId=${data.userId}&limit=${data.limit}`)
}

//===============CHAT (NHẮN TIN)================================//
const sendChatMessageService = (data) => {
    return axios.post(`/api/send-chat-message`, data)
}
const getChatConversationService = (data) => {
    return axios.get(`/api/get-chat-conversation?partnerId=${data.partnerId}`)
}
const getListChatConversationService = () => {
    return axios.get(`/api/get-list-chat-conversation`)
}

export {
    DeleteAllcodeService, UpdateAllcodeService, getDetailAllcodeByCode, createAllCodeService, getListAllCodeService, getAllCodeService,
    getAllUsers, createNewUser, UpdateUserService, BanUserService,UnbanUserService, getDetailUserById, handleChangePassword, handleLoginService, getCurrentAuthorizationService,
    createCompanyService, getDetailCompanyByUserId, updateCompanyService, RecruitmentService, getAllUserByCompanyIdService, QuitCompanyService,
    createPostService, updatePostService, banPostService,acceptPostService, getAllPostByAdminService,getAllPostByRoleAdminService, getDetailPostByIdService, activePostService, checkUserPhoneService, getListPostService,
    getListJobTypeAndCountPost, getListCompany, getDetailCompanyById,changePasswordByphone,requestResetPasswordOtp,getStatisticalTypePost , getPackageByType, getPaymentLink , paymentOrderSuccessService , getAllPackage ,
    setActiveTypePackage , createPackagePost , getPackageById , updatePackagePost , getStatisticalPackagePost,
    getListNoteByPost , getAllCompany , accecptCompanyService, reupPostService, banCompanyService, unbanCompanyService,
    getListSkill, getAllSkillByJobCode, createSkilleService, UpdateSkillService, DeleteSkillService, getDetailSkillById,
    UpdateUserSettingService,
    getPackageByIdCv, getAllPackageCv, getPaymentLinkCv, paymentOrderSuccessServiceCv, setActiveTypePackageCv, createPackageCv, updatePackageCv,getStatisticalPackageCv, getAllToSelect,
    getHistoryTradeCv, getHistoryTradePost, getSumByYearCv, getSumByYearPost,
    toggleFavoritePostService, checkFavoritePostService, getFavoritePostByUserService,
    getRelatedPostService,
    createCompanyReviewService, getReviewByCompanyService, deleteCompanyReviewService,
    toggleFollowCompanyService, checkFollowCompanyService, getFollowedCompanyByUserService,
    getNotificationByUserService, markReadNotificationService,
    getRecommendedPostService,
    sendChatMessageService, getChatConversationService, getListChatConversationService
}
