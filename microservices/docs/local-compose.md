# Chạy JobFind trên máy hiện tại bằng Docker Compose

Phạm vi: một máy phát triển, chỉ công bố cổng trên `127.0.0.1`. Đây **không phải** cấu hình sẵn sàng đưa lên Internet. Backend cũ và MySQL/XAMPP vẫn ở máy chủ; frontend không được đóng gói trong image microservices này.

## Thay đổi tương thích cần biết

- Đợt 2g thay phần thông báo best-effort của 2f: quyết định manual và intent tác giả/follower lưu cùng transaction trong `outbox_events` MySQL hiện có. Backend mới cần outbox InnoDB cùng database với Job Core; bảng thiếu/sai engine trả 503 và rollback, không tự tạo bảng hoặc fallback SMTP. Tạm dừng kiểm duyệt để cập nhật **Notification/Admin consumer và binding `notification.manual_moderation_requested` trước → Job Core relay/catalog 14 event → toàn bộ backend legacy**; giữ frontend 2f. Broker confirm không thay thế việc xác nhận binding/consumer đã sẵn sàng. Mail trực tiếp đã bỏ cho bốn quyết định này; follower chỉ in-app. Giữ ledger và consumer mới khi đối chiếu backlog/rollback; không purge/recreate DB/broker/queue/volume. 2.322 test, 114 nhóm MySQL tạm, 5 nhóm RabbitMQ tạm và image local qua; chưa thay backend/container/schema thật. `job.updated`/dashboard invalidation manual và các publisher khác vẫn còn việc; xem `client-sync.md` đợt 2g.

- Đợt 2f: `accept-post`/`ban-post`/`active-post` legacy bắt buộc `expectedRevision` từ danh sách quản trị mới; client cũ bị 428, mã cũ bị 409. Nâng cấp backend và giao diện quản trị trong cùng cửa sổ, tạm dừng duyệt khi lệch phiên bản. Bảng `notes` phải InnoDB; nếu `job_moderation_state` đã có thì cũng phải InnoDB và backend có quyền đọc metadata/cập nhật request. Không tự đổi schema/engine. Giữ handler Job Core có request/state fence; chặn/mở lại và sửa legacy hủy request cũ trong transaction. Mở lại vẫn PS3 thủ công, không tự gọi AI. Mail/event legacy còn best-effort sau commit, chưa chuyển outbox. 107 nhóm tích hợp chạy trên MySQL tạm, chưa rollout stack thật; xem `client-sync.md` đợt 2f.

- Đợt 2e: cập nhật các backend legacy/Job Core có kiểm tra `expectedRevision` trước frontend. AddPost mới khóa Lưu nếu phản hồi đọc thiếu `editRevision`, giữ draft khi 409/timeout và chỉ bỏ bản nháp khi xác nhận tải lại. Không trộn writer cũ bỏ qua precondition; server còn cho phép client không gửi mã để tương thích nên các client đó chưa được bảo vệ. Không thêm schema; chưa rollout vào tiến trình/container thật. Khi rollback backend, rollback/dừng giao diện sửa tương ứng, không bỏ precondition để ép lưu. Xem `client-sync.md` đợt 2e; 88 nhóm tích hợp dùng MySQL riêng, không fixture sửa dữ liệu thật.

