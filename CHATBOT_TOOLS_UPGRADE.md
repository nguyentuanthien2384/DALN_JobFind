# Công cụ tìm việc của chatbot

Đã đồng bộ vào source hiện tại; xem [CHATBOT_SETUP.md](CHATBOT_SETUP.md) để cài đặt, kiểm thử và biết phạm vi tính năng. Không chép đè lại các tệp cũ trong ZIP.

## Công cụ được phép

- `search_jobs({query, location})`: tìm theo tên vị trí và tỉnh/thành trong MySQL. Chỉ lấy tin `PS1` chưa hết hạn, tài khoản `S1`, công ty `S1/CS1`; truy vấn tối đa 20 hàng và trả tối đa 5 thẻ.
- `get_job_details({job_id})`: kiểm tra lại điều kiện công khai/đang tuyển, đọc thông tin của ID nguyên dương. Không lấy hồ sơ, CV hay email ứng viên.

Các tham số truy vấn được kiểm tra và truyền qua Sequelize. Kết quả chỉ chứa các trường công khai cần hiển thị; URL thẻ được dựng từ ID số. Mô tả việc làm là dữ liệu bên ngoài, không phải chỉ dẫn cho chatbot.

Mỗi yêu cầu chỉ chạy tối đa hai công cụ, sau đó Gemini tổng hợp kết quả. Công cụ lạ bị chặn; chữ ký suy nghĩ của model được giữ cho lượt trả kết quả công cụ, còn nội dung suy nghĩ không hiển thị. Có lỗi truy vấn thì báo không tra cứu được, không tạo dữ liệu mẫu trong runtime.

Frontend giữ ID các thẻ trong ngữ cảnh để người dùng hỏi tiếp về tin đã thấy. Backend luôn tra cứu lại thông tin hiện tại; lịch sử trên trình duyệt không cấp thêm quyền.

Hiện tìm kiếm theo từ khóa tên việc và địa điểm, chưa có phân trang hay tìm kiếm ngữ nghĩa. Không có công cụ gửi đơn, gửi tin nhắn hoặc thay đổi dữ liệu.
