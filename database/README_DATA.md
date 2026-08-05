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

3. **Phần mở rộng microservices** (mục `PHAN MO RONG CHO HE THONG MICROSERVICES`):
   bảng `ai_tasks` — chỗ hẹn gặp giữa người dùng và AI Worker. Các tính năng AI chạy
   bất đồng bộ: API trả về ngay một `taskId`, AI Worker xử lý xong mới ghi kết quả
   vào đây. Bảng này do `job-core-service` tự tạo lúc khởi động, giữ trong dump để
   file phản ánh đúng schema thực tế.

4. **Phần đồng bộ dữ liệu phát sinh** (mục `DONG BO DU LIEU PHAT SINH`): 3 tài khoản
   kiểm thử (`0900000001/2/3`, mật khẩu `123456`) do `backend/scripts/create-test-accounts.js`
   tạo, cộng vài bản ghi phát sinh khi dùng thử. Tất cả dùng `ON DUPLICATE KEY UPDATE`
   nên nạp lại nhiều lần không bị trùng.

5. **Phần cập nhật giá trị** (mục `CAP NHAT GIA TRI NGUOI DUNG DA SUA`): các thay đổi
   phát sinh khi dùng hệ thống mà `INSERT` không diễn tả được — đổi thông tin cá nhân,
   duyệt công ty, đăng lại tin, đọc tin nhắn. Đều là `UPDATE` theo khóa chính nên
   chạy lại bao nhiêu lần cũng cho cùng kết quả.

Các ID trong dữ liệu mẫu mới đều tham chiếu đến bản ghi có thật trong phần gốc
(user 5/9/30/31/33 là ứng viên, company 6–22, các post trạng thái đang hiển thị `PS1`).

> **Mã băm mật khẩu không khớp là bình thường.** bcrypt sinh muối ngẫu nhiên, nên
> cùng một mật khẩu `123456` vẫn cho hai chuỗi băm khác nhau giữa file và CSDL.
> Đừng coi đó là dữ liệu lệch — hãy so bằng `bcrypt.compare`, đừng so chuỗi.

## Các bảng KHÔNG nằm trong file này

Hệ thống microservices dùng thêm hai cơ sở dữ liệu riêng, **không** thuộc dump MySQL:

| CSDL | Bảng / collection | Service sở hữu |
|---|---|---|
| PostgreSQL | `applications`, `application_events`, `application_notes`, `talent_pool` | Application & Workflow |
| MongoDB | hồ sơ + CV Builder, nhật ký hoạt động, master data mở rộng | Identity, Admin & Reporting |

Tất cả đều tự tạo khi service khởi động, nên không cần nạp tay.

## Đồng bộ lại file khi dữ liệu thay đổi

```bash
# 1. Nạp file hiện tại vào một CSDL đối chiếu
mysql -u root -P 3333 -e "CREATE DATABASE jobfind_verify CHARACTER SET utf8mb4"
mysql -u root -P 3333 --default-character-set=utf8mb4 jobfind_verify < database/jobfindtest.sql

# 2. Sinh các bản ghi CSDL thật đang có mà file chưa có
cd backend && node scripts/sync-sql-dump.js jobfind_verify
# -> ghi ra database/sync-append.sql, nối vào trước dòng COMMIT; cuối file
```

Bước 2 chỉ tìm **dòng thiếu**. Giá trị đã sửa trong dòng có sẵn thì nó không thấy —
muốn bắt cả loại đó phải so từng ô giữa `jobfindtest` và `jobfind_verify`, bỏ qua
cột `password` vì lý do nói ở trên.

## Chạy kiểm thử không làm bẩn dữ liệu

`microservices/scripts/smoke-test.js` tạo tin tuyển dụng thật, nộp CV thật và sinh
thông báo thật — tất cả ghi thẳng vào `jobfindtest`. `scripts/test-fixture.js` chụp
ảnh CSDL trước khi chạy và trả lại nguyên trạng sau khi xong, **kể cả khi kiểm thử
thất bại giữa chừng**: xóa các bản ghi mang tiền tố `Kiem Thu `, trả các ô đếm gói
dịch vụ (`allowPost`, `allowCV`, `allowCvFree`) về đúng giá trị cũ, dọn cả bản sao
bên Elasticsearch và PostgreSQL. Chạy xong đối chiếu lại vẫn khớp 100%.

> Đừng dùng `mysqldump` hoặc `mysql` CLI để xuất trên Windows: chúng xuất theo
> codepage của console và làm hỏng tiếng Việt (`Tài khoản` thành `T?i kho?n`).
> Script trên đọc bằng driver rồi tự ghi UTF-8 nên giữ nguyên dấu.

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
