# Dữ liệu mẫu cho DALN JobFind

Thư mục này chứa `jobfindtest.sql` — file dump **đầy đủ dữ liệu mẫu** của dự án.

## Nguồn gốc và nội dung

1. **Phần gốc** (đầu file): dump nguyên bản từ `JobFindResourceV2_1.zip` gồm 17 bảng —
   `accounts`, `allcodes`, `companies`, `cvs`, `detailposts`, `notes`, `notifications`,
   `orderpackagecvs`, `orderpackages`, `packagecvs`, `packageposts`, `posts`,
   `sequelizemeta`, `skills`, `users`, `usersettings`, `userskills` — với đầy đủ
   dữ liệu: 35+ người dùng, 17 công ty, 40+ tin tuyển dụng, kỹ năng, CV, gói dịch vụ,
   lịch sử giao dịch.

2. **Phần mở rộng DALN** (cuối file, mục `PHAN MO RONG CHO DU AN DALN`): được bổ sung
   để khớp với schema mới của dự án —
   - 4 bảng mới: `chatmessages` (chat ứng viên ↔ nhà tuyển dụng), `companyreviews`
     (đánh giá công ty), `favoriteposts` (lưu tin), `followcompanies` (theo dõi công ty),
     kèm chỉ mục, khóa chính, AUTO_INCREMENT và **dữ liệu mẫu tiếng Việt** cho từng bảng.
   - 2 cột mới `content`, `link` cho bảng `notifications` + các thông báo mẫu.
   - Cập nhật `sequelizemeta`: đánh dấu toàn bộ migration trong
     `backend/src/migrations/` là đã chạy, nên import xong **không cần chạy
     `db:migrate`** và có chạy cũng không lỗi.

Các ID trong dữ liệu mẫu mới đều tham chiếu đến bản ghi có thật trong phần gốc
(user 5/9/30/31/33 là ứng viên, company 6–22, các post trạng thái đang hiển thị `PS1`).

## Cách nạp

Xem hướng dẫn chi tiết tại [`../RESTORE_SAMPLE_DATA.md`](../RESTORE_SAMPLE_DATA.md).
Ngắn gọn: từ thư mục `backend/` chạy

```powershell
npm install
$env:CONFIRM_RESTORE_SAMPLE_DATA='true'
npm run restore:sample-data
```

hoặc import thủ công qua phpMyAdmin rồi chạy `npm run seed:test-accounts`.

## Tài khoản test (mật khẩu `123456`)

`0900000001` (ADMIN) · `0900000002` (COMPANY) · `0900000003` (CANDIDATE)