- Backend đăng nhập, Gateway và Socket.IO dùng cùng `JWT_SECRET`, `JWT_ISSUER=jobfind-auth`, `JWT_AUDIENCE=jobfind-api`, `JWT_ACCESS_TTL_SECONDS=900`. Có thể cấu hình tuổi token từ 60 đến 3600 giây, nhưng phải giống nhau ở backend và Gateway.
- Token cũ thiếu audience/khác issuer không còn dùng được. Cập nhật backend và Gateway trong cùng đợt rồi **đăng nhập lại**. Chưa có cơ chế refresh token; hết phiên cần đăng nhập lại. Không bật chế độ chấp nhận token cũ để bỏ qua kiểm tra.
- Frontend mới xử lý lỗi phiên của cả Gateway/legacy, phân biệt thiếu quyền với gián đoạn và hỗ trợ dừng chờ AI. Cập nhật backend để bỏ cờ logout trên lỗi ADMIN thiếu quyền trước khi phục vụ frontend mới; xem `client-sync.md`. Đợt này không tự chuyển API đăng tin sang Job Core hoặc bổ sung refresh token.
- Đợt hạn mức đăng tin: cập nhật backend legacy trước Job Core để cả hai cùng trừ lượt trong transaction. Công ty phải hoạt động/đã duyệt, đủ lượt và bốn bảng người dùng/công ty/tin/chi tiết phải là InnoDB; mã nguồn từ chối ghi khi không bảo đảm transaction, không tự sửa engine. Chưa chuyển endpoint frontend hoặc chống gửi POST lặp. Xem đợt 2a trong `client-sync.md` và chạy `npm run test:posting-quota:integration` trên MySQL tạm, không dùng script fixture ghi dữ liệu dự án thật.
- Đợt sửa tin 2b: cập nhật backend trước Job Core/frontend để các writer đều lưu chi tiết riêng cho tin đang sửa. Giữ tác giả/ngày hết hạn, không gia hạn miễn phí bằng sửa tin, không tự dọn snapshot cũ. Job Core nhận giới tính và ngày hết hạn gửi lại không đổi; chưa chuyển endpoint frontend. Bài tích hợp mở rộng: `npm run test:job-writes:integration`.
- `/status` yêu cầu tài khoản ADMIN đang hoạt động. `/metrics` dùng Bearer token riêng, không nhận JWT đăng nhập hay khóa giao tiếp nội bộ.
- Đợt 2d: backend chi tiết tin bổ sung mã Allcode gốc; cập nhật backend trước frontend để giữ được mã lịch sử khi nhãn bị xóa. Job Core thêm GET `/jobs/:id/manage` riêng tư, Gateway mở `/api/jobs/:id/manage`; cập nhật Job Core trước Gateway. Frontend đã dùng adapter cho dữ liệu legacy và chặn thao tác khi tải lỗi, nhưng chưa đổi endpoint đọc/ghi màn hình sang Job Core. Không có schema DB mới trong đợt này; không sửa/xóa Allcode để áp dụng. Xem `client-sync.md` đợt 2d.
- Đợt 2c: Job Core có đăng lại và idempotency cho đăng mới/đăng lại; màn hình và API legacy chưa chuyển. Sau sao lưu/kiểm tra schema, cập nhật Job Core trước Gateway và trước khi bật client mới. Startup tạo bảng InnoDB `job_request_keys`; giữ bảng cùng dữ liệu tin khi rollback/backup, không xóa key để thử lại. Key bắt buộc cho đăng lại, tùy chọn cho đăng mới modern; client mới luôn giữ key trước khi gửi. Ngày hết hạn mới phải trong tương lai, nguồn đăng lại phải đã hết hạn/chưa gỡ. Không có bảo đảm này trên writer legacy. Xem đợt 2c trong `client-sync.md`.
- `/health` và `/healthz` chỉ báo tiến trình HTTP còn sống. `/readyz` trả 503 khi chưa sẵn sàng, dependency lỗi hoặc đang dừng. Không dùng liveness để kết luận DB/broker tốt.
- AI Worker mở cổng vận hành 4007 **bên trong Docker**, không có API nhận việc và không công bố cổng ra máy chủ. Thiếu API key thì readiness thất bại; không thể coi tác vụ AI đã được kiểm chứng chỉ vì container chạy.
- JSON thường giới hạn 1 MiB; yêu cầu parse-resume 12 MiB ở lớp HTTP, sau đó lớp nghiệp vụ vẫn giới hạn dữ liệu AI 8 MiB. Các route upload legacy được liệt kê riêng trong `shared/httpBoundary.js` còn giữ 50 MiB để tránh phá tương thích; cần tiếp tục chuyển chúng sang upload file riêng.
- Login và AI trả 503 khi bộ giới hạn Redis không hoạt động. Các route công khai vẫn cho phép tiếp tục theo chính sách sẵn có.
- Các API microservice mới chỉ nhận JSON đúng schema; trường lạ, ID sai, phân trang/khoảng ngày sai trả 400, media type sai trả 415. Không gửi nguyên đối tượng DB khi cập nhật CV/profile. Xem `http-contracts.md` và `contracts/http/gateway.openapi.json` trước khi chuyển ứng dụng. Route legacy ngoài namespace mới không bị áp dụng schema này.
- Event mới có `x-payload-version: 1`; consumer kiểm tra schema trước nghiệp vụ, giữ nguyên backlog không đánh dấu. Kiểm tra pending outbox trên bản sao và thứ tự consumer trước producer theo `event-contracts.md`. Event pending cũ sai schema được giữ lại, không tự xóa/sửa để vượt kiểm tra.

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
- `npm run test:image` chạy một container tạm, không mạng ngoài/DB thật/AI/SMTP, kiểm tra user không phải root, liveness, readiness thất bại đúng lúc, quyền `/status` và `/metrics`, giới hạn body, chặn fallback sai method, HTTP/event contracts đóng gói đúng nguồn và SIGTERM sạch.
- CI mới chạy test microservices/backend, kiểm tra dependency, build image theo commit SHA, kiểm thử image, event trên broker cách ly và kiểm tra rule Prometheus. Lockfile backend đã được bỏ khỏi danh sách ignore để CI có thể cài đúng phiên bản. Workflow chưa được chạy trên GitHub trong lần thay đổi này; chưa có push/deploy, registry signing hay quét hệ điều hành image.
- CI đã bổ sung test/build frontend và tích hợp hạn mức trên MySQL dùng một lần cho cả writer Job Core lẫn legacy; không cần secret/dữ liệu dự án thật cho các bài này.
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

