import React, { useState } from "react";
import { readJsonStorage } from "../../util/storage";
import AdminDashboard from "./Dashboard/AdminDashboard";
import CompanyDashboard from "./Dashboard/CompanyDashboard";

// Trang tong quan cua khu quan tri: quan tri vien xem so lieu toan he thong,
// nha tuyen dung xem so lieu cua cong ty minh.
const Home = () => {
    const [user] = useState(() => readJsonStorage("userData", {}) || {});
    return user.roleCode === "ADMIN" ? <AdminDashboard user={user} /> : <CompanyDashboard user={user} />;
};

export default Home;
