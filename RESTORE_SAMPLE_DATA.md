# Khôi phục dữ liệu mẫu

File `database/jobfindtest.sql` là dữ liệu mẫu nguyên gốc từ `JobFindResourceV2.1.zip`.

1. Mở `backend/.env` và điền thông tin MySQL:

   ```env
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_NAME=jobfindtest
   DB_USER=root
   DB_PASSWORD=mat-khau-mysql-cua-ban
   ```

2. Chạy lệnh sau từ thư mục `backend`:

   ```powershell
   $env:CONFIRM_RESTORE_SAMPLE_DATA='true'
   npm run restore:sample-data
   ```

Lệnh này xóa database `jobfindtest` cũ rồi nạp lại toàn bộ tài khoản, công ty, tin tuyển dụng, kỹ năng và các dữ liệu mẫu từ file SQL. Sao lưu database hiện tại nếu bạn có dữ liệu cần giữ.

Trên máy này, MySQL của XAMPP dùng cổng `3333`; cổng `3306` đang được một MySQL Server khác sử dụng.
