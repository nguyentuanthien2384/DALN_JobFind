# Chatbot: đóng khung, lịch sử và kiểm thử câu trả lời

Cập nhật ngày 21/09/2026 cho ứng dụng tại `http://localhost:3001`.

## Hành vi đã sửa

- Khung hỗ trợ chỉ thu lại khi bấm nút ×. Rê chuột ra ngoài, bấm ngoài khung, Escape và các liên kết điều hướng React không tự đóng khung. Bản nháp còn nguyên sau khi đóng/mở khung.
- Lịch sử đọc từ MySQL, có trạng thái tải/mở, làm mới và thông báo đã lưu. Bản nháp rỗng không xuất hiện trong danh sách lịch sử.
- Khách giữ mã truy cập hội thoại trong localStorage để mở lại trên cùng trình duyệt sau khi đóng trình duyệt. Mã cũ trong sessionStorage được chuyển sang mà không thay danh tính. Không lưu nội dung hội thoại trong localStorage.
- Tài khoản đăng nhập đọc lịch sử của tài khoản trên các thiết bị. Đổi tài khoản giữ khung mở nhưng xóa bản nháp và kết quả riêng tư trên màn hình; dữ liệu giữa các chủ sở hữu được tách biệt. Lịch sử khách không tự nhập vào tài khoản.
- Không âm thầm cắt mất tin nhắn đầu sau 40 tin nữa. Mỗi hội thoại chứa tối đa 200 tin (100 lượt hỏi đáp); đạt giới hạn sẽ báo tạo cuộc mới, giữ nguyên hội thoại trước. Sửa câu hỏi/tạo lại vẫn thay nhánh kể từ câu được chọn như trước.
- Sửa tìm bài hướng dẫn theo từ/cụm tiếng Việt, tránh khớp nhầm chuỗi con. Hướng dẫn quên mật khẩu, CV, nhắn tin và mua gói được đối chiếu với chức năng hiện có. Câu hỏi cách sử dụng không còn bị chuyển nhầm thành yêu cầu đọc dữ liệu riêng.

## Hỏi thử trên ứng dụng đang chạy

Cuộc hội thoại mẫu đã được giữ lại trong trình duyệt JobFind của Codex, có tiêu đề **“Tôi quên mật khẩu JobFind thì phải làm gì?”**. Đây là lịch sử khách của trình duyệt kiểm thử, không tự xuất hiện trong tài khoản hoặc trình duyệt khác.

1. **Tôi quên mật khẩu JobFind thì phải làm gì?** Trả lời đúng trang `/forget-password`, nhập số điện thoại đã đăng ký, OTP 6 chữ số gửi tới email tài khoản, hiệu lực 5 phút. Đối chiếu `frontend/src/container/login/ForgetPassword.js` và `backend/src/utils/otpStore.js`.
2. **Làm sao nhắn tin với nhà tuyển dụng?** Trả lời mở chi tiết tin, dùng “Nhắn tin cho nhà tuyển dụng”, xem lại ở `/chat`; nêu điều kiện tài khoản hoạt động/công ty được duyệt và phân biệt kênh hỗ trợ JobFind. Đối chiếu trang JobDetail và quyền chat.

Đã đóng/mở bằng ×, tải lại trang, bấm Lịch sử và chọn hội thoại: cả hai câu hỏi, câu trả lời và nguồn đều được khôi phục. Đã tiếp tục gửi câu thứ hai vào đúng hội thoại sau khi mở lại từ lịch sử.

## Bằng chứng kỹ thuật

- Frontend: 70 kiểm thử liên quan đạt, gồm App, bộ lưu trạng thái, client streaming/lưu mã khách, Markdown và hộp thư hỗ trợ. Log: `.local/support-widget-unit.log`.
- Dịch vụ: 46 kiểm thử hỗ trợ/proxy và 6 kiểm thử giới hạn/bảo toàn lịch sử đạt. Log hỗ trợ/proxy: `.local/support-widget-service.log`; bộ mới: `microservices/tests/support-store.test.js`.
- 11 kịch bản tích hợp MySQL/HTTP/SSE/Chromium đạt. Có kiểm thử rê chuột, bấm ngoài, Escape, điều hướng, đóng/mở bằng ×, phiên trình duyệt mới, tiếp tục hội thoại, đổi danh tính, hủy/lỗi giữa chừng, xóa và chuyển hỗ trợ trên dữ liệu giả lập. Kết quả: `.local/support-chat-browser/validation.json`; log: `.local/support-widget-integration.log`.
- Build production frontend thành công: `.local/support-widget-build.log`.
- Đã build và khởi động lại riêng support-chat-service trên stack local; container healthy. Frontend đang chạy đã nhận thay đổi.

Các kịch bản tự động dùng người dùng/provider giả lập và MySQL dùng riêng cho kiểm thử; không gửi tin thật cho nhân viên. Hai câu hỏi nêu trên được gửi qua giao diện vào dịch vụ và cơ sở dữ liệu local đang chạy.

## Thời hạn và giới hạn chất lượng

Thời gian lưu mặc định 30 ngày (`SUPPORT_RETENTION_DAYS`). Mã truy cập khách có hiệu lực tối đa 30 ngày. Xóa dữ liệu trình duyệt hoặc kết thúc cửa sổ riêng tư có thể làm mất quyền truy cập lịch sử khách. Danh sách API hiện trả tối đa 50 hội thoại gần nhất; có thể tải xuống từng hội thoại đang thấy.

Môi trường hiện chưa cấu hình OpenAI, Gemini hoặc model local khả dụng. Hai câu trả lời trực tiếp là **hướng dẫn dự phòng có nguồn**, không phải kết quả sinh bởi mô hình AI. Các kiểm thử trên chứng minh các luồng được kiểm tra hoạt động và hai câu hướng dẫn phù hợp với mã nguồn, không chứng minh mọi câu hỏi đều đúng hoặc đạt chất lượng chatbot thương mại.

Sau khi cấu hình provider trong `microservices/.env`, khởi động lại dịch vụ và chạy `npm --prefix microservices run test:support:live` để đánh giá mô hình thật, bao gồm câu hỏi nhiều lượt, tìm việc hiện tại và trường hợp không đủ dữ liệu. Không đưa API key vào frontend hoặc Git.

## Tự kiểm tra lại

Mở Hỗ trợ → nhập câu hỏi → đợi “Đã lưu hội thoại” → bấm × → mở lại → bấm biểu tượng lịch sử → chọn tiêu đề hội thoại. Tải lại trang và làm lại thao tác mở lịch sử để kiểm tra dữ liệu máy chủ.

Các lệnh hồi quy: `npm --prefix microservices run test:support` và `npm --prefix microservices run test:support:browser`.
