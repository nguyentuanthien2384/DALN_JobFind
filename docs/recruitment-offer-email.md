# Thư mời nhận việc

Luồng tại `/admin/pipeline` đã được mở rộng từ thông báo trúng tuyển kèm lời nhắn thành thư mời nhận việc có thông tin rõ ràng. Nội dung tham khảo các nhóm thông tin trong [hướng dẫn thư mời nhận việc của TopCV](https://www.topcv.vn/thu-moi-nhan-viec); đây là tính năng của JobFind, không phải tích hợp hệ thống TopCV.

## Cách sử dụng

1. Mở hồ sơ ứng viên, chọn **Gửi trúng tuyển**.
2. Điền tên công ty, ngày và giờ nhận việc, hình thức làm việc, địa điểm hoặc đường dẫn trực tuyến, tên và email HR, hạn phản hồi. Tất cả ngày giờ theo Việt Nam (UTC+7).
3. Bổ sung lịch làm việc, lương (ghi rõ gross/net), điều kiện thử việc, phúc lợi, giấy tờ và hướng dẫn ngày đầu nếu đã thống nhất. Không tự điền các điều khoản chưa được xác định.
4. Chọn **Xem trước thư mời**; kiểm tra người nhận, vị trí, thông tin nhận việc và lời nhắn. Có thể quay lại chỉnh sửa.
5. Chọn **Xác nhận gửi thư mời** và xác nhận địa chỉ nhận. Thông báo thành công có nghĩa yêu cầu đã vào hàng đợi, chưa chứng minh email đã vào hộp thư ứng viên.
6. Ứng viên trả lời email để đồng ý hoặc từ chối trước hạn. `Reply-To` dẫn đến hộp thư HR. HR xác nhận phản hồi qua email, rồi cập nhật bước **Đã nhận việc** khi phù hợp. Hệ thống chưa tự đọc hộp thư HR để cập nhật trạng thái.

Trong lịch sử tuyển dụng, mở **Xem nội dung đã yêu cầu gửi** để xem nguyên nội dung từng lần gửi. Khi soạn thư tiếp theo, có thể sử dụng lại thông tin của thư mời trước; cần cập nhật ngày giờ và hạn phản hồi nếu đã qua.

## Kiểm tra và lưu trữ

- Máy chủ và giao diện chặn thời gian đã qua, ngày không tồn tại, hạn phản hồi đã qua hoặc sau giờ nhận việc.
- Tại văn phòng/kết hợp bắt buộc địa điểm cụ thể; từ xa bắt buộc đường dẫn HTTP/HTTPS. Đường dẫn có tài khoản/mật khẩu hoặc giao thức không an toàn bị từ chối.
- Chỉ email HR đơn hợp lệ được sử dụng, chặn danh sách địa chỉ và chèn tiêu đề email. Mọi nội dung nhập được hiển thị an toàn trong HTML và bản văn bản thuần.
- Gửi lời mời chuyển hồ sơ sang `de_nghi`, giữ nguyên `nhan_viec` nếu trước đó đã xác nhận nhận việc; không tự coi lời mời là ứng viên đã đồng ý.
- Quyền theo công ty vẫn được kiểm tra trên hồ sơ trước khi thay đổi dữ liệu.
- Trạng thái, lịch sử với `decision_snapshot` và outbox cùng một giao dịch. Lỗi ghi outbox sẽ hủy cả lần cập nhật. Khi broker bị gián đoạn, relay gửi lại cùng mã sự kiện và nguyên nội dung thư.
- Email ứng viên được lấy từ hồ sơ ứng tuyển đã lưu; địa chỉ HR dùng cho phản hồi. Cơ chế hộp thư demo/chặn địa chỉ mẫu và theo dõi trạng thái gửi hiện có vẫn áp dụng.

## Cập nhật bản đang chạy

Cần dựng lại frontend và các dịch vụ từ cùng phiên bản mã nguồn/contract. `application-service` tự thêm cột JSONB `application_events.decision_snapshot` bằng `ADD COLUMN IF NOT EXISTS` lúc khởi động; không xóa dữ liệu cũ. Các bộ kiểm tra sự kiện cần cùng phiên bản để chấp nhận `accepted` với `de_nghi`.

API `POST /api/applications/:id/decision-notification` yêu cầu thêm `offer` khi `decision: accepted`; `rejected` vẫn chỉ cần `decision` và lời nhắn tùy chọn. Dữ liệu `offer` có cấu trúc trong `microservices/shared/contracts/offerSchema.js`. Những sự kiện cũ đã nằm trong hàng đợi mà chưa có `offer` vẫn được hỗ trợ để tránh làm hỏng email đang chờ.

Các bộ kiểm thử đơn vị dùng dữ liệu giả và SMTP giả lập. Ngày 12/09/2026 đã bật Gmail từ cấu hình có sẵn trong `microservices/.env` cho bản triển khai hiện tại và kiểm thử gửi tự động từ giao diện đến Inbox Gmail. Lượt thử dùng một hồ sơ giả, gửi về chính hộp thư cấu hình; xem [kết quả kiểm thử thực tế](recruitment-offer-live-test.md). Ảnh xem trước là kiểm tra bố cục HTML bằng trình duyệt, không phải ảnh giao diện Gmail/Outlook.

Khi cần áp dụng lại cấu hình gửi vào bản triển khai hiện tại, chạy `node scripts/enable-live-mail.mjs` từ gốc dự án. Script xác nhận SMTP, lưu cấu hình riêng tư và tạo lại `notification-service`. `node scripts/activation-health.mjs` xác nhận cấu hình đang chạy. Không đưa thông tin Gmail vào mã nguồn hoặc bản build.

Kiểm thử trình duyệt: dựng frontend với `BUILD_PATH` trỏ tới `.local/offer-preview-build` ở gốc dự án, rồi chạy `node scripts/test-offer-browser.mjs` trong `microservices`. Có thể dùng `OFFER_PREVIEW_BUILD` để chỉ định thư mục build khác. Script chặn mọi API thật, kiểm tra màn hình 1440px/375px, lưu ảnh và mẫu email vào `.local/offer-browser`.
