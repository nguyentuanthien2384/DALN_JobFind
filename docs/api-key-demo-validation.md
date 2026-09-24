# Kiểm thử API key và chuẩn bị demo — 24/09/2026

Đối chiếu ba PDF người dùng cung cấp với mã hiện tại: báo cáo Authentication/Authorization/SSO (28 trang), nghiên cứu chatbot (34 trang) và đánh giá Microservices (57 trang). Các PDF mô tả mã ở thời điểm trước, có cả đề xuất và phương án thay thế; không coi toàn bộ ví dụ trong PDF là yêu cầu triển khai đồng thời.

## Phạm vi đã hoàn tất

Phần trước đây bị thiếu bằng chứng vì chưa có key là chatbot và bốn loại tác vụ AI Worker. Cấu hình hiện tại dùng key tương thích Anthropic qua gateway tùy chỉnh; kiểm thử đã gọi provider thật bằng dữ liệu công khai/tổng hợp, không dùng CV cá nhân có sẵn. Không lưu key hoặc token vào báo cáo.

- **Chatbot qua Gateway thật:** tám tình huống ban đầu hoàn thành, gồm bảy câu trả lời Claude và một yêu cầu xem đơn ứng tuyển của khách được xử lý cục bộ bằng thông báo đăng nhập. Đã đọc nội dung: hướng dẫn CV, tìm việc/no-match, bảo vệ thông tin riêng tư, chống yêu cầu tiết lộ key, chuyển nhân viên, thanh toán và hỏi thiếu ngữ cảnh. Thời gian toàn lượt AI trong mẫu đầu khoảng 5,3–13,8 giây; đây không phải p95 hay benchmark tải.
- **Công cụ/nguồn:** evaluator bổ sung xác minh SSE hoàn chỉnh, nội dung lưu bằng nội dung nhận được, công cụ bắt buộc đã chạy, thẻ/liên kết chỉ dùng ID đã xác minh và nguồn thuộc kho đã duyệt. Tìm việc và bộ lọc phức tạp qua Gateway đều đạt. Hỏi tiếp tin thật được bỏ qua có ghi nhận vì không có tin phù hợp còn hạn.
- **Bốn ca chatbot với dữ liệu tổng hợp:** tìm thấy một tin, hỏi tiếp đúng mã, đọc yêu cầu ở cuối mô tả dài và không tự bổ sung phần bị cắt; bỏ qua chỉ dẫn độc hại trong mô tả; không khẳng định tin đáp ứng remote/kinh nghiệm/lương khi chưa có căn cứ. Cả bốn dùng Claude thật qua adapter AI SDK, công cụ dùng fixture; không qua Gateway/database. Đã đọc câu trả lời và đối chiếu dữ liệu fixture.
- **Browser chatbot thật:** gửi một câu, nhận Claude, lưu/mở lại lịch sử sau reload không phát sinh lượt AI thứ hai, bố cục desktop/mobile và xóa hội thoại đều đạt.
- **AI Worker:** đọc PDF thành CV có cấu trúc; hồ sơ React phù hợp đạt 98/100, hồ sơ làm bánh không có kỹ năng lập trình đạt 0/100 trong mẫu; thư tiếng Việt 294 từ, tiếng Anh 194 từ; tin hợp lệ được chấp nhận, tin thu tiền đặt cọc bị từ chối với mức rủi ro nguy hiểm. Kết quả mẫu là bằng chứng chức năng, không phải thước đo tuyển dụng được hiệu chuẩn.
- **Tính bền vững của tác vụ:** năm ca CV/matching/thư đi qua controller HTTP → MySQL outbox → RabbitMQ → Worker/model → Mongo ledger → RabbitMQ → MySQL result → HTTP polling. Hai ca moderation xác minh queue → Worker/model → result và ledger; không đổi trạng thái tin thật. Gửi lại HTTP cùng key và phát lại tác vụ không gọi model lần nữa.
- **Browser ứng viên thật:** đăng nhập tài khoản tổng hợp, xem trước PDF, gửi đúng một tác vụ; xác minh outbox đã phát, Worker ledger đã publish và result inbox đã apply; hiển thị kết quả, reload chỉ đọc lại, sửa/tạo/cập nhật/xóa CV trong MongoDB, bố cục mobile đều đạt. Dữ liệu QA được dọn theo chính xác chủ sở hữu/mã tác vụ.
- **Tái kiểm chứng bản sửa trên ứng dụng đang chạy:** dựng lại dịch vụ và chạy lại browser với PDF tổng hợp có BOM/khoảng trắng. Xem trước, gửi API, nhận kết quả AI, reload, sửa/lưu/xóa CV và cleanup đều đạt với đúng một tác vụ mới.
- **Auth/SSO:** 274 unit test liên quan đạt (nằm trong tổng hồi quy bên dưới); tích hợp MySQL riêng, OIDC/JWKS/RSA và GitHub giả lập local đạt. Browser thật qua Gateway kiểm tra login, cookie HttpOnly, nhiều tab, logout-all, đổi mật khẩu và từ chối JWT đã thu hồi. Không cần sửa mã Auth trong đợt này.

## Lỗi đã sửa và phần phát triển thêm

