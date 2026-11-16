import React, { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import './CandidateLayout.css';

// Load only the current page; editors, charts and PDF tools stay in their own chunks.
const UserCv = lazy(() => import("../system/Cv/UserCv"));
const ChangePassword = lazy(() => import("../system/User/ChangePassword"));
const CandidateInfo = lazy(() => import("./CandidateInfo"));
const ManageCvCandidate = lazy(() => import("./ManageCvCandidate"));
const SettingUser = lazy(() => import("./SettingUser"));
const SavedJobs = lazy(() => import("./SavedJobs"));
const CandidateAi = lazy(() => import("./CandidateAi"));
const NotificationJobs = lazy(() => import("./NotificationJobs"));
const CandidateNotifications = lazy(() => import("./CandidateNotifications"));
const InterviewCalendar = lazy(() => import("../../components/interviews/InterviewCalendar"));
const CandidateAssessmentRunner = lazy(() => import("../../components/Assessment/CandidateAssessmentRunner"));

const PageLoader = () => (
    <div className="route-page-loader" role="status" aria-live="polite">
        Đang tải giao diện...
    </div>
);

const HomeCandidate = () => {
    return (
        <div className="container-scroller candidate-shell">
            {/* partial:partials/_navbar.html */}

            {/* partial */}
            <div className="container-fluid page-body-wrapper">
                {/* partial:partials/_settings-panel.html */}

                {/* partial */}
                {/* partial:partials/_sidebar.html */}

                {/* partial */}
                <div className="main-panel">
                    <div className="content-wrapper">
                        <Suspense fallback={<PageLoader />}>
                        <Routes>
                            <Route path="/interviews" element={<InterviewCalendar candidate />} />
                            <Route path="/assessment/:applicationId" element={<CandidateAssessmentRunner />} />
                            <Route path="/notifications" element={<CandidateNotifications />} />
                            <Route path="/ai-cv" element={<CandidateAi />} />
                            <Route path="/followed-jobs" element={<NotificationJobs source="followed" />} />
                            <Route path="/recommended-jobs" element={<NotificationJobs source="recommended" />} />
                            <Route path="/info" element={<CandidateInfo />} />
                            <Route
                                path="/usersetting"
                                element={<SettingUser />}
                            />
                            <Route
                                path="/changepassword"
                                element={<ChangePassword />}
                            />
                            <Route
                                path="/cv-post"
                                element={<ManageCvCandidate />}
                            />
                            <Route
                                path="/saved-jobs"
                                element={<SavedJobs />}
                            />
                            <Route path="/cv-detail/:id" element={<UserCv />} />
                            <Route path="*" element={<Navigate to="/candidate/info" replace />} />
                        </Routes>
                        </Suspense>
                    </div>
                    {/* content-wrapper ends */}
                    {/* partial:partials/_footer.html */}
                </div>
                {/* main-panel ends */}
            </div>
            {/* page-body-wrapper ends */}
        </div>
    );
};

export default HomeCandidate;
