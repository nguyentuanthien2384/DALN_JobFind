# JobFind Authentication + Google SSO — CHỈ NHỮNG FILE THAY ĐỔI

Source gốc: DALN_JobFind-main(3).zip (bản bạn gửi). Gói này KHÔNG chứa toàn bộ dự án.

1. Sao lưu source + DB. Giải nén gói này đè vào THƯ MỤC GỐC dự án. Đường dẫn backend/, frontend/, microservices/, docs/ giữ nguyên.
2. Đọc **docs/AUTHENTICATION_SSO_INTEGRATION.md** trước khi chạy. Trước khi bật login, tạo đủ 3 bảng qua migration, đảm bảo backend/Gateway dùng cùng MySQL.
3. Cần mạng và Node >=22.12: `cd backend && npm install 'openid-client@^6'`. Gói không mang theo dependency này hoặc lockfile mới (npm registry không khả dụng trong môi trường tạo gói). Phải commit package.json/package-lock.json được npm cập nhật vào chính repo của bạn rồi rebuild.
4. Điền biến từ .env.example vào .env tại từng service. Đăng ký đúng Google OAuth redirect qua GATEWAY; chỉ bật 2 cờ Google sau khi cấu hình thành công. Triển khai trên staging và chạy các test trong tài liệu.
5. Những file không liệt kê trong PATCH_FILE_LIST.txt không cần thay. Không chạy rollback migration để tránh xoá dữ liệu phiên và liên kết SSO.

Tình trạng kiểm thử: đã kiểm tra parse JavaScript/JSX, test độc lập cấu trúc migration và kiểm tra luồng service refresh bằng fake DB. Chưa thể chạy Jest/Vitest, MySQL/Google/browser thực tế trong môi trường này; chưa xác nhận sẵn sàng production.
