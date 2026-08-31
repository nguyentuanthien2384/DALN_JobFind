import React from "react";
import {
    BrowserRouter as Router,
    Routes,
    Route,
} from "react-router-dom";
import Header from "./container/header/header";
import Footer from "./container/footer/Footer";
import Home from "./container/home/home";
import JobPage from "./container/JobPage/JobPage";
import DetailPage from "./container/JobDetail/JobDetail";
import About from "./container/About/About";
import Contact from "./container/Contact/Contact";
import HomeAdmin from "./container/system/HomeAdmin";
import Login from "./container/login/Login";
import Register from "./container/login/Register";
import ForgetPassword from "./container/login/ForgetPassword";
import HomeCandidate from "./container/Candidate/HomeCandidate";
import ListCompany from "./container/Company/ListCompany";
import DetailCompany from "./container/Company/DetailCompany";
import ChatPage from "./container/Chat/ChatPage";
import NotFound from "./container/NotFound/NotFound";
import Forbidden from "./container/Forbidden/Forbidden";
import { readJsonStorage } from "./util/storage";
import RouteGuard from "./auth/RouteGuard";
import { PERMISSIONS } from "./auth/accessControl";

function App() {
    const userData = readJsonStorage("userData");
    const hasToken = Boolean(localStorage.getItem("token_user"));

    return (
        <Router>
            <Routes>
                {/* Public Routes */}
                <Route
                    path="/"
                    element={
                        <>
                            <Header />
                            <Home />
                            <Footer />
                        </>
                    }
                />
                <Route
                    path="/about"
                    element={
                        <>
                            <Header />
                            <About />
                            <Footer />
                        </>
                    }
                />
                <Route
                    path="/contact"
                    element={
                        <>
                            <Header />
                            <Contact />
                            <Footer />
                        </>
                    }
                />
                <Route
                    path="/job"
                    element={
                        <>
                            <Header />
                            <JobPage />
                            <Footer />
                        </>
                    }
                />
                <Route
                    path="/company"
                    element={
                        <>
                            <Header />
                            <ListCompany />
                            <Footer />
                        </>
                    }
                />
                <Route
                    path="/detail-company/:id"
                    element={
                        <>
                            <Header />
                            <DetailCompany />
                            <Footer />
                        </>
                    }
                />
                <Route
                    path="/detail-job/:id"
                    element={
                        <>
                            <Header />
                            <DetailPage />
                            <Footer />
                        </>
                    }
                />

                <Route
                    path="/chat"
                    element={
                        <RouteGuard
                            user={userData}
                            hasToken={hasToken}
                            anyPermissions={[PERMISSIONS.USE_CHAT]}
                        >
                            <>
                                <Header />
                                <ChatPage />
                                <Footer />
                            </>
                        </RouteGuard>
                    }
                />
                <Route
                    path="/chat/:partnerId"
                    element={
                        <RouteGuard
                            user={userData}
                            hasToken={hasToken}
                            anyPermissions={[PERMISSIONS.USE_CHAT]}
                        >
                            <>
                                <Header />
                                <ChatPage />
                                <Footer />
                            </>
                        </RouteGuard>
                    }
                />

                {/* Auth Routes */}
                <Route
                    path="/login"
                    element={
                        <>
                            <Header />
                            <Login />
                            <Footer />
                        </>
                    }
                />
                <Route
                    path="/register"
                    element={
                        <>
                            <Header />
                            <Register />
                            <Footer />
                        </>
                    }
                />
                <Route
                    path="/forget-password"
                    element={
                        <>
                            <Header />
                            <ForgetPassword />
                            <Footer />
                        </>
                    }
                />

                {/* Protected Routes */}
                <Route
                    path="/admin/*"
                    element={
                        <RouteGuard
                            user={userData}
                            hasToken={hasToken}
                            anyPermissions={[PERMISSIONS.ACCESS_ADMIN_AREA]}
                        >
                            <HomeAdmin user={userData} />
                        </RouteGuard>
                    }
                />
                <Route
                    path="/candidate/*"
                    element={
                        <RouteGuard
                            user={userData}
                            hasToken={hasToken}
                            anyPermissions={[PERMISSIONS.VIEW_CANDIDATE_AREA]}
                        >
                            <>
                                <Header />
                                <HomeCandidate />
                                <Footer />
                            </>
                        </RouteGuard>
                    }
                />
                <Route
                    path="/forbidden"
                    element={
                        <>
                            <Header />
                            <Forbidden />
                            <Footer />
                        </>
                    }
                />
                <Route path="*" element={<NotFound />} />
            </Routes>
        </Router>
    );
}

export default App;
