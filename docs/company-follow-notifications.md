# Thông báo tin tuyển dụng từ công ty đang theo dõi

Ứng viên vào menu tài khoản → **Thông báo**, hoặc bấm chuông → **Xem tất cả thông báo**, để mở `/candidate/notifications`. Trang hiển thị lịch sử theo thứ tự mới nhất, 10 thông báo mỗi trang, số chưa đọc và thao tác đánh dấu tất cả đã đọc. Bấm thông báo tin tuyển dụng sẽ đánh dấu đã đọc và mở đúng `/detail-job/:id`.

## Khi nào nhận thông báo?

- Theo dõi công ty lưu đăng ký nhận các tin tiếp theo; thao tác này không gửi lại tin cũ.
- Khi tin mới được duyệt, hệ thống chụp danh sách người đang theo dõi công ty và lưu yêu cầu thông báo cùng giao dịch duyệt tin. Cả duyệt thủ công và duyệt AI đều dùng luồng này.
- Tin phải còn hạn ứng tuyển, công ty phải đang hoạt động và đã được duyệt. Tin chờ duyệt, bị từ chối, bị chặn hoặc hết hạn không tạo thông báo tuyển dụng mới cho người theo dõi.
- Mỗi người nhận có thông báo `NEW_POST` riêng, ban đầu chưa đọc, chứa tên công ty, vị trí và đường dẫn chi tiết. Thông báo được lưu kể cả khi ứng viên đang ngoại tuyến.
- Gửi lại cùng sự kiện không tạo thêm bản ghi. Người bỏ theo dõi trước lần duyệt kế tiếp không nhận thông báo cho lần đó; bỏ theo dõi không xóa lịch sử hoặc yêu cầu gửi đã được lưu trước đó.

Chuông và trang thông báo cập nhật qua Socket.IO, kiểm tra lại khi kết nối lại và kiểm tra định kỳ mỗi 30 giây. Đánh dấu đã đọc trên trang hoặc chuông đồng bộ ngay trong giao diện và qua máy chủ cho các phiên đang mở. API luôn lấy người nhận từ phiên đăng nhập.

## Thành phần và kiểm tra

Luồng phát tin và lưu thông báo dùng lại các thành phần sẵn có: `manualModerationOutbox`, `approvalNotifications`, Job Core outbox relay và Notification Service. Không cần bảng mới hoặc gửi email để nhận thông báo trong tài khoản. Job Core, RabbitMQ và Notification Service phải đang chạy để chuyển yêu cầu gửi đã lưu thành thông báo.

API danh sách giới hạn 1–50 bản ghi mỗi lần, mặc định 10, với `offset` từ 0 đến 1.000.000. Sắp xếp thêm ID sau thời gian tạo để các thông báo cùng thời điểm có thứ tự phân trang ổn định.

- Backend: kiểm thử danh sách, phân trang, cách ly tài khoản và đồng bộ đã đọc.
- Frontend: kiểm thử trang thông báo, cập nhật dữ liệu, phân trang, liên kết tin và menu tài khoản.
- `node backend/scripts/test-company-follow-notifications-browser.cjs`: kiểm tra giao diện thật với API giả lập trên máy tính và điện thoại; gồm thông báo đến mới, mở tin, phân trang, đọc tất cả và thử lại khi tải lỗi.
- `npm --prefix microservices run test:posting-quota:integration`: kiểm tra duyệt thủ công/AI → yêu cầu gửi → thông báo chưa đọc của từng người theo dõi bằng MySQL dùng riêng cho kiểm thử; xác minh chống trùng và liên kết tin. Không gửi thông báo hoặc email đến người dùng thật.

Dữ liệu phát triển cũ có thể chỉ chứa tin đã hết hạn; để xác minh nhận thông báo mới cần một tin mới còn hạn và được duyệt sau khi ứng viên theo dõi công ty. Không tạo thông báo bù từ dữ liệu cũ khi khởi động.
