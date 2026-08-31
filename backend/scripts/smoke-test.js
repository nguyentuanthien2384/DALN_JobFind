const baseUrl = process.env.API_BASE_URL || "http://localhost:5000";
const candidatePhone = process.env.SMOKE_CANDIDATE_PHONE || "0764188123";
const adminPhone = process.env.SMOKE_ADMIN_PHONE || "0795095049";
// Tai khoan nha tuyen dung co cong ty, dung de kiem tra ranh gioi giua cac cong ty.
const employerPhone = process.env.SMOKE_EMPLOYER_PHONE || "0795095042";
const password = process.env.SMOKE_PASSWORD || "123456";

const failures = [];

async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, options);
    let body;
    try {
        body = await response.json();
    } catch (error) {
        body = {};
    }
    return { response, body };
}

async function login(phone, label) {
    const { response, body } = await request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phonenumber: phone, password }),
    });

    if (!response.ok || body.errCode !== 0 || !body.token) {
        throw new Error(`${label}: không thể đăng nhập`);
    }
    return body;
}

function check(name, condition) {
    if (condition) {
        console.log(`PASS  ${name}`);
    } else {
        console.error(`FAIL  ${name}`);
        failures.push(name);
    }
}

function section(title) {
    console.log(`\n--- ${title} ---`);
}

