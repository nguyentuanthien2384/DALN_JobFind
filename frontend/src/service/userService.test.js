import axios from "../axios";
import * as service from "./userService";

jest.mock("../axios", () => ({
    __esModule: true,
    default: {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
    },
}));

describe("userService", () => {
    test.each([
        ['banPostService', '/api/ban-post'], ['activePostService', '/api/active-post'], ['acceptPostService', '/api/accept-post']
    ])('%s supports bounded cancellable moderation without retries', async (name, path) => {
        const signal = new AbortController().signal;
        const payload = { id: 17, expectedRevision: 'jv1-' + 'a'.repeat(64), note: 'Review' };
        axios.put.mockResolvedValueOnce({ errCode: -1, errorType: 'timeout' });
        expect(await service[name](payload, { signal })).toMatchObject({ errorType: 'timeout' });
        expect(axios.put).toHaveBeenCalledTimes(1);
        expect(axios.put).toHaveBeenCalledWith(path, payload, { timeout: 15000, signal });
    });
    beforeEach(() => {
        jest.clearAllMocks();
        Object.values(axios).forEach((mock) => mock.mockResolvedValue({ errCode: 0 }));
    });

    const cases = [
        ["getAllUsers", "get", [{ limit: 10, offset: 2, search: "Lan" }], "/api/get-all-user?limit=10&offset=2&search=Lan"],
        ["createNewUser", "post", [{ name: "Lan" }], "/api/create-new-user", { name: "Lan" }],
        ["UpdateUserService", "put", [{ id: 1 }], "/api/update-user", { id: 1 }],
        ["BanUserService", "post", [7], "/api/ban-user", { data: { id: 7 } }],
        ["UnbanUserService", "post", [8], "/api/unban-user", { data: { id: 8 } }],
        ["checkUserPhoneService", "get", ["0901"], "/api/check-phonenumber-user?phonenumber=0901"],
        ["changePasswordByphone", "post", [{ phone: "0901" }], "/api/changepasswordbyPhone", { phone: "0901" }],
        ["requestResetPasswordOtp", "post", [{ email: "a@b.co" }], "/api/request-reset-password-otp", { email: "a@b.co" }],
        ["getDetailUserById", "get", [4], "/api/get-detail-user-by-id?id=4"],
        ["handleLoginService", "post", [{ email: "a@b.co" }], "/api/login", { email: "a@b.co" }],
        ["getCurrentAuthorizationService", "get", [], "/api/auth/me"],
        ["handleChangePassword", "post", [{ old: "one" }], "/api/changepassword", { old: "one" }],
        ["UpdateUserSettingService", "put", [{ id: 3 }], "/api/setDataUserSetting", { id: 3 }],
        ["getAllCodeService", "get", ["ROLE"], "/api/get-all-code?type=ROLE"],
        ["getListAllCodeService", "get", [{ type: "ROLE", limit: 5, offset: 1, search: "ad" }], "/api/get-list-allcode?type=ROLE&limit=5&offset=1&search=ad"],
        ["getListJobTypeAndCountPost", "get", [{ limit: 5, offset: 2 }], "/api/get-list-job-count-post?limit=5&offset=2"],
        ["createAllCodeService", "post", [{ code: "A" }], "/api/create-new-all-code", { code: "A" }],
        ["getDetailAllcodeByCode", "get", ["A"], "/api/get-detail-all-code-by-code?code=A"],
        ["UpdateAllcodeService", "put", [{ code: "A" }], "/api/update-all-code", { code: "A" }],
        ["DeleteAllcodeService", "delete", ["A"], "/api/delete-all-code", { data: { code: "A" } }],
        ["getListSkill", "get", [{ categoryJobCode: "IT", limit: 8, offset: 0, search: "js" }], "/api/get-list-skill?categoryJobCode=IT&limit=8&offset=0&search=js"],
        ["getAllSkillByJobCode", "get", ["IT"], "/api/get-all-skill-by-job-code?categoryJobCode=IT"],
        ["createSkilleService", "post", [{ name: "JS" }], "/api/create-new-skill", { name: "JS" }],
        ["UpdateSkillService", "put", [{ id: 2 }], "/api/update-skill", { id: 2 }],
        ["DeleteSkillService", "delete", [2], "/api/delete-skill", { data: { id: 2 } }],
        ["getDetailSkillById", "get", [2], "/api/get-detail-skill-by-id?id=2"],
        ["createCompanyService", "post", [{ name: "Acme" }], "/api/create-new-company", { name: "Acme" }],
        ["getDetailCompanyByUserId", "get", [3, 9], "/api/get-detail-company-by-userId?userId=3&companyId=9"],
        ["getDetailCompanyById", "get", [9], "/api/get-detail-company-by-id?id=9"],
        ["updateCompanyService", "put", [{ id: 9 }], "/api/update-company", { id: 9 }],
        ["RecruitmentService", "put", [{ userId: 1 }], "/api/add-user-company", { userId: 1 }],
        ["getAllUserByCompanyIdService", "get", [{ companyId: 9, limit: 10, offset: 0 }], "/api/get-all-user-by-companyId?companyId=9&limit=10&offset=0"],
        ["QuitCompanyService", "put", [{ companyId: 9 }], "/api/quit-company", { companyId: 9 }],
        ["getListCompany", "get", [{ limit: 10, offset: 0, search: "acme" }], "/api/get-list-company?limit=10&offset=0&search=acme"],
        ["getAllCompany", "get", [{ limit: 10, offset: 0, search: "acme", censorCode: "C1" }], "/api/get-all-company?limit=10&offset=0&search=acme&censorCode=C1"],
        ["banCompanyService", "put", [{ id: 9 }], "/api/ban-company", { id: 9 }],
        ["unbanCompanyService", "put", [{ id: 9 }], "/api/unban-company", { id: 9 }],
        ["accecptCompanyService", "put", [{ id: 9 }], "/api/accecpt-company", { id: 9 }],
        ["createPostService", "post", [{ title: "Dev" }], "/api/create-new-post", { title: "Dev" }],
        ["reupPostService", "post", [{ id: 1 }], "/api/create-reup-post", { id: 1 }],
        ["updatePostService", "put", [{ id: 1 }], "/api/update-post", { id: 1 }],
        ["activePostService", "put", [{ id: 1 }], "/api/active-post", { id: 1 }],
        ["banPostService", "put", [{ id: 1 }], "/api/ban-post", { id: 1 }],
        ["acceptPostService", "put", [{ id: 1 }], "/api/accept-post", { id: 1 }],
        ["getAllPostByAdminService", "get", [{ companyId: 9, limit: 10, offset: 0, search: "dev", censorCode: "C1" }], "/api/get-list-post-admin?companyId=9&limit=10&offset=0&search=dev&censorCode=C1"],
        ["getAllPostByRoleAdminService", "get", [{ limit: 10, offset: 0, search: "dev", censorCode: "C1" }], "/api/get-all-post-admin?limit=10&offset=0&search=dev&censorCode=C1"],
        ["getDetailPostByIdService", "get", [11], "/api/get-detail-post-by-id?id=11"],
        ["getStatisticalTypePost", "get", [6], "/api/get-statistical-post?limit=6"],
        ["getListNoteByPost", "get", [{ limit: 10, offset: 5, id: 11 }], "/api/get-note-by-post?limit=10&offset=5&id=11"],
        ["getPackageByType", "get", [1], "/api/get-package-by-type?isHot=1"],
        ["getPackageById", "get", [2], "/api/get-package-by-id?id=2"],
        ["getPaymentLink", "get", [2, 5000], "/api/get-payment-link?id=2&amount=5000"],
        ["paymentOrderSuccessService", "post", [{ orderId: 3 }], "/api/payment-success", { orderId: 3 }],
        ["getAllPackage", "get", [{ limit: 10, offset: 0, search: "pro" }], "/api/get-all-package?limit=10&offset=0&search=pro"],
        ["setActiveTypePackage", "put", [{ id: 2 }], "/api/set-active-package-post", { id: 2 }],
        ["createPackagePost", "post", [{ name: "Pro" }], "/api/create-package-post", { name: "Pro" }],
        ["updatePackagePost", "put", [{ id: 2 }], "/api/update-package-post", { id: 2 }],
        ["getStatisticalPackagePost", "get", [{ limit: 10, offset: 0, fromDate: "a", toDate: "b" }], "/api/get-statistical-package?limit=10&offset=0&fromDate=a&toDate=b"],
        ["getPackageByIdCv", "get", [2], "/api/get-package-cv-by-id?id=2"],
        ["getPaymentLinkCv", "get", [2, 5000], "/api/get-payment-cv-link?id=2&amount=5000"],
        ["paymentOrderSuccessServiceCv", "post", [{ orderId: 3 }], "/api/payment-cv-success", { orderId: 3 }],
        ["getAllPackageCv", "get", [{ limit: 10, offset: 0, search: "pro" }], "/api/get-all-package-cv?limit=10&offset=0&search=pro"],
        ["getAllToSelect", "get", [], "/api/get-all-package-cv-select"],
        ["setActiveTypePackageCv", "put", [{ id: 2 }], "/api/set-active-package-cv", { id: 2 }],
        ["createPackageCv", "post", [{ name: "Pro" }], "/api/create-package-cv", { name: "Pro" }],
        ["updatePackageCv", "put", [{ id: 2 }], "/api/update-package-cv", { id: 2 }],
        ["getStatisticalPackageCv", "get", [{ limit: 10, offset: 0, fromDate: "a", toDate: "b" }], "/api/get-statistical-package-cv?limit=10&offset=0&fromDate=a&toDate=b"],
        ["getHistoryTradeCv", "get", [{ limit: 10, offset: 0, fromDate: "a", toDate: "b", companyId: 9 }], "/api/get-history-trade-cv?limit=10&offset=0&fromDate=a&toDate=b&companyId=9"],
        ["getHistoryTradePost", "get", [{ limit: 10, offset: 0, fromDate: "a", toDate: "b", companyId: 9 }], "/api/get-history-trade-post?limit=10&offset=0&fromDate=a&toDate=b&companyId=9"],
        ["getSumByYearPost", "get", [2026], "/api/get-sum-by-year-post?year=2026"],
        ["getSumByYearCv", "get", [2026], "/api/get-sum-by-year-cv?year=2026"],
        ["toggleFavoritePostService", "post", [{ postId: 1 }], "/api/toggle-favorite-post", { postId: 1 }],
        ["checkFavoritePostService", "get", [{ userId: 2, postId: 1 }], "/api/check-favorite-post?userId=2&postId=1"],
        ["getFavoritePostByUserService", "get", [{ userId: 2, limit: 10, offset: 0 }], "/api/get-favorite-post-by-user?userId=2&limit=10&offset=0"],
        ["getRelatedPostService", "get", [{ postId: 1, limit: 4 }], "/api/get-related-post?postId=1&limit=4"],
        ["createCompanyReviewService", "post", [{ companyId: 9 }], "/api/create-company-review", { companyId: 9 }],
        ["getReviewByCompanyService", "get", [{ companyId: 9, limit: 10, offset: 0 }], "/api/get-review-by-company?companyId=9&limit=10&offset=0"],
        ["deleteCompanyReviewService", "post", [{ id: 1 }], "/api/delete-company-review", { id: 1 }],
        ["toggleFollowCompanyService", "post", [{ companyId: 9 }], "/api/toggle-follow-company", { companyId: 9 }],
        ["checkFollowCompanyService", "get", [{ companyId: 9, userId: 2 }], "/api/check-follow-company?companyId=9&userId=2"],
        ["getFollowedCompanyByUserService", "get", [{ userId: 2, limit: 10, offset: 0 }], "/api/get-followed-company-by-user?userId=2&limit=10&offset=0"],
        ["getNotificationByUserService", "get", [{ userId: 2, limit: 10, offset: 0 }], "/api/get-notification-by-user?userId=2&limit=10&offset=0"],
        ["markReadNotificationService", "post", [{ id: 5 }], "/api/mark-read-notification", { id: 5 }],
        ["getRecommendedPostService", "get", [{ userId: 2, limit: 6 }], "/api/get-recommended-post?userId=2&limit=6"],
        ["sendChatMessageService", "post", [{ content: "hello" }], "/api/send-chat-message", { content: "hello" }],
        ["getChatConversationService", "get", [{ partnerId: 3 }], "/api/get-chat-conversation?partnerId=3"],
        ["getListChatConversationService", "get", [], "/api/get-list-chat-conversation"],
    ];

    test.each(cases)("%s builds the expected request", async (...row) => {
        const [name, method, args, url, body] = row;
        const expected = { request: name };
        axios[method].mockResolvedValueOnce(expected);

        await expect(service[name](...args)).resolves.toBe(expected);
        const expectedArguments = body === undefined ? [url] : [url, body];
        expect(axios[method]).toHaveBeenCalledWith(...expectedArguments);
    });

    it("builds normal and hot post filters and normalizes a missing search", async () => {
        const base = {
            limit: 10,
            offset: 0,
            categoryJobCode: "IT",
            addressCode: "HN",
            salaryJobCode: "S1",
            categoryJoblevelCode: "L1",
            categoryWorktypeCode: "W1",
            experienceJobCode: "E1",
            sortName: "newest",
        };

        await service.getListPostService({ ...base });
        expect(axios.get).toHaveBeenLastCalledWith(
            "/api/get-filter-post?limit=10&offset=0&categoryJobCode=IT&addressCode=HN&salaryJobCode=S1&categoryJoblevelCode=L1&categoryWorktypeCode=W1&experienceJobCode=E1&sortName=newest&search="
        );

        await service.getListPostService({ ...base, isHot: 1, search: "react" });
        expect(axios.get).toHaveBeenLastCalledWith(
            "/api/get-filter-post?limit=10&offset=0&categoryJobCode=IT&addressCode=HN&salaryJobCode=S1&categoryJoblevelCode=L1&categoryWorktypeCode=W1&experienceJobCode=E1&sortName=newest&isHot=1&search=react"
        );

        await service.getListPostService({ ...base, search: "C# & .NET" });
        expect(axios.get).toHaveBeenLastCalledWith(
            "/api/get-filter-post?limit=10&offset=0&categoryJobCode=IT&addressCode=HN&salaryJobCode=S1&categoryJoblevelCode=L1&categoryWorktypeCode=W1&experienceJobCode=E1&sortName=newest&search=C%23%20%26%20.NET"
        );
    });

    it("uses an empty user id when checking a company follow anonymously", async () => {
        await service.checkFollowCompanyService({ companyId: 9 });
        expect(axios.get).toHaveBeenCalledWith("/api/check-follow-company?companyId=9&userId=");
    });
});
