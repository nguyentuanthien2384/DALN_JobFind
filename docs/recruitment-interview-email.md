# Thư mời phỏng vấn và thư cảm ơn sau phỏng vấn

Luồng tại `/admin/pipeline` cho phép nhà tuyển dụng mời ứng viên phỏng vấn bằng một email có đủ thông tin để đến đúng giờ, đúng nơi, rồi gửi kết quả sau buổi phỏng vấn: [thư mời nhận việc](recruitment-offer-email.md) khi trúng tuyển, hoặc thư cảm ơn ứng viên đã tham gia phỏng vấn khi không trúng tuyển.

## Mời phỏng vấn

1. Mở hồ sơ, xem CV (**Xem file CV**), chọn **Mời phỏng vấn**. Kéo thẻ vào cột **Phỏng vấn** cũng mở đúng biểu mẫu này; thẻ chỉ chuyển cột sau khi thư được gửi, đóng biểu mẫu thì hồ sơ giữ nguyên bước.
2. Điền ngày, giờ bắt đầu (giờ Việt Nam, UTC+7), thời lượng, hình thức và thông tin theo hình thức:
   - **Trực tiếp tại văn phòng**: địa điểm cụ thể (điền sẵn địa chỉ công ty).
   - **Trực tuyến**: link phòng họp HTTP/HTTPS (Google Meet, Zoom, Teams…).
   - **Qua điện thoại**: số điện thoại HR sẽ gọi cho ứng viên.
3. Bổ sung vòng phỏng vấn, người phỏng vấn, nội dung cần chuẩn bị, hạn xác nhận tham gia nếu có. Tên công ty, người liên hệ và email HR được điền sẵn từ tài khoản nhà tuyển dụng; email HR là địa chỉ nhận phản hồi (`Reply-To`).
4. Chọn **Xem trước thư mời phỏng vấn**, kiểm tra rồi **Xác nhận gửi thư mời phỏng vấn** và xác nhận địa chỉ nhận.

Email gồm thời gian kèm thứ trong tuần, thời lượng, hình thức, địa điểm hoặc link, người liên hệ, hạn xác nhận, lời nhắn, chữ ký HR, nút xem hồ sơ ứng tuyển và liên kết thêm lịch vào Google Calendar. Ứng viên trả lời email để xác nhận tham gia hoặc đề xuất giờ khác. Thông báo trong ứng dụng hiển thị cùng thời gian phỏng vấn.

Gửi lại trên hồ sơ đang ở bước Phỏng vấn (**Gửi lại / đổi lịch phỏng vấn**) bắt đầu từ thư mời gần nhất và chỉ thêm một bản ghi lịch sử, không tạo thêm lần chuyển bước. Hồ sơ đã nhận việc không gửi thư mời phỏng vấn.

## Kết quả sau phỏng vấn

- **Gửi trúng tuyển**: soạn thư mời nhận việc như hướng dẫn trong [Thư mời nhận việc](recruitment-offer-email.md).
- **Gửi không trúng tuyển**: hồ sơ đã được mời phỏng vấn (bằng thư mời hoặc kéo qua cột Phỏng vấn) có ô **Ứng viên đã tham gia phỏng vấn**, mặc định được chọn. Khi chọn, email có tiêu đề "Cảm ơn bạn đã tham gia phỏng vấn — …", cảm ơn ứng viên đã dành thời gian cho buổi phỏng vấn, ký tên và nhận phản hồi theo người liên hệ của thư mời gần nhất. Bỏ chọn khi ứng viên không đến phỏng vấn để gửi thư thông báo không trúng tuyển thông thường.
- Kéo thẻ từ Phỏng vấn sang **Từ chối** cũng gửi thư cảm ơn đã tham gia phỏng vấn.

Lịch sử tuyển dụng hiển thị tên bước (ví dụ "Đang xem xét → Phỏng vấn") và nội dung từng thư đã yêu cầu gửi.

## API và sự kiện

- `POST /api/applications/:id/interview-invitation` nhận `{ message?, interview }`; cấu trúc `interview` trong `microservices/shared/contracts/interviewSchema.js`. Máy chủ chặn thời gian đã qua, ngày không tồn tại, thời lượng ngoài 15–480 phút, thiếu địa điểm/link/số điện thoại theo hình thức, URL không an toàn, email HR không hợp lệ, hạn xác nhận đã qua hoặc sau giờ phỏng vấn. Hồ sơ đã nhận việc trả HTTP 409.
- Trạng thái `phong_van`, lịch sử có `decision_snapshot` (`decision: "interview"`) và outbox `application.interview_invitation_requested` được ghi trong cùng một giao dịch; quyền theo công ty được kiểm tra trên hồ sơ trước khi ghi.
- `POST /api/applications/:id/decision-notification` nhận thêm `interviewed` (boolean, tùy chọn) cho `rejected`; mặc định tính từ lịch sử hồ sơ. `application.decision_email_requested` và `application.stage_changed` có thêm trường bổ sung `interviewed`, `interview` — sự kiện cũ vẫn hợp lệ.

## Gửi email thật khi chạy local

`npm start` mặc định không gửi email ra ngoài. Đặt `LOCAL_EMAIL_DELIVERY=true` cùng `EMAIL_APP`/`EMAIL_APP_PASSWORD` trong `microservices/.env` rồi khởi động lại; xem [Chạy JobFind với dữ liệu trong cơ sở dữ liệu](run-with-real-data.md#email-và-tác-vụ-định-kỳ).

## Kết quả kiểm thử thực tế — 01/10/2026

Trên bản chạy local bằng `npm start`, với trình duyệt thật (Playwright) và API thật, không giả lập phản hồi:

1. Đăng ký ứng viên mới qua `/register`, tìm tin trên `/job`, nộp CV PDF vào 2 tin của một công ty demo (mở tạm thời rồi ẩn lại sau kiểm thử). Hồ sơ vào MySQL, đồng bộ sang PostgreSQL; email "Hồ sơ ứng tuyển mới" gửi cho nhà tuyển dụng.
2. Nhà tuyển dụng mở Kanban, xem CV đã nộp, gửi thư mời phỏng vấn trực tiếp (bằng kéo thẻ) và trực tuyến (bằng nút **Mời phỏng vấn**).
3. Gửi thư mời nhận việc cho một hồ sơ và thư cảm ơn đã tham gia phỏng vấn cho hồ sơ còn lại.
4. Cả 4 email đạt trạng thái `sent` sau 1 lần thử và được tìm thấy theo đúng Message-ID trong Inbox Gmail (kết nối IMAP chỉ đọc), đúng tiêu đề, người nhận và `Reply-To`; bản HTML thực nhận không tràn ngang ở 900px và 375px.
5. Ứng viên thấy tiến trình "Đề nghị nhận việc"/"Từ chối" tại `/candidate/cv-post` (cờ `REACT_APP_APPLICATION_PROGRESS_ENABLED=true` trong `frontend/.env`) và 4 thông báo trong ứng dụng.