async function run() {
    console.log(`Kiểm tra API tại ${baseUrl}`);
    const candidate = await login(candidatePhone, "Ứng viên");
    const admin = await login(adminPhone, "Quản trị viên");
    const employer = await login(employerPhone, "Nhà tuyển dụng");

    const candidateHeaders = { Authorization: `Bearer ${candidate.token}`, "Content-Type": "application/json" };
    const adminHeaders = { Authorization: `Bearer ${admin.token}` };
    const employerHeaders = { Authorization: `Bearer ${employer.token}` };
    const employerCompanyId = employer.user.companyId;

    section("Chức năng cơ bản");

    const publicPosts = await request("/api/get-filter-post?limit=6&offset=0");
    check("Danh sách việc làm công khai", publicPosts.response.ok && publicPosts.body.errCode === 0);

    const conversations = await request("/api/get-list-chat-conversation", { headers: candidateHeaders });
    check("Danh sách hội thoại cần đăng nhập", conversations.response.ok && conversations.body.errCode === 0);

    const adminCompanies = await request("/api/get-all-company?limit=5&offset=0", { headers: adminHeaders });
    check("Dữ liệu quản trị", adminCompanies.response.ok && adminCompanies.body.errCode === 0);

    const myCv = await request("/api/get-all-cv-by-userId?limit=5&offset=0", { headers: candidateHeaders });
    check("Ứng viên xem được lịch sử ứng tuyển của mình", myCv.response.ok && myCv.body.errCode === 0);

    const myNotification = await request("/api/get-notification-by-user?limit=5&offset=0", { headers: candidateHeaders });
    check("Ứng viên xem được thông báo của mình", myNotification.response.ok && myNotification.body.errCode === 0);

    section("Nhà tuyển dụng vẫn dùng được tính năng của mình");

    const candidateSearch = await request("/api/fillter-cv-by-selection?limit=3&offset=0", { headers: employerHeaders });
    check("Nhà tuyển dụng tìm được ứng viên", candidateSearch.response.ok && candidateSearch.body.errCode === 0);

    const companyPosts = await request(
        `/api/get-list-post-admin?companyId=${employerCompanyId}&limit=5&offset=0&search=&censorCode=`,
        { headers: employerHeaders }
    );
    check("Nhà tuyển dụng xem được tin của công ty mình", companyPosts.response.ok && companyPosts.body.errCode === 0);

    const companyStat = await request(
        `/api/get-statistical-cv?companyId=${employerCompanyId}&fromDate=2024-01-01&toDate=2030-12-31&limit=5&offset=0`,
        { headers: employerHeaders }
    );
    check("Nhà tuyển dụng xem được thống kê công ty mình", companyStat.response.ok && companyStat.body.errCode === 0);

    section("Phân quyền và bảo vệ dữ liệu");

    const deniedAdmin = await request("/api/get-all-company?limit=5&offset=0", { headers: candidateHeaders });
    check("Ứng viên không truy cập được dữ liệu quản trị", !deniedAdmin.response.ok);

    const deniedUserList = await request("/api/get-all-user?limit=5&offset=0", { headers: candidateHeaders });
    check("Ứng viên không liệt kê được toàn bộ người dùng", !deniedUserList.response.ok);

    const anotherUserId = Number(candidate.user.id) === 1 ? 2 : 1;
    const deniedProfile = await request("/api/update-user", {
        method: "PUT",
        headers: candidateHeaders,
        body: JSON.stringify({ id: anotherUserId }),
    });
    check("Không thể sửa hồ sơ của người khác", deniedProfile.response.status === 403);

    const deniedSettings = await request("/api/setDataUserSetting", {
        method: "PUT",
        headers: candidateHeaders,
        body: JSON.stringify({ id: anotherUserId, data: {} }),
    });
    check("Không thể sửa cài đặt của người khác", deniedSettings.response.status === 403);

    const deniedReadProfile = await request(`/api/get-detail-user-by-id?id=${anotherUserId}`, { headers: candidateHeaders });
    check("Ứng viên không đọc được hồ sơ người khác", deniedReadProfile.response.status === 403);

    section("Hồ sơ ứng tuyển không bị lộ");

    const publicCvList = await request("/api/get-all-list-cv-by-post?postId=1&limit=5&offset=0");
    check("Khách vãng lai không xem được hồ sơ ứng tuyển", publicCvList.response.status === 401);

    const publicCvSearch = await request("/api/fillter-cv-by-selection?limit=3&offset=0");
    check("Khách vãng lai không tìm được kho ứng viên", publicCvSearch.response.status === 401);

    const candidateCvSearch = await request("/api/fillter-cv-by-selection?limit=3&offset=0", { headers: candidateHeaders });
    check("Ứng viên không dùng được tính năng tìm ứng viên trả phí", candidateCvSearch.response.status === 403);

    const candidateBurnQuota = await request("/api/check-see-candiate?userId=14&companyId=null", { headers: candidateHeaders });
    check("Ứng viên không đốt được lượt xem CV của công ty", candidateBurnQuota.response.status === 403);

    const crossCompanyStat = await request(
        "/api/get-statistical-cv?companyId=99999&fromDate=2024-01-01&toDate=2030-12-31&limit=5&offset=0",
        { headers: employerHeaders }
    );
    const tenantPinned = crossCompanyStat.response.ok
        && crossCompanyStat.body.errCode === 0
        && crossCompanyStat.body.count === companyStat.body.count
        && JSON.stringify(crossCompanyStat.body.data) === JSON.stringify(companyStat.body.data);
    check("companyId giả mạo bị bỏ qua và dữ liệu vẫn khóa theo công ty đăng nhập", tenantPinned);

    section("Đăng ký và đặt lại mật khẩu");

    const escalate = await request("/api/create-new-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            phonenumber: "0900111222",
            password: "123456",
            firstName: "Test",
            lastName: "Escalation",
            roleCode: "ADMIN",
            email: "test@example.com",
        }),
    });
    check("Không tự đăng ký được tài khoản quản trị", escalate.body.errCode === 3);

    const resetNoOtp = await request("/api/changepasswordbyPhone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phonenumber: adminPhone, password: "hacked123" }),
    });
    check("Không đổi được mật khẩu khi thiếu mã xác thực", resetNoOtp.body.errCode !== 0);

    const resetWrongOtp = await request("/api/changepasswordbyPhone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phonenumber: adminPhone, password: "hacked123", otp: "000000" }),
    });
    check("Không đổi được mật khẩu với mã xác thực sai", resetWrongOtp.body.errCode !== 0);

    if (failures.length) {
        console.error(`\nKhông đạt: ${failures.join(", ")}`);
        process.exitCode = 1;
        return;
    }

    console.log("\nTất cả kiểm tra nhanh đều đạt.");
}

run().catch((error) => {
    console.error(`Không thể chạy kiểm tra: ${error.message}`);
    process.exitCode = 1;
});
