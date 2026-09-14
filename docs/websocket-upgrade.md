# Nâng cấp WebSocket theo báo cáo DALN

## Phạm vi và kết quả

Đối chiếu báo cáo **“Báo cáo nghiên cứu sâu WebSocket trong DALN và so sánh với Sample A, Sample B”**, đặc biệt các trang 8–10, 15–30 và 32–38, với mã nguồn hiện tại. Giữ Socket.IO, JWT, quyền trò chuyện và MySQL sẵn có. Báo cáo được dùng làm tài liệu yêu cầu/khuyến nghị, không thực thi các đoạn mã minh họa nguyên văn.

### Gửi tin đáng tin cậy

- Client tạo `clientMessageId` bằng nguồn ngẫu nhiên của trình duyệt, lưu vào `sessionStorage` **trước khi gửi**, theo người dùng và người nhận. Tải lại cùng tab vẫn giữ mã. Không tự gửi nền sau khi tải lại.
- Chờ ACK tối đa 5 giây. Khi lỗi kết nối hoặc mất ACK, gửi REST với **cùng mã và nội dung**, timeout 10 giây. Lỗi nghiệp vụ có ACK không kích hoạt REST.
- Yêu cầu chưa xác nhận giữ nguyên nội dung và mã, có nút gửi lại. Không cho sửa một yêu cầu chưa rõ đã lưu hay chưa. Ngay cả khi REST dự phòng trả lỗi giới hạn tần suất, client vẫn giữ mã vì yêu cầu socket ban đầu có thể đã được lưu.
- Unique index `(senderId, clientMessageId)` bảo vệ cả yêu cầu đồng thời giữa nhiều máy chủ. Cùng mã/cùng nội dung trả lại bản ghi cũ; đổi nội dung hoặc người nhận trả `IDEMPOTENCY_CONFLICT`. Quyền hiện tại vẫn được kiểm tra trước khi trả dữ liệu gửi lại.
- Lưu trước khi phát. Chỉ phát khi tạo mới; lỗi phát tín hiệu không biến một bản ghi đã lưu thành kết quả gửi thất bại. ACK cũng được dùng để cập nhật giao diện. Tác vụ tải lại sau ACK không giữ nút gửi ở trạng thái đang chờ.
- REST cũ không có mã vẫn được nhận để tương thích, nhưng **không có bảo đảm chống trùng**. Bản frontend mới luôn gửi mã. Socket mới yêu cầu hợp đồng bên dưới; triển khai đồng bộ backend/frontend và yêu cầu tải lại các tab chạy bundle cũ.

### Kiểm soát truy cập và tải

- Kiểm tra Origin chính xác qua `allowRequest`, cho cả polling và WebSocket. Danh sách lấy từ `URL_REACT`, không wildcard/substring. Thiếu Origin, Origin `null` hoặc khác danh sách đều bị từ chối. Native client phải có thiết kế xác thực/chính sách riêng trước khi mở ngoại lệ.
- Chỉ nhận JWT qua `handshake.auth.token`; bỏ query token. Giữ HS256/issuer/audience/claims policy. Không lưu JWT trong dữ liệu phục hồi socket.
- Ngắt khi token hết hạn; kiểm tra tài khoản khi kết nối, mỗi hành động và mỗi 30 giây. Khóa tài khoản bằng API backend sẽ phát tín hiệu và ngắt toàn bộ socket của người đó. Thay đổi từ hệ thống khác được phát hiện bởi vòng kiểm tra. Không thêm refresh token hoặc thu hồi mọi JWT khi logout.
- `chat:send`, `chat:typing`, `chat:read`, `chat:presence` đều có kiểm tra dữ liệu và quyền. Typing dùng sự kiện volatile, không xếp hàng để gửi lại.
- Giới hạn 64 KiB mỗi packet, 2.000 ký tự nội dung, tắt compression; heartbeat 25 giây và timeout 20 giây.
- Mỗi người dùng: 30 tin mới/phút, 120 lần thử gửi/phút, 120 sự kiện/phút/loại, riêng typing 60/phút và tối đa 1 tín hiệu/750 ms/cặp. Giới hạn 30 lần kết nối xác thực/phút và **10 kết nối đồng thời**, tính chung các node khi dùng Redis.
- Lease kết nối có TTL 60 giây, gia hạn mỗi 30 giây và giải phóng khi đóng. Sau khi node chết, lease hết hạn giúp phục hồi dung lượng; không lưu đếm vĩnh viễn.
- Handshake được giới hạn 120/phút theo địa chỉ peer trực tiếp. Khi qua reverse proxy, đây có thể là IP proxy: cần giới hạn IP người dùng tại ingress và điều chỉnh ngưỡng phù hợp. Backend không tin `X-Forwarded-For` do client tự gửi.
- Giới hạn dùng Redis atomic khi cấu hình Redis; lỗi Redis không tự chuyển sang bộ đếm riêng từng node. Khi không cấu hình Redis, dùng bộ đếm trong tiến trình, chỉ phù hợp một backend.

