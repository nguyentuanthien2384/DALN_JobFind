# JobFind — chatbot gọi công cụ tìm việc (nâng cấp)

## Bạn nhận được gì

Đây là **bản tích hợp trực tiếp vào source JobFind `DALN_JobFind-main(1).zip`**. ZIP đi kèm chỉ gồm tệp mới hoặc thay đổi so với source gốc; nó **đã chứa cả bản chatbot nền trước đó**, nên dùng được dù bạn chưa chép ZIP chatbot cũ. Chép các tệp theo đúng đường dẫn vào thư mục dự án (nên git commit/sao lưu trước), rồi làm theo `CHATBOT_SETUP.md`.

- `search_jobs({query,location})`: Gemini có thể gọi công cụ tìm kiếm trên MySQL **chỉ đọc**; giới hạn 5 kết quả, tối đa 20 hàng truy vấn, yêu cầu tin `PS1`, ngày hết hạn chưa qua, tài khoản đăng tuyển hoạt động và công ty được duyệt.
- `get_job_details({job_id})`: Gemini đọc chi tiết **chỉ khi biết ID** và tin vẫn công khai/đang mở. Không lộ dữ liệu ứng viên, file CV, email, tài khoản hoặc tin chờ duyệt.
- Frontend hiển thị thẻ tin tuyển dụng với nút mở `/detail-job/:id`; đường dẫn được xây từ ID số, không lấy URL từ mô hình AI. Lịch sử thẻ tin cũng lưu **chỉ trong phiên tab**.
- Nút micro dùng SpeechRecognition nếu trình duyệt hỗ trợ, sẽ xin quyền micro; nhà cung cấp trình duyệt có thể xử lý giọng nói trên máy chủ của họ. Không ghi âm/lưu file âm thanh trong backend JobFind.
- Không có công cụ ghi (`apply_for_job`, `send_message`, `delete_user`...), không cấp JWT cho AI và không tự nộp hồ sơ.

## Chạy thử

1. Giữ nguyên các giá trị `.env` hiện tại; thêm `GEMINI_API_KEY` và (không bắt buộc) `GEMINI_MODEL=gemini-2.5-flash-lite` vào **`backend/.env`**. Không gửi API key cho chatbot hoặc đưa vào frontend.
2. Cài dependency như dự án gốc và khởi động **MySQL, backend legacy, Gateway + Redis (nếu frontend trỏ port 4000), frontend**; Node.js 20+.
3. Kiểm tra database có ít nhất một tin đã duyệt `PS1`, chưa hết hạn; chủ tin có tài khoản `S1`, công ty có `statusCode=S1` và `censorCode=CS1`.
4. Mở giao diện hỗ trợ, thử: **“Tìm việc React tại Hà Nội”** → kết quả có tên, công ty, lương (nếu có) và liên kết đến `/detail-job/ID`. Sau đó thử **“Xem chi tiết tin tuyển dụng ID 123”** với ID thực tế. Thử “Nộp CV giúp tôi” phải được hướng dẫn thao tác chứ không tạo hồ sơ.
5. Backend mock tests: `cd backend && node --test tests/services/supportChatService.node.test.cjs tests/services/supportJobTools.node.test.cjs tests/services/supportToolCalling.node.test.cjs`. Frontend sau khi `npm install`: `CI=true npm test -- --watchAll=false --runInBand --testPathPattern=supportChat`; sau đó `npm run build`.

## Lưu ý kỹ thuật và giới hạn

- Gọi function có thể mất **hai lượt Gemini API**: một lượt chọn công cụ, một lượt tổng hợp câu trả lời; cần theo dõi quota Free tier. Tất cả API call nằm ở backend; không dùng khoá API của người dùng.
- Kết quả tìm kiếm dùng tìm kiếm theo **tên vị trí và tên tỉnh/thành**, chưa có semantic search/Elasticsearch, suy luận mức lương số tiền, phân trang hoặc đề xuất việc cá nhân hóa. Chỉ hiển thị tối đa 5 tin để tránh tải nặng.
- Không thể kiểm chứng AI thật và dữ liệu MySQL thật trong môi trường tạo bản vá vì không có API key/cơ sở dữ liệu của bạn. Các kiểm thử dùng mock; bạn cần chạy bản thật trên máy trước khi đưa lên production.
- Với Gemini Free tier, không gửi CV thật, số điện thoại, email hoặc dữ liệu riêng tư qua chat khi chưa đánh giá điều khoản dữ liệu. **Tính năng xem trạng thái ứng tuyển cá nhân, nộp đơn và chuyển cuộc hội thoại cho admin chưa được triển khai**, vì cần API xác thực/quyền hạn và thiết kế bảo vệ dữ liệu riêng.
- Widget hiện viết bằng React tùy chỉnh tương thích Create React App của JobFind, lấy cảm hứng từ GitHub chatbot, **không tuyên bố sử dụng nguyên `assistant-ui`**. Không cài thêm dependency mới.
