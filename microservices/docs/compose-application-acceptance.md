# Nghiệm thu ứng tuyển xuyên vai trò trên Compose cách ly — 2aa

Ngày 09-09-2026: **PASS 32 checkpoint** trên project `jobfind-accept-78f39683`: 22 điểm chuỗi nền/AI/CV/Search đã có và 10 điểm mới về ứng tuyển, đăng nhập và phục hồi. Chạy lại từ thư mục `microservices`:

```powershell
npm run test:compose-background:integration
```

Điều kiện image/RAM/cách ly tại [compose-background-acceptance.md](compose-background-acceptance.md). Không cần dependencies backend trên host: runner dựng thêm image kiểm thử từ `backend/package.json`, lockfile và `src`, bằng `npm ci --omit=dev --ignore-scripts`. Dockerfile có danh sách cho phép context riêng, loại `.env`, node_modules và dữ liệu ngoài source. Các script nghiệm thu chỉ được mount read-only vào container thử; không thêm vào image production microservices.

## Chuỗi HTTP thật

Container legacy dùng router, middleware JWT/phân quyền, controller và Sequelize hiện tại. Entrypoint thử bỏ lịch nền/SMTP/Socket.IO; riêng realtime được chuyển tới HTTP fixture cũ để kiểm tra retry. Sáu tài khoản tổng hợp đăng nhập qua `/api/login` của Gateway tới backend thật, kiểm tra mật khẩu bcrypt và dùng token do backend cấp. Gateway và backend cùng đọc quyền hiện tại từ MySQL.

Các bước mới chạy trong cùng Compose với tám dịch vụ thật:

1. Import hồ sơ cũ đã đọc/chưa đọc, danh mục trống, tin thiếu chi tiết, hồ sơ mất tin và ứng viên đã bị xóa. Hồ sơ mất tin vẫn đọc được từ lịch sử legacy; không nhập vào Kanban khi không xác định được công ty. Hồ sơ thiếu chi tiết/ứng viên có giá trị null thay vì làm lỗi cả danh sách.
2. Ứng viên gửi tác vụ phân tích CV qua Core → RabbitMQ → worker/SDK với AI HTTP tổng hợp, rồi lưu các trường đã chọn vào Identity/MongoDB. Ứng viên khác không thấy/sửa/xóa CV này; nhà tuyển dụng không truy cập kho CV cá nhân.
3. Nộp PDF tổng hợp qua writer legacy thật. Body/header giả người nộp bị bỏ qua; transaction MySQL ghi CV và outbox; relay confirm → RabbitMQ → Application/PostgreSQL → lịch sử ứng viên. ID application khác namespace với ID CV legacy.
4. Sửa/xóa CV nguồn và đổi tên/email profile sau khi nộp không thay PDF hoặc snapshot liên hệ lúc nộp. Gửi lại trả 409, không thêm event.
5. COMPANY và EMPLOYER cùng công ty được đọc hồ sơ; công ty khác, ứng viên khác và yêu cầu giả header bị chặn. ADMIN không được nộp CV. Gateway không mở endpoint sync nội bộ.
6. EMPLOYER ghi chú và chuyển Kanban sang `phong_van`; ứng viên đọc “Phỏng vấn” qua dữ liệu riêng có `private, no-store`, không nhận ghi chú hoặc trường nội bộ. Đánh dấu đã đọc của CV legacy độc lập với stage.
7. Dùng lại token vừa đăng nhập sau khi khóa tài khoản, đổi vai trò/công ty hoặc bỏ duyệt công ty: mất quyền ngay ở cả API mới và legacy. Sau khi khôi phục quyền, tiến trình vẫn đúng.
8. Restart Application, Identity và legacy; đăng nhập lại, đối chiếu SHA-256 của PDF, ID, snapshot, stage, ghi chú/timeline và CV nguồn đã xóa. Import lịch sử lại không tạo trùng hoặc ghi đè stage.

SQL trực tiếp chỉ tạo dữ liệu lịch sử/thay trạng thái tài khoản và kiểm tra bằng chứng lưu trữ. Không mock controller, xác thực, outbox, relay hoặc consumer. Chuỗi dừng consumer/broker và phục hồi của 2w/2x vẫn chạy sau các bước mới.

## Kết quả và giới hạn

- 32 checkpoint Compose qua; mạng internal, không cổng công bố, ownership đúng; tám dịch vụ và legacy dừng với exit code 0, không OOM. Runner đã dọn project/volume/network và hai image thử.
- `npm ci --ignore-scripts` backend trên host và cài production dependencies trong image Node 22 đều qua. Sửa bố trí `picomatch` trong lockfile để đáp ứng optional peer của `fdir`: giữ nguyên các phiên bản/checksum đã khóa, đặt v4 ở root và v2 dưới hai dependency cần v2. Không nâng gói nghiệp vụ.
- 789 backend test/37 suite và 1.133 microservices test/59 file qua; contracts giữ 52 HTTP/15 event. Lần chạy hồi quy song song lúc dựng stack có một timeout biên dịch contract; chạy lại toàn bộ khi máy bớt tải đã qua với nguyên ngưỡng timeout.
- Đây là nghiệm thu **HTTP/DB xuyên vai trò**. PDF trong bài này là tệp tổng hợp hợp lệ để kiểm tra lưu/chuyển/đọc đúng byte; chưa sinh từ CV Identity qua giao diện trong cùng phiên Compose. Kiểm thử renderer/PDF đã xem trên browser và giao nhận chính tệp đó vẫn là hai pha riêng của [2z](prepared-cv-application.md), không chạy lại trong 2aa.
- Chưa nghiệm thu browser gọi trực tiếp toàn Compose, màn hình đăng nhập/Kanban kéo thả trong bài này, migration dữ liệu thật/quy mô lớn, SMTP/Socket.IO, tải hoặc chất lượng AI. Không bật cờ, đổi `.env`, schema/dữ liệu thật, restart stack phục vụ, push hoặc chạy CI GitHub.

**Bước tiếp theo:** nối bài browser vào stack Compose thử để nghiệm thu chọn CV → tạo/xem PDF → nộp → cập nhật Kanban → đọc lịch sử bằng thao tác giao diện trên API thật. Chỉ xem xét bật cờ sau bước đó và các điều kiện triển khai/rollback trong [application-sync.md](application-sync.md), [prepared-cv-application.md](prepared-cv-application.md).