### Phục hồi, đồng bộ và hiệu năng

- Connection State Recovery trong 120 giây, `skipMiddlewares: false`. Từ chối khôi phục room của người dùng khác. Client vẫn tải lại dữ liệu DB sau reconnect để bù cả trường hợp server đã lưu nhưng chưa phát được.
- Reconnect có backoff/jitter và không dừng sau 5 lần. Sự kiện browser `online` khởi động lại kết nối. Token thay đổi/logout giữa các tab đóng socket cũ; sự cố tạm thời khiến server ngắt kết nối được thử lại mà không tự gia hạn token.
- Khi đang kết nối, đối soát chat mỗi 120 giây. Khi mất kết nối, lùi dần khoảng 5 đến 30 giây kèm jitter. Bỏ qua khi tab ẩn/browser offline; làm mới khi quay lại. Đây là chính sách tần suất, không phải benchmark tải.
- Bỏ full-history transfer và gom nhóm bằng JavaScript: database tổng hợp ID tin cuối và số chưa đọc theo người nhận; ứng dụng chỉ tải các tin cuối. Truy vấn vẫn phải duyệt lịch sử phù hợp trong DB, chưa phải bảng tổng hợp duy trì sẵn. Cần EXPLAIN với dữ liệu đại diện trước khi tuyên bố cải thiện latency.
- Read receipt mang `throughMessageId`, tránh đánh dấu cả những tin đến sau snapshot. Đồng bộ trạng thái đọc ở các tab của người đọc và phía người gửi. Client giữ tin mới đến trong lúc REST đang tải, giữ trạng thái đã đọc đã biết và bỏ phản hồi của cuộc trò chuyện cũ khi người dùng chuyển màn hình.
- Presence kiểm tra được quyền và số socket thực, dùng được nhiều tab/nhiều node. Giao diện kiểm tra mỗi 30 giây khi mở cuộc trò chuyện. Chưa lưu lịch sử `lastSeen`.
- Dashboard hint chuyển từ toàn bộ kết nối sang room `feature:dashboard` chỉ dành cho ADMIN/COMPANY/EMPLOYER. Payload vẫn không chứa dữ liệu nghiệp vụ; chưa phân nhóm riêng theo từng công ty.

### Redis, vận hành và quan sát

- `SOCKET_REDIS_URL` là tùy chọn. Có cấu hình thì startup chờ Redis, thất bại sau tối đa khoảng 8 giây; không quảng bá API sẵn sàng trước đó. Shutdown đóng Socket.IO, Redis, rồi DB.
- Redis Streams Adapter dùng stream `jobfind:socket.io`, giới hạn mục tiêu 10.000 entries. Dữ liệu adapter/lease/limiter phải nằm trên Redis nội bộ có ACL/auth/TLS theo hạ tầng thực tế. Không dùng chung các prefix này giữa các môi trường.
- Multi-node có polling cần sticky routing. Có cấu hình tham khảo tại `scripts/release/nginx.socket-upstream.example.conf`; chưa tự thay cấu hình đang phục vụ. IP hash cần trusted real-IP setup nếu đứng sau CDN; ưu tiên affinity của ingress khi phù hợp.
- Metrics tại `GET /internal/socket-metrics`, yêu cầu `x-internal-secret` khớp `INTERNAL_SECRET`. Gồm kết nối đang hoạt động, kết nối bị từ chối, phục hồi, lý do ngắt, lỗi Origin/auth/Redis/rate limit, sự kiện theo kết quả và histogram thời gian xử lý.
- `SOCKET_LOG_EVENTS=true` bật log JSON gồm event, traceId, kết quả và thời gian. Không log JWT, nội dung chat hoặc ID phiên. Mỗi ACK có traceId. Đây là correlation tại handler, **chưa có distributed tracing OpenTelemetry** qua mọi service/SQL/Redis.

