# Diễn tập hai điểm chặn Worker/Admin — 2ad

Tiếp nối [đối chiếu 2ac](rollout-plan.md), ngày 11-09-2026. Phạm vi: sửa hành vi khởi động Worker và kiểm chứng cách xử lý chỉ mục Admin trên **bản sao vật lý của MongoDB đang có**. Kết quả lần chạy gần nhất tại [worker-admin-rehearsal.json](worker-admin-rehearsal.json); chỉ xem là đạt khi `status=passed`, `sourceUnchanged=true` và `cleaned=true`.

**Kết quả: PASS**, project `jobfind-rehearse-3d803b78`. Hai dịch vụ sẵn sàng, restart/replay không gọi AI lặp; 1.142 audit cũ cùng chỉ mục được giữ nguyên. Checksum file nguồn và trạng thái container nguồn không đổi; tài nguyên diễn tập đã dọn. **1.151 kiểm thử microservices/60 file**, **8 kiểm tra tích hợp Admin/MongoDB** và đối chiếu hợp đồng HTTP/event qua. Ca khóa chỉ có khoảng trắng được chạy lại trong 10 kiểm thử adapter sau lần hồi quy toàn bộ. Chưa chạy lại bộ frontend/backend hoặc Compose tám dịch vụ vì đợt này chỉ thay startup/configuration Worker và công cụ diễn tập.

## Thay đổi

- Worker từ chối khởi động nếu thiếu hoặc chỉ có khoảng trắng trong `ANTHROPIC_API_KEY`, trước khi mở ledger, đăng ký consumer hay nhận việc. Trước đây Worker vẫn nhận việc rồi ghi lỗi cấu hình thành kết quả cuối cùng. Kiểm tra `AI_MONGO_URL` và khả năng ghi ledger vẫn phải qua trước consumer. Khóa có giá trị chỉ chứng minh có cấu hình, chưa chứng minh xác thực/hạn mức của provider thật.
- Collector chỉ đọc nhận diện thêm lỗi `missing-ai-provider-key`.
- Admin dùng cách sửa đã có trong checkout: nếu tồn tại chỉ mục đơn `createdAt: 1` không TTL, giữ nguyên nó và bỏ yêu cầu tạo TTL lúc khởi động. Vẫn bắt buộc chỉ mục unique từng event. Không chuyển retention sang 180 ngày, không drop/sync index hay xóa log để vượt lỗi. Collection mới vẫn dùng TTL 180 ngày theo schema hiện có; chính sách collection cũ được giữ nguyên.
- Bổ sung bài diễn tập có thể chạy lại và ca tích hợp MongoDB với collation không tương thích: Admin phải báo lỗi, giữ nguyên bản ghi và chỉ mục gây xung đột để đối chiếu riêng.

## Chạy lại

Từ thư mục `microservices`, dùng Node và Docker CLI:

```powershell
npm run test:worker-admin:rehearsal -- --source-project ai-job-portal
npm run test:admin-audit:integration
```

Nguồn MongoDB phải **đã dừng sạch**; script từ chối nếu đang chạy, exit code khác 0, nguồn không rõ ràng hoặc có container đang ghi volume nguồn. Script không tự dừng nguồn. Bài này dành cho MongoDB standalone lưu `/data/db` trong Docker volume, không thay thế quy trình backup online/replica set. Cần sẵn các image MySQL 8.0, PostgreSQL 16 Alpine, RabbitMQ 4 Management Alpine và image MongoDB đúng ID của nguồn. Image Node ứng dụng được build từ source hiện tại và lockfile; bước build có thể cần registry/npm.

Volume nguồn được mount chỉ đọc vào helper không có mạng, sao chép sang volume mới gắn nhãn riêng. Đối chiếu SHA-256 manifest toàn bộ file trước khi mở MongoDB bản sao; dùng đúng image MongoDB của nguồn. TTL monitor tắt trên bản sao để việc kiểm tra không tự làm hết hạn dữ liệu. Đây là cấu hình của môi trường thử.

