import React, { lazy, Suspense, useMemo } from "react";
import Header from "./Header";
import Menu from "./Menu";
import AdminPageHeader from "./AdminPageHeader";
import Footer from "./Footer";
import { Routes, Route, Navigate, Link } from "react-router-dom";
import RouteGuard from "../../auth/RouteGuard";
import {
    getDefaultRouteForUser,
    hasPermission,
    PERMISSIONS,
    ROLES,
} from "../../auth/accessControl";
import { readJsonStorage } from "../../util/storage";
import './AdminLayout.css';

// Load only the current page; editors, charts and PDF tools stay in their own chunks.
const SupportInbox = lazy(() => import("../../components/support/SupportInbox"));
const Home = lazy(() => import("./Home"));
const ManageUser = lazy(() => import("./User/ManageUser"));
const ReportDashboard = lazy(() => import("./Report/ReportDashboard"));
const AddUser = lazy(() => import("./User/AddUser"));
const AddJobType = lazy(() => import("./JobType/AddJobType"));
const ManageJobType = lazy(() => import("./JobType/ManageJobType"));
const AddJobLevel = lazy(() => import("./JobLevel/AddJobLevel"));
const ManageJobLevel = lazy(() => import("./JobLevel/ManageJobLevel"));
const AddWorkType = lazy(() => import("./WorkType/AddWorkType"));
const ManageWorkType = lazy(() => import("./WorkType/ManageWorkType"));
const AddSalaryType = lazy(() => import("./SalaryType/AddSalaryType"));
const ManageSalaryType = lazy(() => import("./SalaryType/ManageSalaryType"));
const AddExpType = lazy(() => import("./ExpType/AddExpType"));
const ManageExpType = lazy(() => import("./ExpType/ManageExpType"));
const AddCompany = lazy(() => import("./Company/AddCompany"));
const Recruitment = lazy(() => import("./Company/Recruitment"));
const ManageEmployer = lazy(() => import("./Company/ManageEmployer"));
const AddPost = lazy(() => import("./Post/AddPost"));
const ManagePost = lazy(() => import("./Post/ManagePost"));
const ManageCv = lazy(() => import("./Cv/ManageCv"));
const FilterCv = lazy(() => import("./Cv/FilterCv"));
const UserCv = lazy(() => import("./Cv/UserCv"));
const KanbanBoard = lazy(() => import("./Cv/KanbanBoard"));
const InterviewCalendar = lazy(() => import("../../components/interviews/InterviewCalendar"));
const ChangePassword = lazy(() => import("./User/ChangePassword"));
const UserInfo = lazy(() => import("./User/UserInfo"));
const BuyPost = lazy(() => import("./Post/BuyPost"));
const PaymentSuccess = lazy(() => import("./Post/BuySucces"));
const AddpackagePost = lazy(() => import("./PackagePost/AddPackagePost"));
const ManagePackagePost = lazy(() => import("./PackagePost/ManagePackagePost"));
const NotePost = lazy(() => import("./Post/NotePost"));
const ManageCompany = lazy(() => import("./Company/ManageCompany"));
const AddJobSkill = lazy(() => import("./JobSkill/AddJobSkill"));
const ManageJobSkill = lazy(() => import("./JobSkill/ManageJobSkill"));
const DetailFilterUser = lazy(() => import("./Cv/DetailFilterUser"));
const AddpackageCv = lazy(() => import("./PackageCv/AddPackageCv"));
const ManagePackageCv = lazy(() => import("./PackageCv/ManagePackageCv"));
const PaymentSuccessCv = lazy(() => import("./PackageCv/BuySuccesCv"));
const BuyCv = lazy(() => import("./PackageCv/BuyCv"));
const HistoryTradePost = lazy(() => import("./HistoryTrade/HistoryTradePost"));
const HistoryTradeCv = lazy(() => import("./HistoryTrade/HistoryTradeCv"));
const RewardsWorkspace = lazy(() => import("./Rewards/RewardsWorkspace"));
const ManagePromoCode = lazy(() => import("./PromoCode/ManagePromoCode"));
const ChartPost = lazy(() => import("./Chart/ChartPost"));
const ChartCv = lazy(() => import("./Chart/ChartCv"));
const ChatPage = lazy(() => import("../Chat/ChatPage"));
const PaymentCancelled = lazy(() => import("./PaymentCancelled"));

