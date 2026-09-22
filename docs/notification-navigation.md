# Điều hướng từ thông báo tuyển dụng

Hai thông báo mẫu cũ của ứng viên demo (`userId: 5`) đều lưu `link: /job`. Chúng không lưu mã công việc hoặc công ty, nên không thể khôi phục một tin cụ thể hay xác nhận lại số lượng “2 việc làm”.

Khi đọc thông báo, API nhận diện đúng hai bản ghi mẫu bằng người nhận, loại `NEW_POST`, nội dung và đường dẫn cũ. API trả nội dung mới, giữ nguyên ID, thời gian và trạng thái đã đọc:

- “Việc làm từ các công ty bạn đang theo dõi” mở `/candidate/followed-jobs`.
- “Việc làm phù hợp với hồ sơ của bạn” mở `/candidate/recommended-jobs`.

Hai trang hiển thị cơ hội hiện đang nhận hồ sơ, có phân trang, trạng thái trống, báo lỗi và thử lại. Mỗi thẻ mở `/detail-job/:id`. Thông báo tuyển dụng thực tế đã có đường dẫn chi tiết tiếp tục dùng đường dẫn đó.

`GET /api/get-notification-jobs` lấy người xem từ phiên đăng nhập, chấp nhận `source=followed|recommended`, `limit` từ 1 đến 50 và `offset` từ 0 đến 1.000.000. Danh sách công ty theo dõi chỉ đọc các công ty người xem đang theo dõi. Gợi ý dựa trên kỹ năng và thiết lập của người xem, không thay bằng danh sách việc làm chung khi không có kết quả khớp. Cả hai loại bỏ tin hết hạn, chưa duyệt, công ty hoặc tài khoản đăng tin không hoạt động.

Seeder tạo mới dùng các liên kết đúng. Chạy ứng dụng với dữ liệu cũ không cần migration hay sửa/xóa thông báo đang có; xử lý tương thích diễn ra khi API đọc danh sách. Rollback seeder chỉ nhắm đúng các thông báo mẫu, không xóa mọi thông báo `NEW_POST`.

## Kiểm tra

- Backend: `notificationJobService`, `notificationJobs`, `postService`, `socialServices`, `web`, `notificationDestination`, `notificationSeeder`, `simpleControllers`, `notificationReadSync`.
- Frontend: `NotificationJobs`, `Header`, `App`.
- `node backend/scripts/test-notification-navigation-browser.cjs`: bấm hai thông báo mẫu và một thông báo tin cụ thể trên desktop/mobile; dùng API giả lập, không đánh dấu thông báo thật đã đọc.
- `node backend/scripts/test-notification-jobs-live.cjs`: chỉ đọc cơ sở dữ liệu phát triển để xác minh đường dẫn, công ty theo dõi, điểm khớp và hạn ứng tuyển. Mặc định kiểm tra ứng viên demo 5; có thể đặt `NOTIFICATION_TEST_USER_ID`.

Sau khi nạp backend mới, tải lại trình duyệt để cập nhật các đường dẫn thông báo đang được giữ trên giao diện.
