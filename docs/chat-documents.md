# CV/PDF và tin tuyển dụng trong cuộc trò chuyện

Trong **Tin nhắn**, mở cuộc trò chuyện giữa ứng viên và nhà tuyển dụng thuộc công ty đã được duyệt:

1. Chọn **Đính kèm CV/PDF**, chọn PDF tối đa **5 MB, 100 trang**. Tài liệu hiện trong khung xem lại; người nhận chưa thấy tài liệu cho tới khi nhấn **Gửi**.
2. Nhấn **Xem PDF** để đọc ngay trong chat, chuyển trang, thu/phóng, vừa khung hoặc tải bản gốc. Có thể gửi riêng PDF hoặc kèm lời nhắn. Nhấn **Bỏ đính kèm** để đổi tài liệu trước khi gửi.
3. Chọn **Chia sẻ công việc** để tìm theo tên trong các tin công khai, còn hạn của công ty trong cuộc trò chuyện. Hai bên đều có thể chọn tin để hỏi hoặc trả lời về vị trí đó.
4. Người nhận có thể **Xem chi tiết bản đã gửi** ngay trong chat hoặc **Xem tin mới nhất** trên trang tuyển dụng. Bản đã gửi giữ nội dung tại thời điểm chia sẻ; nhà tuyển dụng chia sẻ lại để gửi bản cập nhật mới.

Enter gửi tin, Shift+Enter xuống dòng. Gửi CV trong chat để trao đổi trước không tự tạo hồ sơ ứng tuyển. Hiện hỗ trợ PDF; Word/ảnh cần xuất sang PDF trước. Chat hỗ trợ với quản trị viên vẫn dùng tin nhắn văn bản.

## Cài đặt và cập nhật

Cài các dependency đã khóa phiên bản trong `backend` và `frontend`, rồi chạy từ thư mục gốc:

```sh
npm run chat:migrate
npm start
```

`chat:migrate` sao lưu MySQL trước khi thêm bảng `ChatAttachments` và ba cột nullable của `ChatMessages`. Có thể chạy lại; không xóa tin nhắn cũ. Migration cũng có trong thư mục migrations của Sequelize. Khi một phiên phát triển đang chạy, dùng `npm run dev:stop`, cập nhật schema rồi `npm start` để backend/gateway nạp mã mới.

Frontend dùng `react-pdf`/PDF.js; backend kiểm tra cấu trúc tài liệu bằng `pdf-lib` trong worker có giới hạn thời gian và bộ nhớ. Worker, CMaps, font và WASM của đúng phiên bản PDF.js được chép từ dependency vào `frontend/public/pdfjs/` khi `prestart`, `prebuild` hoặc trình khởi chạy chung hoạt động. Không dùng CDN để đọc CV.

## Quyền truy cập và lưu trữ

- `POST /api/chat-attachments`: tải PDF với `receiverId`, `fileName`, `fileBase64`; trả về mã và thông tin tài liệu.
- `GET /api/chat-attachments/:id`: cần đăng nhập; chỉ người gửi và người nhận của tài liệu được mở. Người nhận chỉ mở được sau khi tin nhắn đã được gửi. Quan hệ chat phải còn hợp lệ.
- `GET /api/chat-jobs`: tìm theo `partnerId`, `search`, `limit`, `offset`; chỉ trả tin đang tuyển của đúng công ty.
- Tin nhắn chứa `attachmentId` hoặc `jobPostId`, kèm `clientMessageId`; dữ liệu PDF đi qua HTTP, không truyền trong Socket.IO hay lưu vào sessionStorage. Gửi lại dùng cùng mã tin để tránh bản trùng.
- Nội dung PDF lưu trong MySQL, được loại khỏi truy vấn metadata mặc định, không có URL công khai. API trả tài liệu dùng `Cache-Control: no-store`. Metadata vẫn hiện trong lịch sử; thông báo Web Push không chứa CV.
- Từ chối tệp sai định dạng, có mật khẩu, hành động PDF bị cấm hoặc quá giới hạn. Đây là kiểm tra cấu trúc, không thay thế dịch vụ quét virus. Giới hạn upload 10 lần/phút và 100 lần/ngày/tài khoản.
- PDF đã tải nhưng bỏ khỏi bản nháp hiện vẫn lưu riêng tư trong MySQL; chưa có tác vụ tự xóa tệp mồ côi. Cần tính dung lượng tài liệu vào kế hoạch sao lưu và lưu trữ của hệ thống.

## Kiểm tra

```sh
npm --prefix backend test -- --runTestsByPath tests/services/chatMediaService.test.js
npm --prefix backend run test:chat:media
npm --prefix backend run test:chat:media:browser
npm --prefix frontend run test:unit -- --runTestsByPath src/container/Chat/ChatPage.test.js src/container/Chat/reliableSend.test.js
npm --prefix frontend run build
```

Hai bài tích hợp dùng cấu hình MySQL trong `backend/.env` để **tạo database kiểm thử riêng** có tên ngẫu nhiên, dùng dữ liệu giả rồi xóa database đó. Tài khoản MySQL cần quyền tạo/xóa database kiểm thử; không sửa dữ liệu ứng dụng. Bài trình duyệt cần Chromium của Playwright, kiểm tra PDF thật, tải xuống, gửi/nhận qua socket, cập nhật công việc và giao diện mobile. Ảnh kiểm tra nằm trong `.local/chat-media-checks/`.
