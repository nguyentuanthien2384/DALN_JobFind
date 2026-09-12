# Kết quả kiểm thử thư mời nhận việc — 12/09/2026

Đã gửi thành công một email kiểm thử và tìm thấy đúng email đó trong **Inbox Gmail**. Bản HTML và bản văn bản giải mã từ thư thực nhận khớp nội dung đã gửi (chuẩn hóa xuống dòng của MIME). Tổng cộng **44/44 đối chiếu nội dung và thông tin gửi đạt**.

**Cập nhật lúc 21:13 ngày 12/09/2026 (UTC+7): đã bật gửi tự động** bằng hai giá trị có sẵn trong `microservices/.env`. Lượt thử mới từ giao diện nhà tuyển dụng được worker đang chạy tự gửi, đạt trạng thái `sent` sau đúng một lần thử; đã tìm thấy đúng thư trong Inbox Gmail và đối chiếu đạt 44/44. Không dùng tiến trình gửi SMTP riêng trong lượt mới này.

## Phạm vi và bản đang chạy

- Website: `http://localhost:3001`; chức năng tại `/admin/pipeline/`.
- Mã ứng dụng: `74963cc4b9ac113bb8d32666547f4f2df7d963a0`. Đã dựng và thay bản web, gateway, application, notification và admin từ mã này; trước đó Docker còn chạy bản cũ.
- Dùng một hồ sơ giả có nhãn `[KIỂM THỬ]`, gửi đến chính hộp thư Gmail cấu hình trong môi trường kiểm thử. Không gửi đến ứng viên thật, không sửa địa chỉ tài khoản ứng viên.
- Trình duyệt sử dụng API và xác thực thật. Không giả lập phản hồi API trong lượt này.

## Kết quả từng bước

1. Điền biểu mẫu nhà tuyển dụng, xem trước trên màn hình 1280px và 390px, xác nhận gửi: đúng một yêu cầu HTTP thành công, `emailQueued: true`, trạng thái hồ sơ `de_nghi`.
2. Nội dung thư được lưu trong lịch sử, outbox và bản ghi gửi mail; RabbitMQ đã chuyển sự kiện. Chưa tự chuyển hồ sơ sang đã nhận việc.
3. Gửi đúng bản ghi email thử bằng hàm gửi SMTP của ứng dụng: Gmail chấp nhận, không có địa chỉ bị từ chối, một lần gửi, trạng thái `sent` lúc 20:40 ngày 12/09/2026 (UTC+7).
4. Tìm theo đúng Message-ID trong Inbox Gmail bằng kết nối chỉ đọc; nhận được đúng một thư. Đọc MIME mà không đánh dấu đã xem.
5. Đối chiếu người nhận, người gửi, `Reply-To`, tiêu đề, toàn bộ nội dung và trường thư mời: đạt 44/44. Bản HTML thực nhận được xem ở 900px và 375px, không tràn ngang.
6. Thiếu địa điểm, thiếu hạn phản hồi, hạn phản hồi sau giờ nhận việc: API từ chối với HTTP 400 và không tạo email. Tài khoản ứng viên gửi quyết định tuyển dụng bị từ chối với HTTP 403.

## Nội dung đã xác nhận trong thư nhận được

- Tên ứng viên, vị trí, công ty, lời chúc mừng và lời mời nhận việc.
- Ngày nhận việc **26/09/2026 lúc 08:30**, ghi rõ giờ Việt Nam UTC+7.
- Hình thức kết hợp văn phòng và từ xa; địa điểm cụ thể gồm tầng, phòng HR, số nhà, đường, thành phố; đường dẫn trực tuyến.
- Lịch làm việc và nghỉ trưa; lương mẫu **20.000.000 VNĐ gross/tháng**; thử việc mẫu **2 tháng, 100% lương đề nghị**.
- Phúc lợi, giấy tờ cần chuẩn bị, hướng dẫn ngày đầu và giờ có mặt tại lễ tân.
- Tên, điện thoại, email HR; `Reply-To` đúng email HR đã nhập.
- Hạn phản hồi **19/09/2026 lúc 17:00**, hướng dẫn trả lời đồng ý/từ chối và xác nhận ngày bắt đầu.
- Lời nhắn riêng, chữ ký HR/công ty, liên kết hồ sơ ứng tuyển.

