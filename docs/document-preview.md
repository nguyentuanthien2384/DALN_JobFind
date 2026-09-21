# Xem trước PDF trong JobFind

Các màn hình dùng chung trình xem PDF.js / React-PDF, có chuyển trang, thu/phóng, vừa khung và tải bản gốc:

- **Cài đặt ứng viên:** CV đang lưu hoặc tệp CV vừa chọn, trước khi cập nhật hồ sơ.
- **Nộp CV:** CV tải từ máy, CV online và bản PDF tạo từ CV đã chuẩn bị. Trình xem đọc đúng dữ liệu sẽ gửi khi nộp hồ sơ.
- **CV đã nộp:** bản CV được lưu lúc ứng tuyển, dành cho người có quyền mở hồ sơ; thay CV cá nhân không thay đổi bản đã nộp.
- **Hồ sơ ứng viên từ bộ lọc CV:** xem tệp sau khi kiểm tra quyền/lượt xem của nhà tuyển dụng.
- **Hồ sơ công ty:** giấy tờ PDF vừa chọn, đã lưu và màn hình quản trị chỉ đọc.
- **CV và trợ lý AI:** xem PDF đã chọn trước khi gửi yêu cầu AI; tạo và xem bản PDF của CV đang soạn, kể cả bản nháp chưa lưu. Chức năng CV đã chuẩn bị vẫn tuân theo các cờ tính năng đang cấu hình.
- **Tin nhắn:** tiếp tục dùng API riêng tư của chat và trình đọc chung.

Trình xem chỉ tải khi người dùng bấm xem. CV chọn trên máy được đọc tại trình duyệt; xem trước không tự tải lên, nộp hồ sơ, lưu CV hay gọi AI. Khi đóng cửa sổ, đổi tài liệu hoặc kết thúc phiên, tác vụ đọc và tài nguyên tạm được thu hồi. Trong form ứng tuyển, Escape đóng trình xem trước và giữ form đang nhập.

## Tích hợp tại màn hình mới

Dùng `frontend/src/components/documents/PdfPreviewButton` với `source`, `fileName`, `label` và `disabled` tùy chọn. `source` nhận File/Blob, chuỗi `data:application/pdf;base64,...`, URL HTTP(S) hoặc đường dẫn cùng nguồn bắt đầu bằng `/`. Với PDF tạo bất đồng bộ, có thể mở `DocumentPreviewModal` bằng `source`, `fileName`, `onClose`.

Màn hình cần lấy nguồn tài liệu qua API có phân quyền trước khi truyền vào viewer. Viewer không cấp quyền truy cập hoặc bỏ qua lượt xem CV. URL ngoài dùng CORS, không nhận cookie hay token của JobFind. Máy chủ tài liệu cần cho phép CORS; nếu tệp không tồn tại, bị chặn quyền hoặc không phải PDF, cửa sổ báo lỗi và cho tải lại. Với URL bên ngoài không xem được trực tiếp, người dùng có thể bấm **Mở tài liệu gốc**. Không nhúng HTML hay điều hướng tới URL `javascript:`.

Giới hạn tải tệp của từng luồng hiện có giữ nguyên (ví dụ CV ứng tuyển và giấy tờ công ty 2 MB, chat 5 MB/100 trang). Trình đọc chung giới hạn 20 MB/300 trang và kích thước canvas; trang quá lớn được thu nhỏ khi xem. PDF.js, worker, font và CMap lấy từ dependency cùng phiên bản trên máy chủ, không lấy CV qua dịch vụ xem bên ngoài. Thư viện chỉ được nạp khi mở trình xem.

## Kiểm tra

```sh
npm --prefix frontend run test:unit
npm --prefix frontend run build
npm --prefix backend run test:documents:browser
npm --prefix backend run test:chat:media:browser
```

Bài `test:documents:browser` chạy trình đọc thật với dữ liệu PDF giả, không cần sửa database. Kiểm tra nguồn local/data/HTTP, byte tải xuống, quyền riêng tư với host ngoài, lỗi tệp, modal trong form, đóng khi hết phiên và kích thước mobile. Ảnh nằm trong `.local/document-preview-checks/`. Bài chat dùng database kiểm thử riêng như mô tả trong [hướng dẫn chat](chat-documents.md).