Ngày 05-09-2026, sau đợt hợp đồng event: 496 kiểm thử backend, 789 kiểm thử microservices, 19 kiểm tra tích hợp MySQL/RabbitMQ/HTTP và 5 nhóm kiểm tra hợp đồng event trên RabbitMQ trong container dùng một lần đã qua. Bao gồm kiểm thử HTTP/OpenAPI/frontend của đợt trước và kiểm thử payload/consumer của đợt này. Image Gateway đã build lại và qua bài kiểm thử cách ly; `npm audit --omit=dev` không báo lỗ hổng ở cả microservices và backend sau bản vá `qs`. Các số này không chứng minh toàn hệ thống đạt SLO, chạy tải cao hoặc đã triển khai bản mới lên các container đang phục vụ người dùng.

Mốc mới hơn cùng ngày, sau đợt đồng bộ hạn mức 2a: 823 test microservices, 516 test backend, 677 test frontend và 19 nhóm tích hợp hạn mức trên MySQL tạm đã qua. HTTP/event contracts vẫn khớp, image local được dựng lại và kiểm thử Gateway cách ly thành công. Đây là bộ tích hợp hạn mức riêng, không phải chạy lại bộ 19 kiểm tra AI ở mốc trước. Không sửa dữ liệu thật, đổi container đang chạy, build lại frontend hoặc push/deploy trong đợt 2a; xem `client-sync.md`.

Mốc đợt sửa tin 2b ngày 05-09-2026: 851 test microservices, 517 test backend, 677 test frontend và 38 nhóm tích hợp hạn mức+sửa tin đều qua. Đã tái hiện/sửa phản hồi snapshot cũ sau lock wait; có kiểm thử rollback, tin dùng chung chi tiết và kết quả AI cũ. Frontend build, contract check, image local build và Gateway image test đều thành công. Các bài kiểm thử chỉ dọn MySQL tạm do chúng tạo, không đổi schema/dữ liệu hoặc container ứng dụng thật; chưa push/deploy.
