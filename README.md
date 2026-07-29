# DALN JobFind — Website tìm việc làm

## Cấu trúc dự án

- `backend/` — API Node.js/Express + Sequelize (MySQL), kèm script nạp dữ liệu mẫu.
- `frontend/` — giao diện React.
- `database/jobfindtest.sql` — **dữ liệu mẫu đầy đủ**: dữ liệu gốc từ `JobFindResourceV2_1`
  (tài khoản, công ty, tin tuyển dụng, kỹ năng, CV...) **đã bổ sung** 4 bảng mới của DALN
  (`chatmessages`, `companyreviews`, `favoriteposts`, `followcompanies`) cùng dữ liệu mẫu
  cho tính năng chat, đánh giá công ty, lưu tin, theo dõi công ty và thông báo.

## Yêu cầu

- Node.js (khuyến nghị bản LTS)
- MySQL hoặc MariaDB (XAMPP đều dùng được)

## Các bước chạy dự án

### 1. Cấu hình

Mở `backend/.env` và kiểm tra thông tin MySQL (mặc định đã điền sẵn cho XAMPP):

```env
DB_HOST=127.0.0.1
DB_PORT=3333        # đang để 3333 theo XAMPP trên máy này; MySQL mặc định là 3306
DB_NAME=jobfindtest
DB_USER=root
DB_PASSWORD=
```

### 2. Nạp dữ liệu mẫu (xem chi tiết tại [RESTORE_SAMPLE_DATA.md](RESTORE_SAMPLE_DATA.md))

```powershell
cd backend
npm install
$env:CONFIRM_RESTORE_SAMPLE_DATA='true'
npm run restore:sample-data
```

Lệnh này tạo database `jobfindtest` với toàn bộ dữ liệu mẫu và tự tạo 3 tài khoản test.

### 3. Chạy API (backend, cổng 5000)

```powershell
cd backend
npm start
```

### 4. Chạy giao diện (frontend, cổng 3000)

```powershell
cd frontend
npm install
npm start
```

Mở http://localhost:3000

## Tài khoản đăng nhập

**Toàn bộ tài khoản trong dữ liệu demo đều dùng mật khẩu `123456`.**

### Nhà tuyển dụng (đăng nhập xong vào khu quản trị `/admin`)

| Số điện thoại | Họ tên | Công ty | Số tin đang đăng |
|---------------|--------|---------|------------------|
| `0764188023` | Nguyễn Văn A | Công ty TNHH CMC GLOBAL | 10 |
| `0785095048` | Nguyễn Lê Tấn | Công ty CP Tập đoàn Hoa Sen | 5 |
| `0795095042` | Nguyễn Văn Tài | Babilala | 2 |
| `0795095038` | Nguyễn Lê Tấn Tài | Đất Xanh Miền Trung | 2 |
| `0795095125` | Nguyễn Văn Lộc | Công ty TNHH Thế Giới | 2 |
| `0795095222` | Trần Văn Nghĩa | Công ty CP Tấn Tài | 2 |

### Ứng viên

| Số điện thoại | Họ tên | Số kỹ năng | CV đã nộp |
|---------------|--------|------------|-----------|
| `0764188123` | Trần Thị My | 8 | 1 |
| `0795095768` | Nguyễn Lê Tấn Tài | 6 | 1 |
| `0795095678` | Trần Văn Nghĩa | 6 | 1 |
| `0764088023` | Lê Thị Kim Ảnh | 5 | 1 |
| `0795095789` | Trần Văn Kha | 4 | 1 |
| `0795095041` | Nguyễn Lê Tấn Tài | 2 | 1 |

### Quản trị viên

| Số điện thoại | Họ tên |
|---------------|--------|
| `0795095049` | Nguyễn Lê Tấn Tài |
| `0795095000` | Nguyễn Văn ADMIN |

### Tài khoản test riêng (không nằm trong dữ liệu gốc)

| Số điện thoại | Vai trò | userId |
|---------------|---------|--------|
| `0900000001` | ADMIN | 9001 |
| `0900000002` | COMPANY (gắn công ty CMC GLOBAL) | 9002 |
| `0900000003` | CANDIDATE | 9003 |

Ba tài khoản này dùng id riêng 9001–9003 nên không đụng vào bản ghi nào của dữ
liệu gốc. Tạo lại bằng `npm run seed:demo-data` / `npm run seed:test-accounts`.

## Chat realtime (Socket.IO)

Nhắn tin giữa ứng viên và nhà tuyển dụng chạy realtime bằng Socket.IO, dùng
**chung cổng 5000** với API — không cần cấu hình hay mở thêm cổng.

- Kết nối yêu cầu token JWT; `senderId` lấy từ token nên không thể mạo danh.
- Có báo "đang soạn tin nhắn...", chấm xanh báo đang kết nối trực tiếp, badge tin
  chưa đọc cập nhật tức thì ở cả header người dùng lẫn menu quản trị.
- Nếu socket không kết nối được, giao diện **tự động quay về gọi API REST như cũ**
  nên chat vẫn dùng được bình thường.

### Demo đúng luồng thật (khuyến nghị)

Mở 2 trình duyệt, một cái để ẩn danh:

1. **Cửa sổ 1 — ứng viên:** đăng nhập `0795095768`, vào **Việc làm**, mở tin
   *"Lập trình viên Reactjs"* của Babilala, bấm **"Nhắn tin cho nhà tuyển dụng"**.
   Hội thoại có sẵn 5 tin nhắn mẫu, nhắn tiếp bình thường.
2. **Cửa sổ 2 — nhà tuyển dụng:** đăng nhập `0795095042` (chính người đăng tin
   đó), bấm **"Tin nhắn"** ở menu trái. Tin nhắn hiện ngay, không cần tải lại trang.

Nhà tuyển dụng này cũng có sẵn **2 CV ứng tuyển** để xem ở mục quản lý CV, kèm
điểm độ khớp kỹ năng chấm từ nội dung file PDF thật.

## Dữ liệu demo có sẵn

| Bảng | Số dòng | Ghi chú |
|------|---------|---------|
| Tài khoản / người dùng | 38 | tất cả đăng nhập được bằng `123456` |
| Công ty | 17 | |
| Tin tuyển dụng | 41 | |
| CV ứng tuyển | 6 | kèm file PDF thật, chấm được độ khớp kỹ năng |
| Tin nhắn chat | 22 | 6 cuộc trò chuyện ứng viên ↔ đúng người đăng tin |
| Thông báo | 7 | |
| Đánh giá công ty | 10 | |
| Tin đã lưu / theo dõi công ty | 7 / 6 | |
| Kỹ năng / kỹ năng ứng viên | 41 / 31 | |

## Ghi chú

- Backend chạy mặc định cổng `5000`, frontend gọi API qua `frontend/.env`
  (`REACT_APP_BACKEND_URL=http://localhost:5000`).
- Tính năng gửi mail gợi ý việc làm cần điền `EMAIL_APP` / `EMAIL_APP_PASSWORD`
  (Gmail App Password) trong `backend/.env`; không điền thì các tính năng khác vẫn chạy bình thường.
- Thanh toán gói tin/CV dùng PayPal Sandbox với key có sẵn trong `backend/.env`.