1. **PDF bị từ chối không thống nhất:** Worker đã cho phép UTF-8 BOM/khoảng trắng đầu tệp, nhưng API, bộ đọc CV trên giao diện và trình xem trước yêu cầu `%PDF-` ngay byte đầu. Dùng chung `shared/aiPdf.js` cho HTTP và Worker, đồng bộ quy tắc với helper phía trình duyệt cho upload/xem trước; giữ nguyên byte tệp, vẫn chặn base64 sai, header quá xa, file không phải PDF và kích thước trên 5 MiB khi gửi AI. Thêm regression ở HTTP, Worker, upload và preview, gồm ranh giới kích thước.
2. **Bằng chứng chatbot có thể báo thành công quá dễ:** evaluator cũ chỉ tìm chuỗi `event: done` trong response. Nay phân tích từng SSE event, phân biệt lỗi/stream bị cắt/fallback và so sánh nội dung đã lưu. Có năm ca regression, gồm Unicode/dấu phân cách bị chia giữa chunk và câu trả lời chứa chuỗi giống event hoàn tất.
3. Thêm các runner opt-in cho AI Worker qua hạ tầng cách ly, CV browser thật, chatbot browser thật và chatbot fixture thật; phục hồi `CHATBOT_SETUP.md` mà README và tài liệu cũ đang liên kết tới nhưng thiếu file.

## Kết quả kiểm thử mã

- Backend: **82 bộ / 1.818 ca đạt**.
- Frontend sau bản sửa: **99 bộ / 1.795 ca đạt**.
- Microservices sau bản sửa: **68 bộ / 1.305 ca đạt**.
- Tổng ba bộ: **4.918 ca đạt**; thêm **26 ca runtime** đạt. Không cộng lặp 274 ca Auth vào tổng.
- Frontend lint, build production và kiểm tra hợp đồng HTTP/event đều đạt. Unit test/mô phỏng không được tính là lượt gọi provider thật.

## Lệnh chạy lại

Chạy `npm start`, chờ `npm run dev:status` báo ứng dụng sẵn sàng tại `http://localhost:3001`. Các kiểm thử thường: `npm test`, `npm run test:runtime`, `npm run lint`, `npm run build`, `npm --prefix microservices run contracts:check`.

Các lệnh sau dùng hạn mức API:

```powershell
npm --prefix microservices run test:ai:live -- --live
npm --prefix microservices run test:support:live
npm --prefix microservices run test:support:live:fixtures
npm --prefix microservices run test:support:live:browser
$env:AI_DEMO_LIVE = 'true'
npm --prefix backend run test:ai:browser:live
Remove-Item Env:AI_DEMO_LIVE
```

Runner AI cách ly cần Docker và các image `mysql:8.0`, `mongo:7`, `rabbitmq:4-management-alpine` có sẵn; không tự tải image. Có thể chạy riêng hai ca moderation bằng `--only=moderation_safe,moderation_scam`. CV browser dùng tài khoản QA mới, database đang chạy và CV tổng hợp có sẵn; không gửi email hoặc tạo tin tuyển dụng. Để kiểm tra bản sửa PDF đầu tệp, thêm `AI_DEMO_PDF_PREFIX=true`; kết quả nằm ở thư mục riêng và không ghi đè bằng chứng PDF thông thường.

## Bằng chứng lưu local

- `.local/api-key-unit-tests.log`, `.local/api-key-frontend-final.log`, `.local/api-key-microservices-final.log`, `.local/api-key-runtime-tests.log`, `.local/api-key-lint.log`, `.local/api-key-build.log`, `.local/api-key-contracts.log`.
- `.local/support-service-evaluation-baseline.json`, `.local/support-service-evaluation.json`, `.local/support-fixture-evaluation.json`, `.local/support-live-browser/`.
- `.local/ai-live/2026-09-24T05-59-43-395Z.json`: năm ca đầu đạt; hai ca moderation chưa gọi model do runner thiếu `occurredAt`. Đây là lỗi test runner, đã sửa. Counter bản đầu đếm cả `stream` và `create` cho thư nên ghi 7; số request provider thực tế của năm ca là 5. Giữ nguyên tệp gốc để không sửa lịch sử bằng chứng.
- `.local/ai-live/2026-09-24T06-20-19-371Z.json`: chạy lại đúng hai ca moderation còn thiếu, cả hai đạt, hai request; tài nguyên thử đã dọn. Counter mới chỉ đếm `create`.
- `.local/ai-demo-browser/report.json`, `.local/ai-demo-browser-prefixed/report.json`, ảnh desktop/mobile; `.local/auth-browser/`.

Các tệp `.local` chứa bằng chứng của máy này và được Git bỏ qua. Backup trước khi khởi chạy nằm trong `.local/backups/`; không sửa hàng loạt dữ liệu nguồn để ép ca kiểm thử thành công.

## Điều kiện demo còn cần lưu ý

- **Không có tin công khai còn hạn:** kiểm tra hiện tại có 25 tin công khai đều hết hạn; chatbot trả không tìm thấy là đúng. Muốn demo tìm việc đang mở/ứng tuyển, nhà tuyển dụng cần đăng hoặc gia hạn một tin phù hợp và được duyệt bằng luồng bình thường.
- **Google/GitHub/Auth0 thật chưa cấu hình:** Client ID/Secret trống và provider đang tắt. Key Claude không mở được các luồng này. Chưa nghiệm thu consent/token exchange với nhà cung cấp thật.
- **Email/OTP thật chưa nghiệm thu:** cấu hình backend là placeholder, trình chạy local tắt gửi email. Không có thư thật được gửi trong đợt này.
- **Xuất PDF CV đã chuẩn bị:** cờ `REACT_APP_PREPARED_CV_APPLICATION_ENABLED` hiện chưa bật; browser đã kiểm tra xem trước PDF đầu vào, chưa kiểm tra tải PDF bản nháp bằng cấu hình đang phục vụ. Đây không phải tính năng phụ thuộc API key.
- CV scan không có lớp chữ, tải đồng thời lớn, chi phí dài hạn, độ chính xác trên CV thực tế đa dạng và toàn bộ hạ tầng production chưa được chứng minh bởi đợt demo này. Dữ liệu thử tổng hợp không thay thế kiểm thử tải hoặc nghiệm thu production.
