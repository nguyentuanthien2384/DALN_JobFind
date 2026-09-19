# Chatbot AI JobFind — bản đã tích hợp

Chatbot đã được ghép vào dự án hiện tại từ ZIP, giữ các phần Redis/Socket.IO, Web Push, thông báo và chat giữa người dùng. Không cần chép đè ZIP lại.

## Tính năng

- Dùng **@assistant-ui/react 0.15.21** thật, tương thích React 18 hiện có. `useExternalStoreRuntime` nối trạng thái và SSE của JobFind với `Thread`, `Message`, `Composer` và hành động tạo lại câu trả lời.
- Widget tiếng Việt trên các trang, mở rộng/thu nhỏ và bố cục điện thoại.
- Câu hỏi gợi ý, gửi bằng Enter, xuống dòng bằng Shift+Enter, nhập giọng nói nếu trình duyệt hỗ trợ.
- Phản hồi từng phần, dừng, lỗi có thể thử lại, sao chép, tạo lại và sửa câu hỏi. Sửa/tạo lại thay phần hội thoại từ lượt được chọn; không lưu các nhánh trả lời cũ.
- Markdown: tiêu đề, danh sách, bảng và khối mã. Không thực thi HTML, tải ảnh bên ngoài hay mở liên kết bên ngoài do mô hình sinh ra.
- Tìm tin đang tuyển từ MySQL và hiển thị thẻ tên việc, công ty, địa điểm, lương, đường dẫn chi tiết. Theo dõi ID tin ở lượt tiếp theo.
- Tối đa 6 cuộc trò chuyện, 40 tin/cuộc, lưu trong `sessionStorage` theo tài khoản/khách và tab. Tạo mới, chuyển, xóa, tải lại trang; câu trả lời bị dừng không gửi vào ngữ cảnh AI tiếp theo.

## Cấu hình để sử dụng AI thật

1. Cài thư viện frontend theo lockfile: `npm --prefix frontend ci --legacy-peer-deps` nếu máy chưa có dependencies. Thư viện đã được cài ở máy đang phát triển.
2. Thêm vào **backend/.env**, giữ nguyên các cấu hình khác:

   ```env
   GEMINI_API_KEY=YOUR_GOOGLE_AI_STUDIO_KEY
   GEMINI_MODEL=gemini-2.5-flash-lite
   ```

   Lấy khóa tại https://aistudio.google.com/apikey. Chọn model Gemini mà tài khoản của bạn còn được cấp quyền; đổi `GEMINI_MODEL` khi cần. Không đưa khóa vào `REACT_APP_*` hoặc Git.
3. Dùng Node.js 20.3 trở lên (đã kiểm tra trên Node 24). Khởi động MySQL, backend và frontend theo README. Nếu frontend trỏ tới Gateway, khởi động/rebuild Gateway và Redis để tải tuyến streaming mới. Có thể dùng `npm start` từ thư mục gốc theo quy trình local hiện có.
4. Frontend tiếp tục dùng `REACT_APP_BACKEND_URL` hiện tại. Thông thường là Gateway `http://localhost:4000`; chạy trực tiếp legacy thì dùng `http://localhost:5000`. Đổi biến frontend cần build/khởi động lại.
5. Mở nút **Hỗ trợ** và hỏi “Tìm việc React tại Hà Nội”. Tin chỉ xuất hiện khi đã duyệt, chưa hết hạn, tài khoản và công ty đang hoạt động. Khi không có tin hợp lệ, chatbot trả kết quả rỗng.

Kiểm tra môi trường khi tích hợp: backend chưa có `GEMINI_API_KEY`; MySQL kết nối được nhưng truy vấn công khai trả 0 tin thỏa điều kiện. Vì vậy chưa xác minh trả lời từ Gemini thật. Không có khóa giả hay dữ liệu việc làm giả được đưa vào ứng dụng.

## API và giới hạn

`POST /api/support-chat`, `Content-Type: application/json`:

```json
{"messages":[{"role":"user","text":"Tìm việc React tại Hà Nội"}]}
```

Phản hồi SSE gồm `tool` (thẻ việc làm), `token` (đoạn văn bản), `done`; nếu lỗi sau khi bắt đầu thì gửi `error`. Lỗi trước khi stream trả JSON kèm mã HTTP. Đóng kết nối/dừng trên trình duyệt hủy request ở Gateway và backend.

- Chỉ nhận user/assistant, thứ tự xen kẽ, bắt đầu/kết thúc bằng user; tối đa 12 tin và tổng 8.500 ký tự. Mỗi câu hỏi tối đa 1.400 ký tự; frontend cắt bớt các cặp hội thoại cũ khi cần.
- Giới hạn body 48 KB để hỗ trợ tiếng Việt/emoji trong ngân sách ký tự; backend chỉ nhận JSON.
- Backend: 8 lượt/IP/phút, 8 yêu cầu AI đồng thời mỗi tiến trình. Gateway: giới hạn AI hiện có 30 lượt/giờ và Redis fail-closed.
- Gateway ký IP khách bằng `INTERNAL_SECRET` dùng chung; backend xác minh chữ ký trước khi dùng IP cho giới hạn. Nếu không có secret chung, backend dùng IP kết nối và có thể gộp khách qua Gateway vào một hạn mức.
- Gemini: tối đa 55 giây, 12.000 ký tự đầu ra, 2 công cụ chỉ đọc và tối đa 2 lượt gọi model/yêu cầu. Lượt cuối không mở công cụ.
- Gateway bỏ token, cookie và các header danh tính khỏi yêu cầu chatbot. Không gửi hồ sơ ứng viên hay thông tin tài khoản tới Gemini.

## Kiểm thử

Từ thư mục gốc:

```sh
npm --prefix backend run test:support-chat
npm --prefix backend test -- --runTestsByPath tests/controllers/supportChatController.test.js tests/utils/supportClientKey.test.js tests/routes/web.test.js tests/config/infrastructure.test.js tests/middlewares/rateLimit.test.js
npm --prefix frontend run test:unit -- --testPathPattern="supportChat|SupportMarkdown|App.test" --silent
npm --prefix microservices test -- tests/support-chat-proxy.test.js tests/gateway.test.js tests/http-contracts.test.js
npm --prefix backend run test:support-chat:browser
npm --prefix frontend run build
```

Browser test dùng Chromium của Playwright và SSE giả lập cục bộ, không gọi Gemini. Nếu máy khác thiếu Chromium, chạy `npx playwright install chromium` trong thư mục backend. Kiểm tra gửi, streaming, Markdown, thẻ tin, tạo lại, sửa, dừng, thử lại, lịch sử, tải lại và mobile; ảnh nằm ở `.local/support-chat-browser/`.

## Phạm vi hiện tại

Đây là chatbot tìm việc và hướng dẫn sử dụng JobFind. Lịch sử chưa đồng bộ sang máy khác; chưa có upload tài liệu/ảnh, phân tích CV trong chat, duyệt hành động ghi, tự nộp đơn hoặc chuyển phiên AI cho nhân viên. Các tính năng CV và nhắn tin người dùng hiện có vẫn hoạt động ở khu vực riêng. assistant-ui cung cấp các thành phần mở rộng cho những nhu cầu này, nhưng cần backend, lưu trữ và kiểm soát quyền tương ứng trước khi bật.

Tài liệu đối chiếu: https://github.com/assistant-ui/assistant-ui và https://www.assistant-ui.com/docs/runtimes/custom/external-store.
