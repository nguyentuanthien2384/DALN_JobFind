# Tạo CV và đối chiếu CV bằng AI

JobFind đã có AI đọc CV PDF, đánh giá nội dung CV và soạn thư ứng tuyển. Phần mở rộng này bổ sung **tạo bản nháp CV từ thông tin ứng viên** và **đối chiếu PDF trong hồ sơ ứng viên của nhà tuyển dụng**. Các chức năng dùng AI Worker và cấu hình API hiện có trên máy chủ.

## Dành cho ứng viên

1. Đăng nhập tài khoản ứng viên, mở `/candidate/ai-cv`.
2. Trong **Chức năng**, chọn **Tạo CV bằng AI**.
3. Nhập thông tin thực tế: họ tên, liên hệ, vị trí mong muốn, kinh nghiệm, dự án, học vấn và kỹ năng; tối đa 20.000 ký tự.
4. Có thể chọn công việc mục tiêu để AI điều chỉnh cách trình bày. Chọn tiếng Việt hoặc tiếng Anh rồi bấm **Gửi yêu cầu AI**.
5. Bấm **Xem và chỉnh sửa toàn bộ CV**, kiểm tra nội dung, sau đó **Lưu CV** hoặc **Xem trước / tải PDF bản nháp**.

AI chỉ được yêu cầu sử dụng thông tin ứng viên cung cấp, không thêm kinh nghiệm, thành tích hay bằng cấp. Người dùng vẫn cần kiểm tra bản nháp trước khi sử dụng. Xuất PDF hoạt động độc lập với cờ bật quy trình ứng tuyển bằng CV đã chuẩn bị.

## Dành cho nhà tuyển dụng

1. Mở **Tìm ứng viên phù hợp** tại `/admin/list-candiate/`.
2. Chọn tin tuyển dụng của công ty và dùng bộ lọc để tìm ứng viên.
3. Mở hồ sơ để phân tích AI. Quyền xem CV và lượt xem vẫn được kiểm tra theo cơ chế hiện có; mở lại hồ sơ đã được cấp quyền không trừ lượt mới.
4. Trong **Đối chiếu nội dung CV**, chọn tin và bấm **Phân tích CV bằng AI**.
5. Đọc điểm tham khảo từ 0–100, kỹ năng phù hợp, kỹ năng chưa thấy bằng chứng, điểm mạnh và các nội dung cần xác minh.

Điểm ở danh sách tìm kiếm vẫn là điểm khớp tiêu chí khai báo. Phần AI đọc nội dung PDF sau khi mở hồ sơ và chạy theo thao tác của người tuyển dụng. Hệ thống không tự loại ứng viên hay thay đổi trạng thái tuyển dụng. Kết quả gắn với nội dung tại thời điểm gửi yêu cầu.

PDF tối đa 5 MiB, 20 trang và 30.000 ký tự có thể trích xuất. PDF chỉ chứa ảnh cần được chuyển thành PDF có lớp chữ trước khi dùng chức năng đối chiếu. AI Worker trích xuất chữ tại máy chủ và gọi mô hình một lần cho mỗi yêu cầu phân tích mới.

## Cấu hình và chạy

- `microservices/.env`: dùng `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` nếu có và `CLAUDE_MODEL` đã cấu hình. Luồng tạo CV qua gateway tùy chỉnh dùng `claude-sonnet-5` theo cơ chế đọc CV đang có; worker có thể nhận `CLAUDE_TEXT_MODEL` để đổi mô hình văn bản. Không đưa API key vào mã frontend.
- `frontend/.env`: `REACT_APP_CANDIDATE_AI_ENABLED=true` bật không gian AI cho ứng viên.
- Dùng `npm start` để chạy dự án. Khi sửa mã microservices, cần dựng lại image và khởi động lại các dịch vụ liên quan; chỉ tải lại trình duyệt không cập nhật mã trong container.

## API

- `POST /api/ai/generate-cv`: `{ sourceText, language: "vi" | "en", jobId? }`, dành cho ứng viên/quản trị viên. Tin mục tiêu của ứng viên phải là tin công khai được duyệt.
- `POST /api/ai/match-cv`: `{ jobId, resumeText }` hoặc `{ jobId, fileBase64, fileName? }`. Nội dung văn bản tối đa 10.000 ký tự; hai nguồn không được gửi đồng thời. Tài khoản công ty/nhà tuyển dụng chỉ dùng tin thuộc công ty mình.
- `GET /api/ai/tasks/:taskId`: trả trạng thái và kết quả của yêu cầu. Quyền đọc gắn với người gửi; kết quả nhà tuyển dụng còn yêu cầu tài khoản thuộc đúng công ty đã gửi và công ty vẫn hoạt động, được duyệt. Quản trị viên có quyền quản trị.

Hai API ghi trả `202` cùng `taskId`. Yêu cầu đi qua bảng tác vụ, outbox, hàng đợi, AI Worker và bộ tiếp nhận kết quả. Trình duyệt giữ mã yêu cầu, dấu kiểm tra nội dung và mã tác vụ để khôi phục; không lưu PDF, nội dung CV hay kết quả AI vào bộ nhớ trình duyệt. Khi kết nối gián đoạn, dùng lại yêu cầu hiện tại; không tự tạo yêu cầu AI mới. Dữ liệu đầu vào được xử lý qua dịch vụ AI đã cấu hình khi người dùng bấm gửi.

## Kiểm tra trực tiếp bằng dữ liệu giả

Các lệnh dưới đây cần hệ thống local đã chạy và thực hiện một yêu cầu AI có tính phí mỗi lần. Script tạo tài khoản/dữ liệu thử riêng và dọn đúng dữ liệu đã tạo sau khi tác vụ kết thúc.

```powershell
$env:AI_DEMO_LIVE = 'true'
$env:AI_DEMO_MODE = 'generate'
node backend/scripts/test-ai-demo-browser.cjs
node backend/scripts/test-ai-screening-browser.cjs
Remove-Item Env:AI_DEMO_MODE, Env:AI_DEMO_LIVE
```

Báo cáo và ảnh kiểm tra nằm trong `.local/ai-generate-browser` và `.local/ai-screening-browser`.