const PageLoader = () => (
    <div className="route-page-loader" role="status" aria-live="polite">
        Đang tải giao diện...
    </div>
);

const HomeAdmin = ({ user: suppliedUser }) => {
    const user = useMemo(
        () => suppliedUser || readJsonStorage("userData"),
        [suppliedUser]
    );
    const defaultRoute = getDefaultRouteForUser(user);
    const guard = (element, ...permissions) => (
        <RouteGuard user={user} anyPermissions={permissions}>
            {element}
        </RouteGuard>
    );
    const companyOwnerPurchaseGuard = (element) => (
        <RouteGuard
            user={user}
            allowedRoles={[ROLES.COMPANY]}
            anyPermissions={[PERMISSIONS.PURCHASE_PACKAGES]}
        >
            {element}
        </RouteGuard>
    );

    return (
        <div className="container-scroller jf-admin">
            {/* partial:partials/_navbar.html */}
            <Header user={user} />
            {/* partial */}
            <div className="container-fluid page-body-wrapper">
                {/* partial:partials/_settings-panel.html */}
                <div className="theme-setting-wrapper">
                    <div id="settings-trigger">
                        <i className="ti-settings" />
                    </div>
                    <div id="theme-settings" className="settings-panel">
                        <i className="settings-close ti-close" />
                        <p className="settings-heading">SIDEBAR SKINS</p>
                        <div
                            className="sidebar-bg-options selected"
                            id="sidebar-light-theme"
                        >
                            <div className="img-ss rounded-circle bg-light border mr-3" />
                            Light
                        </div>
                        <div
                            className="sidebar-bg-options"
                            id="sidebar-dark-theme"
                        >
                            <div className="img-ss rounded-circle bg-dark border mr-3" />
                            Dark
                        </div>
                        <p className="settings-heading mt-2">HEADER SKINS</p>
                        <div className="color-tiles mx-0 px-4">
                            <div className="tiles success" />
                            <div className="tiles warning" />
                            <div className="tiles danger" />
                            <div className="tiles info" />
                            <div className="tiles dark" />
                            <div className="tiles default" />
                        </div>
                    </div>
                </div>
                <div id="right-sidebar" className="settings-panel">
                    <i className="settings-close ti-close" />
                    <div className="px-4 py-4">
                        <h4 className="mb-4">Truy cập nhanh</h4>
                        <div className="list-group">
                            {hasPermission(user, PERMISSIONS.USE_CHAT) && (
                                <Link className="list-group-item list-group-item-action" to="/admin/chat">
                                    Tin nhắn tuyển dụng
                                </Link>
                            )}
                            {hasPermission(user, PERMISSIONS.MANAGE_CANDIDATES) && (
                                <Link className="list-group-item list-group-item-action" to="/admin/pipeline">
                                    Quy trình ứng viên
                                </Link>
                            )}
                            {hasPermission(user, PERMISSIONS.VIEW_PLATFORM_REPORTS) && (
                                <Link className="list-group-item list-group-item-action" to="/admin/reports">
                                    Báo cáo hệ thống
                                </Link>
                            )}
                        </div>
                        <p className="text-muted mt-4 mb-0">
                            Dữ liệu được đồng bộ tự động. Bạn có thể dùng nút Làm mới trên từng trang khi cần.
                        </p>
                    </div>
                </div>
                {/* partial */}
                {/* partial:partials/_sidebar.html */}
                <Menu user={user} />
                {/* partial */}
                <div className="main-panel">
                    <div className="content-wrapper">
                        <AdminPageHeader user={user} />
                        <Suspense fallback={<PageLoader />}>
                        <Routes>
                            <Route
                                path="/"
                                element={
                                    hasPermission(user, PERMISSIONS.VIEW_ADMIN_HOME)
                                        ? guard(<Home />, PERMISSIONS.VIEW_ADMIN_HOME)
                                        : <Navigate to={defaultRoute} replace />
                                }
                            />
                            <Route path="/chat" element={guard(<ChatPage />, PERMISSIONS.USE_CHAT)} />
                            <Route path="/support" element={guard(<SupportInbox />, PERMISSIONS.SUPPORT_MANAGE)} />
                            <Route path="/chat/:partnerId" element={guard(<ChatPage />, PERMISSIONS.USE_CHAT)} />
                            <Route path="/list-user" element={guard(<ManageUser />, PERMISSIONS.MANAGE_USERS)} />
                            <Route path="/pipeline" element={guard(<KanbanBoard />, PERMISSIONS.MANAGE_CANDIDATES)} />
                            <Route path="/interviews" element={guard(<InterviewCalendar user={user} />, PERMISSIONS.MANAGE_CANDIDATES)} />
                            <Route path="/reports" element={guard(<ReportDashboard />, PERMISSIONS.VIEW_PLATFORM_REPORTS)} />
                            <Route
                                path="/add-user"
                                element={guard(<AddUser />, PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_TEAM)}
                            />
                            <Route
                                path="/edit-user/:id"
                                element={guard(<AddUser />, PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_TEAM)}
                            />
                            <Route
                                path="/add-job-type"
                                element={guard(<AddJobType />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/list-job-type"
                                element={guard(<ManageJobType />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/edit-job-type/:code"
                                element={guard(<AddJobType />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/add-job-skill"
                                element={guard(<AddJobSkill />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/list-job-skill"
                                element={guard(<ManageJobSkill />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/edit-job-skill/:code"
                                element={guard(<AddJobSkill />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/add-job-level"
                                element={guard(<AddJobLevel />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/list-job-level"
                                element={guard(<ManageJobLevel />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/edit-job-level/:id"
                                element={guard(<AddJobLevel />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/add-work-type"
                                element={guard(<AddWorkType />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/list-work-type"
                                element={guard(<ManageWorkType />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/edit-work-type/:id"
                                element={guard(<AddWorkType />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/add-salary-type"
                                element={guard(<AddSalaryType />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/list-salary-type"
                                element={guard(<ManageSalaryType />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/edit-salary-type/:id"
                                element={guard(<AddSalaryType />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/add-exp-type"
                                element={guard(<AddExpType />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/list-exp-type"
                                element={guard(<ManageExpType />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/edit-exp-type/:id"
                                element={guard(<AddExpType />, PERMISSIONS.MANAGE_REFERENCE_DATA)}
                            />
                            <Route
                                path="/add-package-post"
                                element={guard(<AddpackagePost />, PERMISSIONS.MANAGE_PACKAGES)}
                            />
                            <Route
                                path="/list-package-post"
                                element={guard(<ManagePackagePost />, PERMISSIONS.MANAGE_PACKAGES)}
                            />
                            <Route
                                path="/edit-package-post/:id"
                                element={guard(<AddpackagePost />, PERMISSIONS.MANAGE_PACKAGES)}
                            />
                            <Route
                                path="/add-package-cv"
                                element={guard(<AddpackageCv />, PERMISSIONS.MANAGE_PACKAGES)}
                            />
                            <Route
                                path="/list-package-cv"
                                element={guard(<ManagePackageCv />, PERMISSIONS.MANAGE_PACKAGES)}
                            />
                            <Route
                                path="/edit-package-cv/:id"
                                element={guard(<AddpackageCv />, PERMISSIONS.MANAGE_PACKAGES)}
                            />
                            <Route
                                path="/promo-codes"
                                element={guard(<ManagePromoCode />, PERMISSIONS.MANAGE_PACKAGES)}
                            />
                            <Route
                                path="/list-promo-code"
                                element={guard(<ManagePromoCode />, PERMISSIONS.MANAGE_PACKAGES)}
                            />
                            <Route
                                path="/add-company"
                                element={guard(<AddCompany />, PERMISSIONS.CREATE_COMPANY)}
                            />
                            <Route
                                path="/edit-company"
                                element={guard(<AddCompany />, PERMISSIONS.MANAGE_COMPANY)}
                            />
                            <Route
                                path="/edit-company-admin/:id"
                                element={guard(<AddCompany />, PERMISSIONS.MODERATE_COMPANIES)}
                            />
                            <Route
                                path="/recruitment"
                                element={guard(<Recruitment />, PERMISSIONS.MANAGE_TEAM)}
                            />
                            <Route
                                path="/list-employer"
                                element={guard(<ManageEmployer />, PERMISSIONS.MANAGE_TEAM)}
                            />
                            <Route path="/add-post" element={guard(<AddPost />, PERMISSIONS.MANAGE_POSTS)} />
                            <Route
                                path="/edit-post/:id"
                                element={guard(<AddPost />, PERMISSIONS.MANAGE_POSTS, PERMISSIONS.MODERATE_POSTS)}
                            />
                            <Route path="/list-post" element={guard(<ManagePost />, PERMISSIONS.MANAGE_POSTS)} />
                            <Route
                                path="/list-post/:id"
                                element={guard(<ManagePost />, PERMISSIONS.MANAGE_POSTS)}
                            />
                            <Route path="/buy-post" element={companyOwnerPurchaseGuard(<BuyPost />)} />
                            <Route
                                path="/rewards"
                                element={guard(
                                    <RewardsWorkspace user={user} />,
                                    PERMISSIONS.PURCHASE_PACKAGES,
                                    PERMISSIONS.MANAGE_POSTS,
                                    PERMISSIONS.VIEW_PLATFORM_REPORTS
                                )}
                            />
                            <Route
                                path="/payment/success"
                                element={companyOwnerPurchaseGuard(<PaymentSuccess />)}
                            />
                            <Route
                                path="/payment/cancel"
                                element={
                                    companyOwnerPurchaseGuard(
                                        <PaymentCancelled
                                            storageKey="orderData"
                                            buyPath="/admin/buy-post"
                                            packageLabel="gói đăng bài"
                                        />
                                    )
                                }
                            />
                            <Route path="/buy-cv" element={companyOwnerPurchaseGuard(<BuyCv />)} />
                            <Route
                                path="/paymentCv/success"
                                element={companyOwnerPurchaseGuard(<PaymentSuccessCv />)}
                            />
                            <Route
                                path="/paymentCv/cancel"
                                element={
                                    companyOwnerPurchaseGuard(
                                        <PaymentCancelled
                                            storageKey="orderCvData"
                                            buyPath="/admin/buy-cv"
                                            packageLabel="gói tìm ứng viên"
                                        />
                                    )
                                }
                            />
                            <Route
                                path="/list-post-admin"
                                element={guard(<ManagePost />, PERMISSIONS.MODERATE_POSTS)}
                            />
                            <Route
                                path="/list-cv/:id"
                                element={guard(<ManageCv />, PERMISSIONS.MANAGE_CANDIDATES, PERMISSIONS.MODERATE_POSTS)}
                            />
                            <Route
                                path="/list-candiate"
                                element={guard(<FilterCv />, PERMISSIONS.MANAGE_CANDIDATES)}
                            />
                            <Route
                                path="/candiate/:id"
                                element={guard(<DetailFilterUser />, PERMISSIONS.MANAGE_CANDIDATES)}
                            />
                            <Route
                                path="/note/:id"
                                element={guard(<NotePost />, PERMISSIONS.MANAGE_POSTS, PERMISSIONS.MODERATE_POSTS)}
                            />
                            <Route
                                path="/user-cv/:id"
                                element={guard(<UserCv />, PERMISSIONS.MANAGE_CANDIDATES, PERMISSIONS.MODERATE_POSTS)}
                            />
                            <Route
                                path="/changepassword"
                                element={guard(<ChangePassword />, PERMISSIONS.MANAGE_PROFILE)}
                            />
                            <Route path="/user-info" element={guard(<UserInfo />, PERMISSIONS.MANAGE_PROFILE)} />
                            <Route
                                path="/list-company-admin"
                                element={guard(<ManageCompany />, PERMISSIONS.MODERATE_COMPANIES)}
                            />
                            <Route
                                path="/history-post"
                                element={guard(<HistoryTradePost />, PERMISSIONS.VIEW_TRANSACTIONS)}
                            />
                            <Route
                                path="/history-cv"
                                element={guard(<HistoryTradeCv />, PERMISSIONS.VIEW_TRANSACTIONS)}
                            />
                            <Route
                                path="/sum-by-year-post"
                                element={guard(<ChartPost />, PERMISSIONS.VIEW_PLATFORM_REPORTS)}
                            />
                            <Route
                                path="/sum-by-year-cv"
                                element={guard(<ChartCv />, PERMISSIONS.VIEW_PLATFORM_REPORTS)}
                            />
                            <Route path="*" element={<Navigate to={defaultRoute} replace />} />
                        </Routes>
                        </Suspense>
                    </div>
                    {/* content-wrapper ends */}
                    {/* partial:partials/_footer.html */}
                    <Footer />
                    {/* partial */}
                </div>
                {/* main-panel ends */}
            </div>
            {/* page-body-wrapper ends */}
        </div>
    );
};

export default HomeAdmin;
