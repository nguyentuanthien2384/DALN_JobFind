import React from "react";
import Header from "./Header";
import Menu from "./Menu";
import Home from "./Home";
import Footer from "./Footer";
import ManageUser from "./User/ManageUser";
import KanbanBoard from "./Cv/KanbanBoard";
import ReportDashboard from "./Report/ReportDashboard";
import { Routes, Route, Navigate, Link } from "react-router-dom";
import AddUser from "./User/AddUser";
import AddJobType from "./JobType/AddJobType";
import ManageJobType from "./JobType/ManageJobType";
import AddJobLevel from "./JobLevel/AddJobLevel";
import ManageJobLevel from "./JobLevel/ManageJobLevel";
import AddWorkType from "./WorkType/AddWorkType";
import ManageWorkType from "./WorkType/ManageWorkType";
import AddSalaryType from "./SalaryType/AddSalaryType";
import ManageSalaryType from "./SalaryType/ManageSalaryType";
import AddExpType from "./ExpType/AddExpType";
import ManageExpType from "./ExpType/ManageExpType";
import AddCompany from "./Company/AddCompany";
import Recruitment from "./Company/Recruitment";
import ManageEmployer from "./Company/ManageEmployer";
import AddPost from "./Post/AddPost";
import ManagePost from "./Post/ManagePost";
import ManageCv from "./Cv/ManageCv";
import FilterCv from "./Cv/FilterCv";
import UserCv from "./Cv/UserCv";
import ChangePassword from "./User/ChangePassword";
import UserInfo from "./User/UserInfo";
import BuyPost from "./Post/BuyPost";
import PaymentSuccess from "./Post/BuySucces";
import AddpackagePost from "./PackagePost/AddPackagePost";
import ManagePackagePost from "./PackagePost/ManagePackagePost";
import NotePost from "./Post/NotePost";
import ManageCompany from "./Company/ManageCompany";
import AddJobSkill from "./JobSkill/AddJobSkill";
import ManageJobSkill from "./JobSkill/ManageJobSkill";
import DetailFilterUser from "./Cv/DetailFilterUser";
import AddpackageCv from "./PackageCv/AddPackageCv";
import ManagePackageCv from "./PackageCv/ManagePackageCv";
import PaymentSuccessCv from "./PackageCv/BuySuccesCv";
import BuyCv from "./PackageCv/BuyCv";
import HistoryTradePost from "./HistoryTrade/HistoryTradePost";
import HistoryTradeCv from "./HistoryTrade/HistoryTradeCv";
import ChartPost from "./Chart/ChartPost";
import ChartCv from "./Chart/ChartCv";
import ChatPage from "../Chat/ChatPage";
import PaymentCancelled from "./PaymentCancelled";
import RouteGuard from "../../auth/RouteGuard";
import {
    getDefaultRouteForUser,
    hasPermission,
    PERMISSIONS,
} from "../../auth/accessControl";
import { readJsonStorage } from "../../util/storage";

const HomeAdmin = ({ user: suppliedUser }) => {
    const user = suppliedUser || readJsonStorage("userData");
    const defaultRoute = getDefaultRouteForUser(user);
    const guard = (element, ...permissions) => (
        <RouteGuard user={user} anyPermissions={permissions}>
            {element}
        </RouteGuard>
    );

    return (
        <div className="container-scroller">
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
                            <Route path="/chat/:partnerId" element={guard(<ChatPage />, PERMISSIONS.USE_CHAT)} />
                            <Route path="/list-user" element={guard(<ManageUser />, PERMISSIONS.MANAGE_USERS)} />
                            <Route path="/pipeline" element={guard(<KanbanBoard />, PERMISSIONS.MANAGE_CANDIDATES)} />
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
                            <Route path="/buy-post" element={guard(<BuyPost />, PERMISSIONS.PURCHASE_PACKAGES)} />
                            <Route
                                path="/payment/success"
                                element={guard(<PaymentSuccess />, PERMISSIONS.PURCHASE_PACKAGES)}
                            />
                            <Route
                                path="/payment/cancel"
                                element={
                                    guard(
                                        <PaymentCancelled
                                            storageKey="orderData"
                                            buyPath="/admin/buy-post"
                                            packageLabel="gói đăng bài"
                                        />,
                                        PERMISSIONS.PURCHASE_PACKAGES
                                    )
                                }
                            />
                            <Route path="/buy-cv" element={guard(<BuyCv />, PERMISSIONS.PURCHASE_PACKAGES)} />
                            <Route
                                path="/paymentCv/success"
                                element={guard(<PaymentSuccessCv />, PERMISSIONS.PURCHASE_PACKAGES)}
                            />
                            <Route
                                path="/paymentCv/cancel"
                                element={
                                    guard(
                                        <PaymentCancelled
                                            storageKey="orderCvData"
                                            buyPath="/admin/buy-cv"
                                            packageLabel="gói tìm ứng viên"
                                        />,
                                        PERMISSIONS.PURCHASE_PACKAGES
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