Ứng dụng thử chạy trong image riêng, broker/MySQL/PostgreSQL mới hoàn toàn, mạng Docker internal và không công bố cổng. Không nạp `.env` nguồn. SDK AI chỉ trỏ đến HTTP fixture; broker chỉ có tác vụ tổng hợp, không replay hàng đợi thật hay chuyển audit/CV cũ tới provider. Admin được cho sẵn sàng trước Worker để queue audit nhận được kết quả ngay từ tác vụ đầu tiên.

## Bằng chứng kiểm tra

1. Khôi phục bản sao và tái hiện lệnh tạo TTL gây xung đột trên `createdAt_1`. Ghi số lượng, checksum bản ghi, metadata/index/collation; không ghi payload hoặc thông tin cá nhân vào báo cáo.
2. Đưa một tác vụ tổng hợp vào broker riêng. Khởi động lần lượt Worker thiếu khóa và thiếu URL ledger: exit 1 đúng nguyên nhân, queue vẫn một message, không consumer, không gọi AI, không ghi audit/ledger.
3. Chạy entrypoint Admin và Worker thật với cấu hình đủ, ledger trên bản sao và AI HTTP mô phỏng. Hai `/readyz` đạt, kết quả thành công được ghi một lần vào audit, task ở trạng thái `published`.
4. Restart hai dịch vụ rồi gửi lại cùng event: vẫn một lần gọi mock, một audit kết quả; chờ cả ready/unacked về 0. Đối chiếu checksum toàn bộ audit/ledger cũ và mọi chỉ mục cũ sau khởi động/restart.
5. Dừng dịch vụ sạch, kiểm tra không OOM; dọn project/image/volume thử. Kiểm tra lại checksum file nguồn và trạng thái tất cả container thuộc project nguồn đều không đổi.

MongoDB nguồn tại lần đối chiếu có **1.142 audit**, collation `simple`, chỉ mục thời gian thường và **0 ledger task**. Có 0 audit cũ hơn 180 ngày tại thời điểm chụp; con số này không phải quyết định bật TTL. Bài tích hợp riêng có audit từ năm 2020 để chứng minh giữ log cũ ngoài khoảng 180 ngày. Bản sao là dữ liệu thời điểm dừng nguồn, không chứng nhận toàn bộ dữ liệu lịch sử hoặc bản sao lưu định kỳ.

## Áp dụng sau diễn tập

Giữ tám cờ frontend ở trạng thái hiện tại. Source Compose đã khai báo `AI_MONGO_URL`; container cũ thiếu biến phải được tạo lại từ cấu hình đã chốt, vì sửa file/restart đơn thuần không cập nhật environment của container. Cần cấp khóa provider hợp lệ qua cấu hình bí mật của môi trường thật và kiểm chứng provider/model trước khi cho Worker nhận backlog. Không dùng khóa/URL fixture của bài diễn tập cho môi trường thật.

Trước thay đổi runtime thật, hoàn thành bước sao lưu/khôi phục và cố định artifact tại [rollout-plan.md](rollout-plan.md). Giữ đúng volume MongoDB/ledger và RabbitMQ/node identity; khởi động consumer Admin trước Worker, xác nhận readiness và đối chiếu queue/outbox. Admin không cần migration TTL cho phương án giữ retention hiện tại. Nếu có collation/unique conflict khác, xử lý riêng trên bản sao, không tự xóa dữ liệu trùng hoặc thay chỉ mục.

Đợt này chỉ kiểm chứng hai dịch vụ và nguồn MongoDB trên bản sao. Không khởi động/recreate stack nguồn, sửa `.env`, bật cờ, gọi AI/SMTP thật, hoặc chứng nhận phục hồi MySQL/PostgreSQL/RabbitMQ. Các lượt đầu phát hiện bộ kiểm tra đọc thiếu stderr và cách khởi động đồng thời chưa bảo đảm consumer audit sẵn sàng trước Worker. Bộ diễn tập đã sửa hai điểm này; từng môi trường thử đều được dọn và kiểm chứng nguồn không đổi trước lần chạy lại thành công.
