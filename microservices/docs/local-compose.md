# Chạy JobFind trên máy hiện tại bằng Docker Compose

Phạm vi: một máy phát triển, chỉ công bố cổng trên `127.0.0.1`. Đây **không phải** cấu hình sẵn sàng đưa lên Internet. Backend cũ và MySQL/XAMPP vẫn ở máy chủ; frontend không được đóng gói trong image microservices này.

## Thay đổi tương thích cần biết

- Backend đăng nhập, Gateway và Socket.IO dùng cùng `JWT_SECRET`, `JWT_ISSUER=jobfind-auth`, `JWT_AUDIENCE=jobfind-api`, `JWT_ACCESS_TTL_SECONDS=900`. Có thể cấu hình tuổi token từ 60 đến 3600 giây, nhưng phải giống nhau ở backend và Gateway.
- Token cũ thiếu audience/khác issuer không còn dùng được. Cập nhật backend và Gateway trong cùng đợt rồi **đăng nhập lại**. Chưa có cơ chế refresh token; hết phiên cần đăng nhập lại. Không bật chế độ chấp nhận token cũ để bỏ qua kiểm tra.
- `/status` yêu cầu tài khoản ADMIN đang hoạt động. `/metrics` dùng Bearer token riêng, không nhận JWT đăng nhập hay khóa giao tiếp nội bộ.
- `/health` và `/healthz` chỉ báo tiến trình HTTP còn sống. `/readyz` trả 503 khi chưa sẵn sàng, dependency lỗi hoặc đang dừng. Không dùng liveness để kết luận DB/broker tốt.
- AI Worker mở cổng vận hành 4007 **bên trong Docker**, không có API nhận việc và không công bố cổng ra máy chủ. Thiếu API key thì readiness thất bại; không thể coi tác vụ AI đã được kiểm chứng chỉ vì container chạy.
- JSON thường giới hạn 1 MiB; yêu cầu parse-resume 12 MiB ở lớp HTTP, sau đó lớp nghiệp vụ vẫn giới hạn dữ liệu AI 8 MiB. Các route upload legacy được liệt kê riêng trong `shared/httpBoundary.js` còn giữ 50 MiB để tránh phá tương thích; cần tiếp tục chuyển chúng sang upload file riêng.
- Login và AI trả 503 khi bộ giới hạn Redis không hoạt động. Các route công khai vẫn cho phép tiếp tục theo chính sách sẵn có.
- Các API microservice mới chỉ nhận JSON đúng schema; trường lạ, ID sai, phân trang/khoảng ngày sai trả 400, media type sai trả 415. Không gửi nguyên đối tượng DB khi cập nhật CV/profile. Xem `http-contracts.md` và `contracts/http/gateway.openapi.json` trước khi chuyển ứng dụng. Route legacy ngoài namespace mới không bị áp dụng schema này.

## Chuẩn bị trước khi chuyển cấu hình

1. Sao lưu và kiểm tra khả năng phục hồi MySQL, PostgreSQL, MongoDB và dữ liệu RabbitMQ trước khi đổi các container có dữ liệu. Startup hiện vẫn còn DDL kiểm tra/tạo bảng; việc tách migration thành job riêng chưa hoàn thành.
2. Giữ nguyên project Compose `ai-job-portal`, tên volume và thông tin kết nối trong `.env`. Không tạo project mới rồi hiểu nhầm các volume trống là dữ liệu đã mất. Không chạy `down -v`, không xóa/recreate RabbitMQ để thử sửa lỗi.
3. Kiểm tra volume hiện tại của RabbitMQ. Compose gốc chưa khai báo volume có tên cho broker; không được tự chuyển sang một volume trống. Cần một đợt di chuyển có sao lưu/khôi phục trước khi nghiệm thu khả năng lưu giữ message qua recreate container.
4. Đồng bộ các biến JWT ở `backend/.env` và `microservices/.env`; không đưa khóa thật vào Git. `INTERNAL_SECRET` phải khác JWT secret, đủ ngẫu nhiên và không dùng chuỗi ví dụ. User DB báo cáo hiện chưa được tách quyền ở máy thật; cần cấp riêng thay vì tiếp tục dùng root trong môi trường có dữ liệu thật.

Các lệnh dưới đây chạy tại thư mục `microservices`:

```powershell
npm run local:prepare
npm run contracts:check
docker compose -f docker-compose.yml -f compose.local.yml --profile monitoring config --quiet
docker build -t jobfind-microservices:local .
npm run test:image
```

`local:prepare` chỉ tạo `.secrets/metrics-token` nếu chưa có; không ghi đè khóa cũ và không in khóa ra màn hình. Giới hạn quyền đọc thư mục này bằng ACL của tài khoản Windows. Compose secrets dạng file không thay thế hệ thống quản lý secret cho production.

Sau khi đã chuẩn bị sao lưu và đồng bộ backend/Gateway, chuyển các **ứng dụng** sang image mới; lệnh này không tái tạo hạ tầng:

```powershell
docker compose -f docker-compose.yml -f compose.local.yml up -d --no-deps api-gateway identity-service job-core-service search-service application-service notification-service admin-service ai-worker
docker compose -f docker-compose.yml -f compose.local.yml --profile monitoring up -d --no-deps prometheus
npm run local:ps
```

