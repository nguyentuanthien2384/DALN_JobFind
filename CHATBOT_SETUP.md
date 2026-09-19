# Chatbot hỗ trợ JobFind

Bản hiện tại triển khai phương án A của PDF: assistant-ui, dịch vụ Node riêng, Vercel AI SDK, MySQL, kho hướng dẫn công khai, tra cứu theo tài khoản và chuyển nhân viên. Xem [đối chiếu PDF](docs/chatbot-pdf-implementation.md).

## Khởi động

Yêu cầu Node.js **22 trở lên**, Docker Desktop, cấu hình MySQL hiện có. Frontend phải dùng Gateway **http://localhost:4000**, không trỏ trực tiếp backend legacy port 5000.

1. Trên máy mới: cài `npm --prefix microservices ci` và `npm --prefix frontend ci --legacy-peer-deps`.
2. Bổ sung các biến hỗ trợ từ `microservices/.env.example` vào `microservices/.env`; giữ cấu hình hiện có. INTERNAL_SECRET phải giống backend. Không đưa API key vào frontend hoặc Git.
3. Chạy `npm start` từ thư mục gốc theo quy trình local hiện có. Supervisor đã thêm support-chat-service port nội bộ 4008. Compose tạo hai bảng hỗ trợ khi SUPPORT_AUTO_MIGRATE=true, không thay bảng người dùng/tin tuyển dụng/ChatMessage.
4. Mở nút Hỗ trợ. Khi chưa có AI, chatbot vẫn dùng hướng dẫn có nguồn, tra cứu cá nhân và chuyển nhân viên. Giao diện ghi rõ chế độ dự phòng.

Nếu stack đã chạy và chỉ cập nhật phần hỗ trợ, chạy từ thư mục microservices: `docker compose -f docker-compose.yml -f compose.local.yml up -d --build --no-deps support-chat-service api-gateway`, đồng thời khởi động lại backend để nạp bridge. Để chạy cả stack thủ công, bỏ --no-deps và danh sách service. Frontend cần rebuild/khởi động lại để nạp giao diện mới.

## Nhà cung cấp

Cấu hình trong microservices/.env:

- OPENAI_API_KEY: khóa API, để trống nếu chưa có.
- SUPPORT_OPENAI_MODEL: mặc định gpt-4.1-mini; chọn model tài khoản thực sự được cấp quyền.
- GEMINI_API_KEY và GEMINI_MODEL (mặc định gemini-2.5-flash).
- SUPPORT_GEMINI_PAID=false: chỉ đặt true sau khi xác nhận dự án Gemini trả phí có chính sách dữ liệu phù hợp.
- SUPPORT_OLLAMA_URL và SUPPORT_OLLAMA_MODEL: tùy chọn, URL tương thích OpenAI, ví dụ http://host.docker.internal:11434/v1; cần model hỗ trợ công cụ.
- SUPPORT_RETENTION_DAYS=30 (1–90 ngày).
- SUPPORT_AUTO_MIGRATE=true cho môi trường local.

Thứ tự: OpenAI → Gemini được cho phép → Ollama đã cấu hình → hướng dẫn có sẵn. Mỗi provider tối đa 18 giây, toàn lượt tối đa 60 giây. Sau khi đã hiển thị văn bản, lỗi sẽ đánh dấu chưa hoàn tất, không ghép câu trả lời provider khác. Lỗi ba lần thì ngừng thử provider đó 60 giây. Khóa chỉ nằm phía máy chủ.

## Lịch sử và quyền riêng tư

- MySQL là nguồn lịch sử chính. Tài khoản dùng JWT qua Gateway; khách dùng capability có chữ ký trong sessionStorage, DB chỉ giữ hash. Mất phiên khách sẽ không mở lại lịch sử khách cũ.
- Mỗi hội thoại giữ tối đa 40 tin gần nhất, danh sách hiện tối đa 50 hội thoại mới nhất. Mở, tải JSON, xóa trong Lịch sử. Mặc định hết hạn 30 ngày từ lần gửi gần nhất; dọn mỗi giờ, chặn đọc ngay khi hết hạn.
- Email, số điện thoại phổ biến, dạng khóa/JWT được che trước lưu/gửi model. Đây không phải bộ loại bỏ mọi dữ liệu cá nhân; không nhập OTP, mật khẩu, số tài khoản hoặc CV.
- Nút tra cứu và câu hỏi tự phục vụ rõ ràng đọc dữ liệu trực tiếp theo danh tính đã xác thực. Kết quả riêng tư bị loại khỏi ngữ cảnh gửi AI ở các lượt sau. Không index dữ liệu cá nhân vào Elasticsearch.

