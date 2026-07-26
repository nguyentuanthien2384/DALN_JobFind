import React from "react";
import { Routes, Route } from "react-router-dom";
import UserCv from "../system/Cv/UserCv";
import ChangePassword from "../system/User/ChangePassword";
import CandidateInfo from "./CandidateInfo";
import ManageCvCandidate from "./ManageCvCandidate";
import SettingUser from "./SettingUser";
import SavedJobs from "./SavedJobs";

const HomeCandidate = () => {
    return (
        <div className="container-scroller">
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
                        style={{ marginLeft: "9%" }}
                    >
                        <Routes>
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
