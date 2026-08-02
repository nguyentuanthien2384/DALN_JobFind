import React from "react";
import { Link } from "react-router-dom";

const NotFound = () => (
    <main className="container" style={{ minHeight: "55vh", paddingTop: "130px", textAlign: "center" }}>
        <h1 style={{ fontSize: "72px", color: "#4B49AC", marginBottom: "8px" }}>404</h1>
        <h3>Không tìm thấy trang bạn yêu cầu</h3>
        <p style={{ color: "#6c7383", margin: "16px 0 26px" }}>
            Đường dẫn có thể đã thay đổi hoặc không còn tồn tại.
        </p>
        <Link to="/" className="btn head-btn1">Về trang chủ</Link>
    </main>
);

export default NotFound;
