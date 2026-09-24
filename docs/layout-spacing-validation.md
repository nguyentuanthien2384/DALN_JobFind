# Kiểm tra khoảng trắng và cuộn trang — 24/09/2026

Đã sửa các nguyên nhân dùng chung gây khoảng trắng dư: khoảng đệm dành cho header cũ trên trang chat/ứng viên; chiều cao sidebar làm kéo dài trang quản trị; padding footer bị cộng hai lần; chiều cao danh sách giữ nguyên sau khi chuyển sang trang ít kết quả; banner và khoảng đệm quá lớn trên trang công khai.

## Phạm vi thay đổi

- Quản trị: nội dung bắt đầu cách header 24px trên desktop, 16px trên điện thoại. Sidebar dài cuộn riêng, cả khi thu gọn. Menu con vẫn bấm được, dùng bàn phím được và giữ trong màn hình khi đổi kích thước cửa sổ.
- Tin nhắn: bỏ khoảng đệm trên 100–140px; lịch sử cuộn trong khung; tin mới không kéo cả trang. Khung nhập chừa chỗ cho nút Hỗ trợ. Màn hình thấp hoặc bản nháp đính kèm lớn được phép cuộn theo nội dung, tránh làm mất vùng nhập và lịch sử.
- Ứng viên/công ty/bảo mật: bỏ chiều cao/offset kế thừa từ giao diện quản trị; thu gọn biểu mẫu và khoảng cách; tên dài được xuống dòng trên điện thoại.
- Trang chủ/việc làm/giới thiệu/liên hệ: thu gọn banner tiêu đề và padding; thẻ việc làm/các ngành nghề trên điện thoại gọn hơn.
- Phân trang: chỉ giữ chiều cao trong lúc đang tải; khi tải xong, danh sách ngắn hoặc rỗng thu lại theo nội dung thực tế.

Không khóa thanh cuộn của toàn bộ trang. Trang nhiều nội dung vẫn cuộn bình thường.

## Kết quả xác minh

- Toàn bộ frontend: **99 suites / 1.795 tests đạt**.
- Sau sửa bổ sung menu và khung chat: chạy lại **34 tests liên quan**, tất cả đạt.
- Frontend lint: đạt. Bản dựng production: `Compiled successfully`.
- Trình duyệt Chromium: **58 trường hợp trang/kích thước màn hình đạt**: 20 công khai, 12 quản trị, 18 ứng viên/công ty/bảo mật, 8 chat; kèm kiểm tra phân trang đang tải, menu bằng chuột/bàn phím và thay đổi kích thước cửa sổ.
- Kiểm tra chat dùng hội thoại dài 35 tin, ở 1440×900, 1280×720, 390×844 và 360×640 cho cả ADMIN và CANDIDATE. Không tràn ngang, không lỗi ResizeObserver, lịch sử có vùng cuộn riêng; vùng nhập sử dụng được cả trên màn hình thấp.
- Dữ liệu API và socket của các bài kiểm tra bố cục đều được giả lập. Các bài kiểm tra này không xác minh gửi tin thật, không sử dụng API trả phí và không sửa dữ liệu tài khoản.

## Chạy lại

Khởi chạy ứng dụng bằng `npm start`, chờ `npm run dev:status` báo sẵn sàng, rồi chạy từ thư mục dự án:

```powershell
node backend/scripts/test-public-spacing.cjs
node backend/scripts/test-admin-layout-browser.cjs
node scripts/check-candidate-layout.cjs
node backend/scripts/test-chat-layout-browser.cjs
npm --prefix frontend run test:unit
npm --prefix frontend run lint
npm --prefix frontend run build
```

Ảnh và số đo công khai lưu tại `.local/public-spacing/`; chat tại `.local/spacing/chat/`. Script ứng viên in đường dẫn ảnh tạm khi hoàn tất. Kết quả frontend lần kiểm tra này ở `.local/spacing-frontend-tests.json` và các log `.local/spacing-*.log`.