## Nhân viên hỗ trợ

Đánh dấu đồng ý chia sẻ rồi chọn Chuyển hội thoại cho hỗ trợ. Hệ thống chụp các tin đã hoàn tất ở thời điểm đó. ADMIN mở Hỗ trợ chatbot → Yêu cầu hỗ trợ (`/admin/support`), tiếp nhận, mở Tin nhắn và đánh dấu đã xử lý. Chỉ một nhân viên được nhận mỗi yêu cầu.

Nếu chuyển sang Tin nhắn lỗi, ticket vẫn tồn tại và có nút thử lại với cùng mã tin nhắn để tránh trùng. Ngoại tuyến vẫn giữ hàng đợi, không hứa thời gian phản hồi. Nhà tuyển dụng chưa đủ điều kiện tuyển dụng vẫn được liên hệ ADMIN; các quan hệ tuyển dụng khác giữ kiểm tra quyền hiện có.

Xóa hội thoại xóa ticket và bản chụp. **Bản tóm tắt đã gửi sang Tin nhắn có chính sách lưu trữ riêng, không bị xóa bằng nút xóa chatbot.**

## Kiến thức và vận hành

Chín bài công khai được duyệt ở `microservices/support-chat-service/src/knowledge.js`, trang đọc `/support/help`. Chạy `npm --prefix microservices run index-kb -w support-chat-service` để nạp Elasticsearch support_kb_v1. Khi search chưa có index hoặc lỗi, dùng corpus đã đóng gói. Chỉ sửa tài liệu đã duyệt; không đưa CV hoặc hội thoại vào index.

Production: chạy `npm --prefix microservices run migrate -w support-chat-service` với tài khoản migration rồi đặt SUPPORT_AUTO_MIGRATE=false cho runtime. Các lệnh đọc microservices/.env; nếu chạy ngoài Docker, dùng địa chỉ MySQL/Elasticsearch truy cập được từ host. Không public port 4008; các endpoint nghiệp vụ phải qua Gateway và khóa nội bộ.

Readiness /readyz kiểm tra MySQL; /metrics được bảo vệ bằng credential runtime. Prometheus đã thêm 4008. Log chỉ ghi sự kiện, provider và số token, không ghi lời nhắn/kết quả cá nhân. Redis giới hạn lượt AI; một service tối đa tám lượt đang xử lý; khóa MySQL chống ghi đè giữa cửa sổ/replica.

## Kiểm thử

- `npm --prefix microservices run test:support`
- `npm --prefix microservices run test:support:browser`
- `npm --prefix microservices run test:support:live`
- `npm --prefix microservices run contracts:check`
- `npm --prefix frontend run build`

Browser test dùng Chromium, MySQL Docker dùng một lần và danh tính/AI giả lập; không gửi tin cho người thật. Cần image mysql:8.0 có sẵn. Lệnh cũ `npm --prefix backend run test:support-chat:browser` chuyển sang bộ mới.

Live eval gọi Gateway đang chạy, tạo rồi dọn hội thoại khách, tiêu thụ hạn mức khi đã có API key. Báo cáo `.local/support-service-evaluation.json`. Chưa có provider thì trả mã 2 và blocked_missing_provider; không tính chế độ hướng dẫn là AI đạt. Vẫn cần người đánh giá độ đúng, nguồn, tình huống mơ hồ và việc không bịa tin/trạng thái.

/api/support-chat và Gemini cũ được giữ để tương thích; widget mới dùng /api/support/*. CHATBOT_TOOLS_UPGRADE.md mô tả bản legacy, không phải cấu hình mặc định.
