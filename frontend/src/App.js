import { reconcilePushSession } from './push/webPush';
import { getAccessToken, forgetAccess } from './auth/authClient';
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
    BrowserRouter as Router,
    Routes,
    Route,
} from "react-router-dom";
import Header from "./container/header/header";
import Footer from "./container/footer/Footer";
import Home from "./container/home/home";
import JobPage from "./container/JobPage/JobPage";
import { JobNavigationScroll } from './container/JobPage/jobSearchHistory';
import DetailPage from "./container/JobDetail/JobDetail";
import About from "./container/About/About";
import Contact from "./container/Contact/Contact";
import Login from "./container/login/Login";
import Register from "./container/login/Register";
import ForgetPassword from "./container/login/ForgetPassword";
import ListCompany from "./container/Company/ListCompany";
import DetailCompany from "./container/Company/DetailCompany";
import ChatPage from "./container/Chat/ChatPage";
import NotFound from "./container/NotFound/NotFound";
import Forbidden from "./container/Forbidden/Forbidden";
import { readJsonStorage } from "./util/storage";
import RouteGuard from "./auth/RouteGuard";
import { PERMISSIONS } from "./auth/accessControl";
import { getCurrentAuthorizationService } from "./service/userService";
import SessionContext from "./auth/SessionContext";
import { SESSION_ENDED_EVENT } from "./auth/sessionExpiry";
const SupportChat = lazy(() => import('./components/support/SupportChat'));
const SupportHelp = lazy(() => import('./components/support/SupportHelp'));

// Khu quan tri va khu ung vien keo theo nhieu bieu do, trinh sua va form lon.
// Chi tai cac goi nay khi nguoi dung thuc su vao dung khu vuc.
const HomeAdmin = lazy(() => import("./container/system/HomeAdmin"));
const HomeCandidate = lazy(() => import("./container/Candidate/HomeCandidate"));
const SecuritySettings = lazy(() => import('./auth/SecuritySettings'));

const RoutePageLoader = () => (
    <main className="route-page-loader" role="status" aria-live="polite">
        Đang tải giao diện...
    </main>
);

function App() {
    useEffect(()=>{reconcilePushSession();},[]);
    const initialSession = useRef({
        user: readJsonStorage("userData"),
        hasToken: Boolean(localStorage.getItem("token_user")),
    });
    const [userData, setUserData] = useState(initialSession.current.user);
    const [hasToken, setHasToken] = useState(initialSession.current.hasToken);
    const legacyCompanySession = Boolean(
        hasToken
        && userData
        && ["COMPANY", "EMPLOYER"].includes(userData.roleCode)
        && userData.companyId
        && (!userData.companyStatusCode || !userData.companyCensorCode)
    );
    const [authorizationReady, setAuthorizationReady] = useState(!hasToken && !legacyCompanySession);
    const [authorizationError, setAuthorizationError] = useState(false);

    useEffect(() => {
        const ended = () => { setUserData(null); setHasToken(false); setAuthorizationReady(true); };
        const onStorage = event => {
            if (event.key !== 'token_user' && event.key !== null) return;
            forgetAccess();
            if (!event.newValue) ended();
            else window.location.reload(); // a different tab signed into another account
        };
        window.addEventListener(SESSION_ENDED_EVENT, ended);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(SESSION_ENDED_EVENT, ended);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    useEffect(() => {
        let active = true;
        const storedUser = initialSession.current.user;
        const requestToken = localStorage.getItem('token_user');

        if (!initialSession.current.hasToken) {
            setAuthorizationReady(true);
            return () => { active = false; };
        }

        const refreshAuthorization = async () => {
            try {
                await getAccessToken();
                const response = await getCurrentAuthorizationService();
                if (!active || localStorage.getItem('token_user') !== requestToken) return;

                if (response?.errCode === 0 && response.data) {
                    const refreshedUser = {
                        ...storedUser,
                        id: response.data.userId,
                        roleCode: response.data.roleCode,
                        companyId: response.data.companyId,
                        companyStatusCode: response.data.companyStatusCode,
                        companyCensorCode: response.data.companyCensorCode,
                    };
                    localStorage.setItem("userData", JSON.stringify(refreshedUser));
                    setUserData(refreshedUser);
                } else if (localStorage.getItem('token_user') === requestToken) setAuthorizationError(true);
            } catch {
                if (active && localStorage.getItem('token_user') === requestToken) setAuthorizationError(true);
            } finally {
                if (active) setAuthorizationReady(true);
            }
        };

        refreshAuthorization();
        return () => { active = false; };
    }, []);

    if (!authorizationReady) {
        return (
            <main className="container py-5 text-center" role="status">
                Đang xác minh quyền truy cập...
            </main>
        );
    }

    if (authorizationError && hasToken) return <main className="container py-5" role="alert">
        Không thể xác minh quyền truy cập lúc này. Vui lòng kiểm tra kết nối.
        <button className="btn btn-primary ml-3" onClick={() => window.location.reload()}>Thử lại</button>
    </main>;
    return (
        <SessionContext.Provider value={userData}>
            <Router>
                <JobNavigationScroll />
                <Routes>
                <Route path="/account/security" element={<RouteGuard user={userData} hasToken={hasToken} anyPermissions={[PERMISSIONS.MANAGE_PROFILE]}><Header /><Suspense fallback={<RoutePageLoader />}><SecuritySettings /></Suspense><Footer /></RouteGuard>} />
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
                        <div className="jf-login-page">
                            <Header />
                            <Login />
                            <footer className="jf-login-page__footer">© {new Date().getFullYear()} JobFind</footer>
                        </div>
                    }
                />
                <Route
                    path="/register"
                    element={
                        <div className="jf-login-page">
                            <Header />
                            <Register />
                            <footer className="jf-login-page__footer">© {new Date().getFullYear()} JobFind</footer>
                        </div>
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
                            <Suspense fallback={<RoutePageLoader />}>
                                <HomeAdmin user={userData} />
                            </Suspense>
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
                                <Suspense fallback={<RoutePageLoader />}>
                                    <HomeCandidate />
                                </Suspense>
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
                <Route path="/support/chat" element={<RouteGuard user={userData} hasToken={hasToken} anyPermissions={[PERMISSIONS.SUPPORT_USE]}><Header /><ChatPage /><Footer /></RouteGuard>} />
                <Route path="/support/chat/:partnerId" element={<RouteGuard user={userData} hasToken={hasToken} anyPermissions={[PERMISSIONS.SUPPORT_USE]}><Header /><ChatPage /><Footer /></RouteGuard>} />
                <Route path="/support/help" element={<SupportHelp />} />
                <Route path="*" element={<NotFound />} />
                </Routes>
                <Suspense fallback={null}><SupportChat /></Suspense>
            </Router>
        </SessionContext.Provider>
    );
}

export default App;
