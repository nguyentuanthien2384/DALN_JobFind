# Dữ liệu demo Postman

Import lần lượt `JobFind-Demo.postman_environment.json` và
`JobFind-Demo.postman_collection.json`, sau đó chọn environment **JobFind Demo - Local**.

Collection dùng Gateway `http://localhost:4000`. Gateway chuyển API mới tới
microservices và chuyển API cũ tới backend/XAMPP, nên đây là URL phù hợp nhất
để demo kiến trúc đầy đủ.

## Tài khoản dữ liệu gốc

| Vai trò | Số điện thoại | Mật khẩu | ID |
|---|---:|---:|---:|
| Admin | `0795095049` | `123456` | user `1` |
| Nhà tuyển dụng | `0795095042` | `123456` | user `18`, company `12` |
| Ứng viên | `0764188123` | `123456` | user `36` |

## Bản ghi dùng trong Collection

| Dữ liệu | Giá trị |
|---|---|
| Tin React của nhà tuyển dụng | post `22` |
| Tin Developer ứng viên đã nộp | post `46` |
| CV mẫu | `9100` đến `9105` |

Chạy lần lượt ba request trong thư mục **01 - Login and tokens**. Collection
tự lưu JWT vào Environment; các request còn lại chỉ đọc dữ liệu, không làm
thay đổi cơ sở dữ liệu mẫu.

Trước khi demo, bảo đảm XAMPP MySQL (cổng `3333`), backend (cổng `5000`) và
Docker Desktop đang chạy.
