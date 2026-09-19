# JobFind Support Chat — hướng dẫn tích hợp bản vá

Bản vá chatbot JobFind (bao gồm bản nền và nâng cấp công cụ tìm việc) chỉ chứa các tệp mới/được sửa; **không** chứa toàn bộ JobFind, API key, hay dữ liệu database. Chép các thư mục `backend/`, `frontend/`, `microservices/` và tệp hướng dẫn này vào **thư mục gốc của phiên bản JobFind tương ứng với `DALN_JobFind-main(1).zip`**. Giữ nguyên cấu trúc đường dẫn, cho phép thay thế những tệp cùng tên; nên sao lưu/commit trước khi chép.

## Tính năng và giới hạn

- Popup trợ lý hỗ trợ tiếng Việt nổi ở góc phải trên mọi màn hình React; có lời chào, câu hỏi gợi ý, đóng/mở, nút dừng, thử lại khi lỗi, sao chép phản hồi, bố cục điện thoại, hỗ trợ bàn phím, nhãn trợ năng và **nhập giọng nói nếu trình duyệt hỗ trợ SpeechRecognition** (cần quyền micro; âm thanh có thể được xử lý bởi dịch vụ của trình duyệt).
- Gemini trả lời qua **streaming SSE thật**, với sự kiện `tool` cho tin tuyển dụng đọc từ database. Chế độ gọi công cụ có thể cần **2 lượt gọi Gemini cho một câu hỏi**; xem quota thực tế. API key chỉ gửi từ backend lên Google; frontend không chứa key.
- Có nhiều cuộc trò chuyện và xóa lịch sử. **Lịch sử chỉ lưu trong `sessionStorage` của tab hiện tại**, tách theo tài khoản/khách; không đồng bộ giữa trình duyệt và không ghi vào MySQL.
- AI hỗ trợ FAQ và **tự gọi hai công cụ chỉ đọc `search_jobs`, `get_job_details` để truy vấn tin tuyển dụng công khai đã duyệt, chưa hết hạn trong MySQL**. Widget hiển thị thẻ kết quả kèm đường dẫn nội bộ `/detail-job/:id`. Không xem hồ sơ cá nhân/CV/đơn ứng tuyển và **không chuyển hội thoại tự động cho admin**. Khi cần người thật, hướng dẫn đến trang `/contact` sẵn có. Hệ thống nhắn tin ứng viên/nhà tuyển dụng qua Socket.IO vẫn hoạt động độc lập.
- Giao diện tự viết tương thích React 18/CRA hiện có, lấy cảm hứng từ widget hỗ trợ và kiến trúc *custom backend* trong các dự án mã nguồn mở; **không nhúng/chuyển nguyên source `assistant-ui` hoặc Vercel AI Chatbot**. Cách này tránh thay đổi dependency/npm lockfile/Next.js của JobFind và có thể mở rộng để thay UI bằng `assistant-ui` sau.

## Cấu hình Gemini

1. Tạo API key của chính bạn tại <https://aistudio.google.com/apikey>. Kiểm tra model và hạn mức miễn phí thực tế trên project Google AI Studio; hạn mức có thể thay đổi.
2. **Mở file `backend/.env` đang dùng trên máy của bạn** (không ghi đè các thông số MySQL, JWT, RabbitMQ đang có). Thêm:

   ```env
   GEMINI_API_KEY=day_la_key_cua_ban
   GEMINI_MODEL=gemini-2.5-flash-lite
   ```

   Có sẵn mẫu trong `backend/.env.example`. Không chép key vào `frontend/.env`, `REACT_APP_*`, GitHub hoặc ZIP chia sẻ.
3. Khởi động lại backend. Bản vá dùng `fetch` của **Node.js 20+**, không cần cài thư viện mới. Khi chưa cấu hình key, widget sẽ báo rõ thay vì giả vờ AI hoạt động.
4. Với kiến trúc đầy đủ, giữ `frontend/.env` là `REACT_APP_BACKEND_URL=http://localhost:4000` và khởi động **Gateway + Redis + backend** như README gốc. Gateway đã có tuyến `/api/support-chat` riêng để chuyển tiếp SSE (đường legacy axios JSON cũ không hỗ trợ streaming). Sau khi chép bản vá, khởi động lại Gateway.
5. Nếu muốn thử **chỉ frontend + backend legacy** mà chưa chạy Gateway/Redis, đặt `REACT_APP_BACKEND_URL=http://localhost:5000` trong `frontend/.env` rồi khởi động lại frontend; backend sẽ tự áp dụng giới hạn 8 lượt/IP/phút. Sau này đổi lại về `4000` khi chạy toàn bộ microservices.