## Hợp đồng sự kiện

Yêu cầu gửi mới:

```json
{"v":1,"receiverId":8,"content":"Xin chào","clientMessageId":"8f32d66fea8b40f5901d559cd8a6f615"}
```

`clientMessageId`: 16–64 ký tự ASCII gồm chữ, số, `_`, `-`. ID người dùng là số nguyên dương an toàn. Không nhận `senderId` từ client; trường dư và phiên bản khác bị từ chối. `v` có thể bỏ trống để tương thích các lời gọi read/typing hiện tại, nhưng khi có chỉ nhận `1`.

- `chat:typing`: `{receiverId: 8}`.
- `chat:read`: `{partnerId: 8, throughMessageId: 123}`. Boundary có thể bỏ trống cho client cũ, khi đó đánh dấu toàn cuộc trò chuyện như trước.
- `chat:presence`: `{partnerId: 8}`; ACK có `{data: {partnerId, online, checkedAt}}`.
- ACK giữ `errCode`, `errMessage`, `data` và thêm `v`, `ok`, `code`, `retryable`, `traceId`; lỗi rate limit có `retryAfterMs`.
- `chat:new-message` giữ các trường tin nhắn, thêm `v:1`, `eventId:"chat:<database-id>"`, `occurredAt`. `eventId` dùng nhận diện, không phải API replay offset bền vững riêng.
- Mã lỗi chính: `AUTH_INVALID`, `AUTH_EXPIRED`, `AUTH_INACTIVE`, `AUTH_UNAVAILABLE`, `PAYLOAD_INVALID`, `CHAT_NOT_ALLOWED`, `CHAT_RECEIVER_NOT_FOUND`, `CHAT_MESSAGE_TOO_LONG`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`, `CONNECTION_LIMITED`, `INTERNAL_ERROR`.

## Cập nhật và quay lui

1. Sao lưu và kiểm tra đúng database đích theo quy trình dự án. Áp dụng migration **trước** khi chạy model/backend mới:

   ```sh
   cd backend
   npx sequelize-cli db:migrate --to migrationzzzz-chat-reliability.js
   ```

   Lệnh áp dụng cả migration trước đó còn pending, nên phải kiểm tra `db:migrate:status` trước. Migration mới thêm cột nullable và ba index, có thể chạy lại sau DDL bị gián đoạn. Nó đã được kiểm tra trên database riêng; chưa áp dụng vào dữ liệu đang dùng. Index có thể gây chờ ghi trên bảng lớn, cần chọn cửa sổ bảo trì.

2. Cập nhật dependencies từ lockfile, backend và frontend. `URL_REACT` phải chứa chính xác Origin người dùng truy cập (scheme, host, port), không thêm đường dẫn/dấu `/` cuối. Yêu cầu tab cũ tải lại vì hợp đồng socket đã được siết chặt.
3. Một node có thể bỏ `SOCKET_REDIS_URL`. Muốn bật nhiều node: tất cả dùng chung DB, JWT policy, Origin allowlist và Redis; cấu hình affinity ở tuyến thực sự chuyển tiếp `/socket.io/`.
4. TLS/WSS phải được cấu hình và nghiệm thu tại ingress thực tế. Timeout proxy hiện 75 giây phù hợp tổng heartbeat 45 giây; cấu hình mẫu không tự cấp certificate.
5. Khi quay lui application, giữ cột/index mới cùng dữ liệu `clientMessageId`. Không xóa khóa chống trùng khi vẫn có yêu cầu chưa xác nhận. `down` chỉ dành cho môi trường đã dừng ghi và đã xử lý hết pending; không dùng để quay lui nóng.

## Kiểm thử

```sh
npm --prefix backend test
npm --prefix frontend run test:unit
npm --prefix frontend run build
```

Kiểm thử hạ tầng yêu cầu hai endpoint **thử nghiệm riêng** trên localhost:

```sh
# Ví dụ biến môi trường của CI, không phải thông tin truy cập dự án
CHAT_TEST_MYSQL_URL=mysql://root:realtime-ci-disposable@127.0.0.1:3306/mysql
CHAT_TEST_REDIS_URL=redis://127.0.0.1:6379
npm --prefix backend run test:chat:infrastructure
```

Script tự tạo rồi xóa duy nhất database `chat_realtime_test_<random>`, chạy migrations, dùng service/controller/ORM thật, và khởi tạo hai tiến trình Socket.IO độc lập. Redis phải là bản thử riêng vì script ghi stream/lease/rate-limit keys. Không dùng endpoint đang phục vụ người dùng.

Đã chạy trên máy này ngày 14/09/2026:

- Toàn bộ backend: 812 test qua (40 suite), gồm kết nối Socket.IO thật qua polling và WebSocket; JWT thật; Origin xấu/thiếu; query-token; quyền typing/read/presence; payload lớn; token hết hạn khi đang online; recovery; revoke và đa tab. Nhóm Jest này thay DB bằng fixture.
- MariaDB 10.4.32 riêng và Redis 7.4.7 riêng: migration/chạy lại và dữ liệu cũ; 8 insert đồng thời chỉ tạo một bản ghi; payload xung đột; SQL conversation summary; read boundary; fanout hai tiến trình; REST replay trên node khác; limiter và cap 10 kết nối chung.
- Qua proxy thử: ngắt người nhận, gửi tin khi offline, dừng node cũ, chuyển sang node còn lại; **khôi phục session và nhận đúng tin bị bỏ lỡ**.
- Frontend: toàn bộ 72 suite / 1.421 test qua; sau đó thêm một test retry khi server tạm từ chối, chạy lại 39 test chat/auth/socket đều qua. Kiểm tra pending sau remount, mất ACK, lỗi REST dự phòng, race snapshot/realtime và client lifecycle. Bản dựng production cuối biên dịch thành công.
- Runtime/release helpers: 20 test qua; cập nhật các probe Socket.IO trong smoke/release/activation để gửi Origin hợp lệ. Kiểm tra cú pháp các script đã qua; không chạy lại deployment/activation trên môi trường đang phục vụ.
- Thêm CI `.github/workflows/realtime.yml` với MySQL 8 và Redis 7. Workflow đã được thêm vào mã nguồn, chưa được chạy trên GitHub trong tác vụ này.

Audit dependency tại thời điểm làm việc không báo lỗi cho dependency realtime mới; vẫn báo một mục mức high ở Nodemailer có sẵn. Chưa nâng Nodemailer trong thay đổi WebSocket này.

## Giới hạn và đề xuất tiếp theo của báo cáo

Không gọi phần việc này là đã hoàn tất mọi mục nghiên cứu/production sign-off trong PDF. Những mục dưới đây phụ thuộc hạ tầng hoặc sản phẩm tiếp theo:

- Push nền cho mobile/native cần ứng dụng, sự đồng ý nhận thông báo và cấu hình FCM/APNs; chưa có trong phạm vi web hiện tại. Thông báo lưu DB/realtime của dự án được giữ nguyên.
- Chưa lưu last-seen, chưa làm room theo từng công ty, chưa có attachment upload/scan/storage. Không thêm binary/raw WebSocket/subprotocol khi chưa có nhu cầu nghiệp vụ, phù hợp ưu tiên thấp trong báo cáo.
- Recovery chỉ có cửa sổ 120 giây và dữ liệu adapter bị giới hạn. Sau đó đối soát bằng REST hiện có (cửa sổ hội thoại tối đa 200 tin), không tuyên bố replay vô hạn hoặc durable outbox cho mọi notification/dashboard event.
- Chưa có refresh token, logout thu hồi mọi access token trên server, phân tích tải/SLO với dữ liệu thật, EXPLAIN trên database thật, kiểm thử Nginx/TLS/CDN đang phục vụ, hoặc diễn tập mất Redis toàn cụm. Presence best-effort, không phải cam kết người nhận đang nhìn màn hình.
- Chưa có OpenTelemetry toàn tuyến, protocol version migration nhiều thế hệ client hay native mobile contract riêng. Rate-limit, lease và polling hiện là baseline cần điều chỉnh theo số đo.

Nguồn kỹ thuật đã đối chiếu: [Delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/), [Connection State Recovery](https://socket.io/docs/v4/connection-state-recovery/), [Redis Streams Adapter](https://socket.io/docs/v4/redis-streams-adapter/), [Server options](https://socket.io/docs/v4/server-options/).