Đây là dữ liệu giả để kiểm tra. Lương, thử việc, phúc lợi, giấy tờ và hướng dẫn là trường tùy chọn: thư chỉ có các nội dung này khi nhà tuyển dụng nhập. Hệ thống chưa tự đọc email phản hồi của ứng viên để cập nhật trạng thái.

## Trạng thái sau kiểm thử

**Gửi email tự động của `notification-service` đã bật và được kiểm thử thành công.** Đã chép `EMAIL_APP` và `EMAIL_APP_PASSWORD` từ `microservices/.env` vào cấu hình triển khai riêng tư, xác nhận SMTP, rồi tạo lại đúng container gửi thông báo. Các container khác giữ nguyên. Cấu hình được lưu trong `compose.live.json` và `state.mailDelivery.enabled`, nên thao tác resume bản triển khai hiện tại giữ trạng thái này. Trước khi bật không có email tồn đọng.

Nhà tuyển dụng xác nhận thư mời trên giao diện thì worker tự gửi từ hàng đợi. Thông báo `emailQueued` vẫn chỉ xác nhận tiếp nhận; trạng thái `sent` và kiểm tra hộp thư là các bằng chứng riêng. Mail của backend cũ vẫn tắt; luồng thư mời đang dùng dịch vụ thông báo.

Đã xóa hồ sơ giả, sự kiện và thông báo/delivery của lượt thử. Giữ dấu chống xử lý trùng để bản tin gửi lại không tạo thêm email. Thư đã nhận và bằng chứng cục bộ vẫn được giữ. Kiểm tra cuối: tám dịch vụ HTTP sẵn sàng, hàng đợi không còn bản tin chờ/chưa xác nhận; hạ tầng và volume dữ liệu ban đầu được giữ nguyên.

## Bằng chứng và công cụ

Lượt gửi riêng lúc 20:40 lưu trong `.local/offer-live/`; lượt gửi tự động lúc 21:13 lưu trong `.local/offer-automatic/`. Không đưa dữ liệu hộp thư hoặc bí mật môi trường vào Git:

- `received-email-preview.html`, `received-email-preview.txt`: nội dung thư thực nhận, đã che email hộp thư.
- `received-email-desktop.png`, `received-email-mobile.png`: ảnh render HTML thực nhận đã che địa chỉ.
- `receipt-verification.json`: 44 kết quả đối chiếu.
- `smtp-result.json`, `inspection-summary.json`: trạng thái SMTP và hàng đợi trước dọn dẹp.
- `received-*.eml`: bản thư gốc riêng tư; không chia sẻ công khai.

Script `microservices/scripts/test-offer-live.mjs` chia thành `--prepare`, `--browser`, `--inspect`, `--cleanup`. Thêm `--automatic` vào từng lệnh để kiểm tra worker thật trong `.local/offer-automatic/`; chế độ này yêu cầu thông tin SMTP đang chạy khớp tệp môi trường và chờ đúng delivery của hồ sơ giả đạt `sent`. Không có cờ này là chế độ tách riêng trước đây, yêu cầu SMTP toàn cục để trống.

Mỗi thư mục bằng chứng chỉ dùng cho **một lượt thử**; không tự xóa fixture cũ hoặc tự gửi lại. `--browser` từ chối gửi nếu hồ sơ đã có outbox. Khóa `phase.lock` chặn chạy đồng thời; nếu tiến trình bị dừng bất thường, phải kiểm tra tiến trình và bằng chứng trước khi xử lý khóa.

Script `node scripts/enable-live-mail.mjs` áp dụng thông tin gửi đã có trong `microservices/.env` vào bản triển khai hiện tại, có lưu bản cấu hình trước thay đổi và không in bí mật. `node scripts/activation-health.mjs` kiểm tra cấu hình SMTP đang chạy khớp Compose, các dịch vụ sẵn sàng và hàng đợi đã xử lý xong. Các gói triển khai thử mới vẫn mặc định tắt mail; sau khi triển khai mới cần chủ động áp dụng cấu hình gửi.