**Kiểm tra:** Mở JobFind, nhấn nút **Hỗ trợ** góc phải, chọn một câu hỏi gợi ý. Nếu thấy lỗi giới hạn, hãy kiểm tra quota trên Google AI Studio. Nếu frontend báo lỗi mạng, kiểm tra `URL_REACT`, `REACT_APP_BACKEND_URL`, Gateway và backend. Endpoint: `POST /api/support-chat`, payload `{ "messages": [{ "role": "user", "text": "Tìm việc React tại Hà Nội" }] }`, phản hồi là các sự kiện SSE `token`, `tool`, `done` hoặc `error`. Cần database có tin tuyển dụng đang mở đã duyệt và chủ sở hữu/công ty đang hoạt động để thử chức năng tìm kiếm; nếu database rỗng sẽ báo không tìm thấy. Không gửi nguyên API key lên trình duyệt để tự debug.

## Kiểm tra mã nguồn

Từ thư mục `backend/`:

```bash
node --test tests/services/supportChatService.node.test.cjs tests/services/supportJobTools.node.test.cjs tests/services/supportToolCalling.node.test.cjs
```

Từ thư mục `frontend/` (sau khi đã chạy `npm install` bình thường của dự án):

```bash
CI=true npm test -- --watchAll=false --runInBand --testPathPattern=supportChat
npm run build
```

Các kiểm thử mock không gọi API Google hoặc kết nối database. Muốn xác nhận kết nối AI thật, bạn **phải tự thêm key hợp lệ và chạy toàn hệ thống**; không có key thật trong bản vá. Các kiểm thử Jest/CRA và bản build cần `node_modules` của JobFind, không được đóng gói trong ZIP này.

## Bảo mật và bước tiếp theo

Không gửi CV thật, mật khẩu, OTP hoặc thông tin riêng tư lên Gemini free tier khi chưa đánh giá điều khoản dữ liệu và quyền riêng tư. Chatbot chỉ được truy vấn thông tin tuyển dụng CÔNG KHAI của JobFind, không được truy cập dữ liệu cá nhân, ngay cả khi người hỏi đã đăng nhập; tuyệt đối không mở quyền chỉ bằng cách thêm tên người dùng vào prompt. Nếu sau này cần kiểm tra trạng thái ứng tuyển, hãy bổ sung API có xác thực JWT, kiểm tra quyền và nhận **ID người dùng từ token đã xác thực**, không lấy từ nội dung tin nhắn. Để có handoff/ticket/đội chăm sóc khách hàng thật, cần thiết kế riêng bảng hội thoại hoặc tích hợp Chatwoot; bản này chưa tuyên bố có các chức năng đó.

## Danh sách tệp bản vá

- `frontend/src/App.js` — gắn widget trong Router/SessionContext.
- `frontend/src/components/support/SupportChat.jsx`, `SupportChat.css`, `supportChatStorage.js`, `supportChatStorage.test.js` — giao diện và lịch sử.
- `frontend/src/service/supportChatService.js`, `supportChatService.test.js` — SSE client và kiểm thử.
- `backend/src/routes/web.js`, `server.js`, `controllers/supportChatController.js`, `services/supportChatService.js`, **`services/supportJobTools.js`**, `middlewares/rateLimit.js`, `.env.example` — endpoint hỗ trợ AI, function calling công cụ chỉ đọc, stream và giới hạn.
- `backend/tests/routes/web.test.js`, `backend/tests/config/infrastructure.test.js`, `backend/tests/services/supportChatService.node.test.cjs`, **`supportJobTools.node.test.cjs`**, **`supportToolCalling.node.test.cjs`** — tương thích test route cũ và kiểm thử công cụ.
- `microservices/api-gateway/src/app.js` — proxy SSE riêng, rate limit và xử lý body JSON.
