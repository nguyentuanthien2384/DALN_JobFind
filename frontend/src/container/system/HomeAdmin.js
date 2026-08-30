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
const HomeAdmin = () => {
    return (
        <div className="container-scroller">
            {/* partial:partials/_navbar.html */}
            <Header />
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
                            <Link className="list-group-item list-group-item-action" to="/admin/chat">
                                Tin nhắn tuyển dụng
                            </Link>
                            <Link className="list-group-item list-group-item-action" to="/admin/pipeline">
                                Quy trình ứng viên
                            </Link>
                            <Link className="list-group-item list-group-item-action" to="/admin/reports">
                                Báo cáo tuyển dụng
                            </Link>
                        </div>
                        <p className="text-muted mt-4 mb-0">
                            Dữ liệu được đồng bộ tự động. Bạn có thể dùng nút Làm mới trên từng trang khi cần.
                        </p>
                    </div>
                </div>
                {/* partial */}
                {/* partial:partials/_sidebar.html */}
                <Menu />
                {/* partial */}
                <div className="main-panel">
                    <div className="content-wrapper">
                        <Routes>
                            <Route path="/" element={<Home />} />
                            <Route path="/chat" element={<ChatPage />} />
                            <Route path="/chat/:partnerId" element={<ChatPage />} />
                            <Route path="/list-user" element={<ManageUser />} />
                            <Route path="/pipeline" element={<KanbanBoard />} />
                            <Route path="/reports" element={<ReportDashboard />} />
                            <Route path="/add-user" element={<AddUser />} />
                            <Route
                                path="/edit-user/:id"
                                element={<AddUser />}
                            />
                            <Route
                                path="/add-job-type"
                                element={<AddJobType />}
                            />
                            <Route
                                path="/list-job-type"
                                element={<ManageJobType />}
                            />
                            <Route
                                path="/edit-job-type/:code"
                                element={<AddJobType />}
                            />
                            <Route
                                path="/add-job-skill"
                                element={<AddJobSkill />}
                            />
                            <Route
                                path="/list-job-skill"
                                element={<ManageJobSkill />}
                            />
                            <Route
                                path="/edit-job-skill/:code"
                                element={<AddJobSkill />}
                            />
                            <Route
                                path="/add-job-level"
                                element={<AddJobLevel />}
                            />
                            <Route
                                path="/list-job-level"
                                element={<ManageJobLevel />}
                            />
                            <Route
                                path="/edit-job-level/:id"
                                element={<AddJobLevel />}
                            />
                            <Route
                                path="/add-work-type"
                                element={<AddWorkType />}
                            />
                            <Route
                                path="/list-work-type"
                                element={<ManageWorkType />}
                            />
                            <Route
                                path="/edit-work-type/:id"
                                element={<AddWorkType />}
                            />
                            <Route
                                path="/add-salary-type"
                                element={<AddSalaryType />}
                            />
                            <Route
                                path="/list-salary-type"
                                element={<ManageSalaryType />}
                            />
                            <Route
                                path="/edit-salary-type/:id"
                                element={<AddSalaryType />}
                            />
                            <Route
                                path="/add-exp-type"
                                element={<AddExpType />}
                            />
                            <Route
                                path="/list-exp-type"
                                element={<ManageExpType />}
                            />
                            <Route
                                path="/edit-exp-type/:id"
                                element={<AddExpType />}
                            />
                            <Route
                                path="/add-package-post"
                                element={<AddpackagePost />}
                            />
                            <Route
                                path="/list-package-post"
                                element={<ManagePackagePost />}
                            />
                            <Route
                                path="/edit-package-post/:id"
                                element={<AddpackagePost />}
                            />
                            <Route
                                path="/add-package-cv"
                                element={<AddpackageCv />}
                            />
                            <Route
                                path="/list-package-cv"
                                element={<ManagePackageCv />}
                            />
                            <Route
                                path="/edit-package-cv/:id"
                                element={<AddpackageCv />}
                            />
                            <Route
                                path="/add-company"
                                element={<AddCompany />}
                            />
                            <Route
                                path="/edit-company"
                                element={<AddCompany />}
                            />
                            <Route
                                path="/edit-company-admin/:id"
                                element={<AddCompany />}
                            />
                            <Route
                                path="/recruitment"
                                element={<Recruitment />}
                            />
                            <Route
                                path="/list-employer"
                                element={<ManageEmployer />}
                            />
                            <Route path="/add-post" element={<AddPost />} />
                            <Route
                                path="/edit-post/:id"
                                element={<AddPost />}
                            />
                            <Route path="/list-post" element={<ManagePost />} />
                            <Route
                                path="/list-post/:id"
                                element={<ManagePost />}
                            />
                            <Route path="/buy-post" element={<BuyPost />} />
                            <Route
                                path="/payment/success"
                                element={<PaymentSuccess />}
                            />
                            <Route path="/buy-cv" element={<BuyCv />} />
                            <Route
                                path="/paymentCv/success"
                                element={<PaymentSuccessCv />}
                            />
                            <Route
                                path="/list-post-admin"
                                element={<ManagePost />}
                            />
                            <Route path="/list-cv/:id" element={<ManageCv />} />
                            <Route
                                path="/list-candiate"
                                element={<FilterCv />}
                            />
                            <Route
                                path="/candiate/:id"
                                element={<DetailFilterUser />}
                            />
                            <Route path="/note/:id" element={<NotePost />} />
                            <Route path="/user-cv/:id" element={<UserCv />} />
                            <Route
                                path="/changepassword"
                                element={<ChangePassword />}
                            />
                            <Route path="/user-info" element={<UserInfo />} />
                            <Route
                                path="/list-company-admin"
                                element={<ManageCompany />}
                            />
                            <Route
                                path="/history-post"
                                element={<HistoryTradePost />}
                            />
                            <Route
                                path="/history-cv"
                                element={<HistoryTradeCv />}
                            />
                            <Route
                                path="/sum-by-year-post"
                                element={<ChartPost />}
                            />
                            <Route
                                path="/sum-by-year-cv"
                                element={<ChartCv />}
                            />
                            <Route path="*" element={<Navigate to="/admin/" replace />} />
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