Chỉ dùng `npm run local:up` khi chủ động muốn Compose quản lý cả hạ tầng sau kiểm tra/sao lưu. Không đồng thời chạy bộ Compose mới với một project name khác nhưng cùng cổng.

## Image, giám sát và kiểm chứng

- Dockerfile dùng Node image ghim digest, `npm ci` theo lockfile, không cài dev dependency, không copy `.env`/secret, chạy user `node`. Các service dùng entrypoint riêng từ một image workspace; mã nguồn không còn bind-mount trong overlay.
- Overlay đặt filesystem chỉ đọc, `/tmp` tạm, bỏ Linux capabilities, giới hạn RAM/CPU/PID và log rotation. Các giới hạn là điểm khởi đầu cho máy local, **chưa phải kết quả capacity/load test**.
- Prometheus ở `http://localhost:9091`, dữ liệu giữ tối đa 7 ngày/1 GB. Giao diện này chỉ dành cho máy local. Các endpoint microservice được scrape bằng secret riêng.
- Các metric đã có: request count/duration/active, runtime Node, readiness, số event outbox chưa publish và tuổi event cũ nhất, số task AI theo trạng thái và tuổi task pending. Nhãn route dùng mẫu `/jobs/:id` hoặc tên proxy, không dùng ID người dùng/job/email/query string.
- Cảnh báo: không scrape được, chưa ready, tỷ lệ HTTP 5xx trên 2% trong 10 phút, outbox cũ trên 60 giây, AI pending trên 5 phút. Đây là cảnh báo hiển thị trong Prometheus; **chưa cấu hình Alertmanager gửi email/chat**. Dashboard Grafana, DLQ exporter và tracing xuyên RabbitMQ chưa có.
- `npm run test:image` chạy một container tạm, không mạng ngoài/DB thật/AI/SMTP, kiểm tra user không phải root, liveness, readiness thất bại đúng lúc, quyền `/status` và `/metrics`, giới hạn body, chặn fallback sai method, OpenAPI đóng gói đúng nguồn và SIGTERM sạch.
- CI mới chạy test microservices/backend, kiểm tra dependency, build image theo commit SHA, kiểm thử image và kiểm tra rule Prometheus. Workflow chưa được chạy trên GitHub trong lần thay đổi này; chưa có push/deploy, registry signing hay quét hệ điều hành image.
- Root dependency `express`/`qs` và override `qs` được giữ có chủ đích để toàn bộ workspace dùng bản vá `qs` 6.16.0; kiểm tra bằng `npm ls qs` và `npm audit`, không chỉ nhìn phiên bản gốc trong manifest.

## Khi có sự cố

### Dịch vụ không ready

Xem trạng thái container và log của đúng service. Kiểm tra kết nối tới DB/Redis/RabbitMQ tương ứng. Gateway readiness kiểm tra MySQL xác thực và Redis, không làm toàn Gateway unready chỉ vì Search hỏng; lỗi downstream vẫn được tách qua circuit breaker. Không lộ chi tiết dependency/secret trong phản hồi health công khai.

### Outbox hoặc AI bị kẹt

Kiểm tra tuổi event, connection, confirm và lỗi DB. Không đánh dấu `publishedAt` bằng tay, không xóa pending row. Một publish đã confirm nhưng DB chưa ghi được marker có thể được giao lại; consumer phải dedup bằng eventId. Với AI/SMTP ở trạng thái chưa biết kết quả, kiểm tra ledger trước, không replay hàng loạt vì có thể gọi AI trả phí/gửi email lần nữa.

### Dừng ứng dụng

SIGTERM đổi trạng thái sang draining, ngừng nhận HTTP mới, hủy đăng ký consumer, đợi HTTP/task/relay đang chạy, rồi đóng DB và broker. Thời gian tối đa 30 giây (AI Worker 60 giây), Compose đợi thêm 10 giây. Quá hạn sẽ thoát lỗi, không tuyên bố drain thành công; message chưa ACK được broker giao lại, outbox có lease được xử lý lại sau thời hạn khóa. Không dùng `kill -9` như quy trình dừng bình thường.

### Rollback

Giữ image đã kiểm chứng theo commit SHA trước mỗi đợt. Gán `JOBFIND_IMAGE` về image trước đó và chạy lại các ứng dụng với `--no-deps --no-build`; không xóa volume. Khi rollback thay đổi JWT, backend phát token và Gateway/Socket xác thực phải cùng chính sách. Không tự động rollback schema hoặc xóa các bảng inbox/outbox/ledger: cần giữ dữ liệu và lịch sử chống trùng.

## Mốc kiểm thử lần bổ sung này

Ngày 05-09-2026, sau đợt hợp đồng HTTP: 495 kiểm thử backend, 696 kiểm thử microservices, 19 kiểm tra tích hợp MySQL/RabbitMQ/HTTP trong container dùng một lần đã qua. Trong đó có 134 kiểm thử HTTP/OpenAPI/frontend và các kiểm tra phản hồi controller. Image Gateway đã build lại và qua bài kiểm thử cách ly; `npm audit --omit=dev` không báo lỗ hổng. Các số này không chứng minh toàn hệ thống đạt SLO, chạy tải cao hoặc đã triển khai bản mới lên các container đang phục vụ người dùng.
