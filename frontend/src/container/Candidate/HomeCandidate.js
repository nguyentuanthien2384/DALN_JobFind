import React from "react";
import { Routes, Route, Navigate, useMatch } from "react-router-dom";
import UserCv from "../system/Cv/UserCv";
import ChangePassword from "../system/User/ChangePassword";
import CandidateInfo from "./CandidateInfo";
import ManageCvCandidate from "./ManageCvCandidate";
import SettingUser from "./SettingUser";
import SavedJobs from "./SavedJobs";
import CandidateAi from './CandidateAi';

const HomeCandidate = () => {
    const isAiWorkspace = Boolean(useMatch('/candidate/ai-cv'));
    const isApplicationHistory = Boolean(useMatch('/candidate/cv-post'));
    const isSubmittedCv = Boolean(useMatch('/candidate/cv-detail/:id'));
    const fullWidth = isAiWorkspace || isApplicationHistory || isSubmittedCv;
    return (
        <div className={`container-scroller${fullWidth ? ' candidate-ai-shell' : ''}`}>
            {/* partial:partials/_navbar.html */}

            {/* partial */}
            <div className="container-fluid page-body-wrapper">
                {/* partial:partials/_settings-panel.html */}

                {/* partial */}
                {/* partial:partials/_sidebar.html */}

                {/* partial */}
                <div className="main-panel">
                    <div
                        className="content-wrapper"
                        style={{ marginLeft: fullWidth ? 0 : "9%" }}
                    >
                        <Routes>
                            <Route path="/ai-cv" element={<CandidateAi />} />
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
