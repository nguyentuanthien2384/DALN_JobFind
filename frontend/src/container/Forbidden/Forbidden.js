import React from "react";
import { Link } from "react-router-dom";
import { getDefaultRouteForUser } from "../../auth/accessControl";
import { readJsonStorage } from "../../util/storage";

const Forbidden = () => {
    const user = readJsonStorage("userData");
    const returnPath = getDefaultRouteForUser(user);

    return (
        <main className="container py-5" style={{ minHeight: "55vh" }}>
            <div className="card border-0 shadow-sm mx-auto" style={{ maxWidth: "680px" }}>
                <div className="card-body text-center p-5" role="alert">
                    <div className="display-4 font-weight-bold text-danger" aria-hidden="true">403</div>
                    <h1 className="h3 mt-3">Bạn không có quyền truy cập</h1>
                    <p className="text-muted mt-3">
                        Tài khoản hiện tại không được cấp quyền sử dụng chức năng này.
                        Nếu bạn cho rằng đây là nhầm lẫn, hãy liên hệ quản trị viên.
                    </p>
                    <div className="mt-4">
                        <Link className="btn btn-primary mr-2" to={returnPath}>
                            Về khu vực của tôi
                        </Link>
                        <Link className="btn btn-outline-secondary" to="/">
                            Về trang chủ
                        </Link>
                    </div>
                </div>
            </div>
        </main>
    );
};

export default Forbidden;
