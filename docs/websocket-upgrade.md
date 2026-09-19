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

- Hội thoại có cursor `beforeId`/`afterId`, mặc định 100 tin, tối đa 200 tin/trang. Có nút tải lịch sử cũ và báo lỗi để thử lại. Reconnect lấy bù liên tiếp từ snapshot đã tải thành công, không lấy mốc từ live event; do đó lấy lại được hơn 200 tin bỏ lỡ. Giữ lịch sử đã mở, loại trùng theo ID và không làm lùi trạng thái đã đọc.
- Connection State Recovery trong 120 giây, `skipMiddlewares: false`. Từ chối khôi phục room của người dùng khác. Client vẫn tải lại dữ liệu DB sau reconnect để bù cả trường hợp server đã lưu nhưng chưa phát được.
- Reconnect có backoff/jitter và không dừng sau 5 lần. Sự kiện browser `online` khởi động lại kết nối. Token thay đổi/logout giữa các tab đóng socket cũ; sự cố tạm thời khiến server ngắt kết nối được thử lại mà không tự gia hạn token.
- Khi đang kết nối, đối soát chat mỗi 120 giây. Khi mất kết nối, lùi dần khoảng 5 đến 30 giây kèm jitter. Bỏ qua khi tab ẩn/browser offline; làm mới khi quay lại. Đây là chính sách tần suất, không phải benchmark tải.
- Bỏ full-history transfer và gom nhóm bằng JavaScript: database tổng hợp ID tin cuối và số chưa đọc theo người nhận; ứng dụng chỉ tải các tin cuối. Truy vấn vẫn phải duyệt lịch sử phù hợp trong DB, chưa phải bảng tổng hợp duy trì sẵn. Cần EXPLAIN với dữ liệu đại diện trước khi tuyên bố cải thiện latency.
- Read receipt mang `throughMessageId`, tránh đánh dấu cả những tin đến sau snapshot. Đồng bộ trạng thái đọc ở các tab của người đọc và phía người gửi. Client giữ tin mới đến trong lúc REST đang tải, giữ trạng thái đã đọc đã biết và bỏ phản hồi của cuộc trò chuyện cũ khi người dùng chuyển màn hình.
- Presence kiểm tra được quyền và số socket thực, dùng được nhiều tab/nhiều node. Giao diện kiểm tra mỗi 30 giây khi mở cuộc trò chuyện. Đã lưu `lastSeenAt` trong MySQL, cập nhật khi connect/heartbeat/disconnect. Ghi bằng bind parameter để giữ đúng múi giờ, cập nhật đồng thời chỉ lấy thời điểm lớn nhất. Khi còn một tab online thì không hiển thị last-seen; chỉ trả cho người có quyền trò chuyện.
- Dashboard dùng `feature:dashboard:admin` và `feature:dashboard:company:<id>`. Room lấy từ tài khoản/công ty đã duyệt trong DB; không nhận đăng ký room từ client. Phát tín hiệu theo công ty của chủ bài đăng/người thanh toán hoặc danh tính đã xác thực. Recovery xóa room cũ; thay đổi vai trò/công ty được phát hiện mỗi 30 giây, ngắt để xác thực lại. Dashboard tải lại sau reconnect/online và không gọi nền khi tab ẩn hoặc offline.

### Redis, vận hành và quan sát

- `SOCKET_REDIS_URL` là tùy chọn. Có cấu hình thì startup chờ Redis, thất bại sau tối đa khoảng 8 giây; không quảng bá API sẵn sàng trước đó. Shutdown đóng Socket.IO, Redis, rồi DB.
- Redis Streams Adapter dùng stream `<SOCKET_REDIS_PREFIX>:socket.io`, giới hạn mục tiêu 10.000 entries. Prefix mặc định `jobfind`, dùng riêng cho stream, pub/sub, session, limiter và lease. Reader dùng hàng chờ có giới hạn để chờ Redis kết nối lại; writer/limiter từ chối khi Redis mất kết nối. Cấu hình này khắc phục vòng XREAD lặp liên tục gây nghẽn event loop khi kế thừa `disableOfflineQueue: true`. Ephemeral publish và lưu session không được adapter chờ sẽ ghi metric lỗi, không làm process crash. Shutdown chờ các lệnh ghi còn lại trước khi đóng Redis. Dữ liệu adapter/lease/limiter phải nằm trên Redis nội bộ có ACL/auth/TLS theo hạ tầng thực tế. Không dùng chung các prefix này giữa các môi trường.
- Multi-node có polling cần sticky routing. Có cấu hình tham khảo tại `scripts/release/nginx.socket-upstream.example.conf`; đã nghiệm thu Nginx 1.31.5 riêng trên máy này với TLS và log xác nhận affinity; chưa thay cấu hình đang phục vụ. IP hash cần trusted real-IP setup nếu đứng sau CDN; ưu tiên affinity của ingress khi phù hợp.
- Metrics tại `GET /internal/socket-metrics`, yêu cầu `x-internal-secret` khớp `INTERNAL_SECRET`. Gồm kết nối đang hoạt động, kết nối bị từ chối, phục hồi, lý do ngắt, lỗi Origin/auth/Redis/rate limit, sự kiện theo kết quả và histogram thời gian xử lý, kích thước payload, số kết nối theo transport và thời gian chờ ACK do browser báo về. `chat:telemetry` là dữ liệu client khai báo, được giới hạn 30 giây, outcome cố định và rate limit; dùng quan sát xu hướng, không phải bằng chứng tính phí/SLO đáng tin cậy tuyệt đối.
- `SOCKET_LOG_EVENTS=true` bật log JSON gồm event, traceId, kết quả và thời gian. Không log JWT, nội dung chat hoặc ID phiên. Mỗi ACK có traceId. Có OpenTelemetry opt-in (`SOCKET_TRACING_ENABLED=true`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_SERVICE_NAME`): span handler → authorize/lookup/insert → publish, cùng traceId trong ACK và event tới người nhận. Không tự thu thập SQL, nội dung, token, ID người tham gia hay exception message. Span publish đo lời gọi phát, không khẳng định người nhận đã nhận. Chưa tự instrument mọi lệnh SQL/Redis hoặc tạo span trong trình duyệt nhận.

### Thông báo chờ nhà tuyển dụng phản hồi

Sau khi một tin của ứng viên được máy chủ xác nhận, ChatPage hiển thị một bong bóng xám có avatar công ty và nhãn **Phản hồi tự động**: “Chào bạn! Hệ thống đã ghi nhận tin nhắn của bạn. Vui lòng chờ nhà tuyển dụng phản hồi.” Ứng viên có thể tiếp tục gửi thêm thông tin; toàn bộ lượt chờ chỉ có một bong bóng. Thông báo vẫn còn khi nhà tuyển dụng đã đọc nhưng chưa trả lời, được khôi phục từ lịch sử khi tải lại/mở tab khác và biến mất khi nhận câu trả lời, kể cả qua đồng bộ sau mất mạng.

API lịch sử trả thêm `conversationMeta.waitingReply` với `candidateId` và `recruiterId` lấy từ tài khoản/công ty đã xác minh; cuộc trò chuyện dùng ngoại lệ ADMIN trả `null`. Frontend chỉ hiển thị cho đúng ứng viên/đối tác và dựa trên tin đã xác nhận mới nhất. Bản nháp hoặc lần gửi bị từ chối không tạo thông báo đã ghi nhận. Đây là trạng thái giao diện, không phải tin do nhà tuyển dụng gửi: không ghi thêm ChatMessage, không tăng unread hoặc phát Web Push. Cần cập nhật cả backend và frontend; không cần migration.

## Hợp đồng sự kiện

Yêu cầu gửi mới:

```json
{"v":1,"receiverId":8,"content":"Xin chào","clientMessageId":"8f32d66fea8b40f5901d559cd8a6f615"}
```

`clientMessageId`: 16–64 ký tự ASCII gồm chữ, số, `_`, `-`. ID người dùng là số nguyên dương an toàn. Không nhận `senderId` từ client; trường dư và phiên bản khác bị từ chối. `v` có thể bỏ trống để tương thích các lời gọi read/typing hiện tại, nhưng khi có chỉ nhận `1`.

- `chat:typing`: `{receiverId: 8}`.
- `chat:read`: `{partnerId: 8, throughMessageId: 123}`. Boundary có thể bỏ trống cho client cũ, khi đó đánh dấu toàn cuộc trò chuyện như trước.
- `chat:presence`: `{partnerId: 8}`; ACK có `{data: {partnerId, online, lastSeenAt, checkedAt}}`.
- `chat:telemetry`: `{v:1,outcome:"ack"|"fallback"|"uncertain",durationMs:0..30000}`, gửi volatile sau thao tác gửi.
- ACK giữ `errCode`, `errMessage`, `data` và thêm `v`, `ok`, `code`, `retryable`, `traceId`; lỗi rate limit có `retryAfterMs`.
- `chat:new-message` giữ các trường tin nhắn, thêm `v:1`, `eventId:"chat:<database-id>"`, `occurredAt`. `eventId` dùng nhận diện, không phải API replay offset bền vững riêng.
- Mã lỗi chính: `AUTH_INVALID`, `AUTH_EXPIRED`, `AUTH_INACTIVE`, `AUTH_UNAVAILABLE`, `PAYLOAD_INVALID`, `CHAT_NOT_ALLOWED`, `CHAT_RECEIVER_NOT_FOUND`, `CHAT_MESSAGE_TOO_LONG`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`, `CONNECTION_LIMITED`, `INTERNAL_ERROR`.

## Cập nhật và quay lui

1. Sao lưu và kiểm tra đúng database đích theo quy trình dự án. Áp dụng migration **trước** khi chạy model/backend mới:

   ```sh
   cd backend
   npx sequelize-cli db:migrate --to migrationzzzzz-realtime-presence.js
   ```

   Lệnh áp dụng cả migration trước đó còn pending, nên phải kiểm tra `db:migrate:status` trước. Hai migration realtime thêm cột nullable, các index và bảng `RealtimePresences`, có thể chạy lại sau DDL bị gián đoạn. Nó đã được kiểm tra trên database riêng; chưa áp dụng vào dữ liệu đang dùng. Index có thể gây chờ ghi trên bảng lớn, cần chọn cửa sổ bảo trì.

2. Cập nhật dependencies từ lockfile, backend và frontend. `URL_REACT` phải chứa chính xác Origin người dùng truy cập (scheme, host, port), không thêm đường dẫn/dấu `/` cuối. Yêu cầu tab cũ tải lại vì hợp đồng socket đã được siết chặt.
3. Một node có thể bỏ `SOCKET_REDIS_URL`. Muốn bật nhiều node: tất cả dùng chung DB, JWT policy, Origin allowlist và Redis; cấu hình affinity ở tuyến thực sự chuyển tiếp `/socket.io/`.
4. TLS/WSS phải được cấu hình và nghiệm thu tại ingress thực tế. Timeout proxy hiện 75 giây phù hợp tổng heartbeat 45 giây; cấu hình mẫu không tự cấp certificate.
5. Khi quay lui application, giữ cột/index mới cùng dữ liệu `clientMessageId`. Không xóa khóa chống trùng khi vẫn có yêu cầu chưa xác nhận. `down` chỉ dành cho môi trường đã dừng ghi và đã xử lý hết pending; không dùng để quay lui nóng.

## Kiểm thử

### Nghiệm thu hội thoại ứng viên / nhà tuyển dụng ngày 19/09/2026

Đã bổ sung `backend/scripts/realtime/conversation.cjs` để kiểm tra đúng cặp **CANDIDATE / EMPLOYER thuộc công ty đã duyệt**, không dựa vào quyền ngoại lệ của ADMIN. Hai browser context riêng kết nối vào hai tiến trình backend dùng cùng SQL/Redis. Dùng ChatPage/service/controller/Socket.IO thật, chỉ dựng danh tính JWT và dữ liệu thử riêng; không đi qua màn hình đăng nhập hoặc toàn bộ AppShell.

Mỗi engine Chromium, Firefox và WebKit chạy một hội thoại 10 tin: trao đổi lịch phỏng vấn bằng tiếng Việt/emoji, 2.000 ký tự, chuỗi HTML/SQL như văn bản, tin khi mất mạng, tin mất ACK và tin nhiều dòng. Đối chiếu nội dung hai phía, REST và SQL; kiểm tra reload, typing, đã xem, online, gửi lại không trùng, fallback REST sau khi máy chủ lưu nhưng ACK bị chặn ở test server. Từ chối người ngoài, công ty chưa duyệt, giả sender và nội dung trên 2.000 ký tự. Màn hình 390 px giữ nội dung và ô nhập có thể nhìn thấy, không tràn ngang. Chứng cứ được lưu sau khi mọi assertion thành công tại `.local/websocket-checks/conversation-2026-09-19/result.json`, cùng ảnh hai vai trò trên từng trình duyệt.

Kịch bản cũng kiểm tra thông báo chờ: chưa gửi thì không hiển thị; đã xem vẫn chờ; nhiều câu hỏi chỉ có một bong bóng; reload và tab thứ hai trên node khác phục hồi đúng; trả lời xóa trạng thái ở cả hai tab; mất ACK không thêm tin giả; phục hồi sau mất mạng nhận câu trả lời và xóa thông báo. SQL chỉ chứa đúng 10 tin người dùng gửi. Ảnh `waiting-<engine>-desktop.png` và `waiting-<engine>-mobile.png` nằm trong cùng thư mục chứng cứ. Test giao diện còn kiểm tra bản nháp, gửi thất bại, vai trò/đối tác không phù hợp và phản hồi REST cũ không làm trạng thái chờ xuất hiện lại. Log lượt nâng cấp này: `.local/websocket-checks/waiting-reply-browser.txt`.

Sau khi bổ sung thông báo chờ ngày 19/09/2026: **855/855 test backend (47 suite)** và **1.458/1.458 test frontend (75 suite)** đạt; frontend production biên dịch thành công. Ba engine đều vượt qua kịch bản hội thoại trên SQL/Redis thử riêng; hạ tầng hai node, quyền nhận sự kiện, chống trùng và phục hồi qua node khác cũng đạt. Các log đầy đủ nằm trong `.local/websocket-checks/waiting-reply-{backend-full,frontend-full,build,browser}.txt`.

Bài thử phát hiện và đã sửa lỗi **gộp dòng khi hiển thị**: SQL/API giữ ký tự xuống dòng nhưng HTML trước đó dùng `white-space: normal`. Bong bóng tin hiện dùng `pre-wrap`, giữ xuống dòng/khoảng trắng bên trong và bẻ chuỗi dài. Database thử được tạo rõ `utf8mb4` để kiểm tra tiếng Việt/emoji, không phụ thuộc charset mặc định của máy SQL. Nội dung vẫn được cắt khoảng trắng ở hai đầu theo hành vi gửi hiện có; ô soạn hiện là một dòng, tin nhiều dòng trong bài thử được gửi qua API.

Chạy lại với hai endpoint SQL/Redis thử riêng được mô tả bên dưới:

```powershell
$env:CHAT_TEST_CONVERSATION='true'
npm --prefix backend run test:chat:infrastructure
```

CI realtime đã bật kịch bản này. Lượt kiểm thử này nghiệm thu chức năng hội thoại theo các nhóm reliability/recovery/authorization/security/browser ở trang 19–20, 29 và 32–33 của PDF; **không thay thế** kiểm thử tải dài, CDN/HTTPS production, dịch vụ push công khai hoặc Safari trên iPhone thật. Log đầy đủ: `.local/websocket-checks/conversation-final-2026-09-19.txt`. Bài chat hồi quy trước đó vẫn chạy lại thành công trên cả ba engine, bao gồm lịch sử 240 tin và lấy bù 260 tin bỏ lỡ.

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

Đã chạy trên máy này ngày 14/09/2026, sau lần phát triển bổ sung:

- **Backend:** 831 test / 42 suite qua. Bao gồm JWT thật, sai audience, tài khoản bị xóa/khóa, Origin, payload lớn/sai JSON, rate limit gửi tin, quyền, ACK traceId, telemetry schema và OTLP xuất qua HTTP collector thật.
- **Frontend:** lần chạy toàn bộ 1.432 test / 73 suite qua; sau sửa bộ đếm unread và thêm một test chống phản hồi cũ, chạy lại 24 test ChatPage/dashboard đều qua (tổng số test hiện có 1.433). Có kiểm tra lỗi tải lịch sử, lấy bù nhiều trang, chuyển hội thoại, tin đến trong lúc tải, giữ trạng thái đã đọc, pending khi reload, fallback và dashboard không tải khi ẩn/offline.
- **Trình duyệt:** Chromium, Firefox, WebKit chạy component ChatPage thật với API, SQL và Socket.IO thật, không giả lập API. Mỗi engine kiểm tra lịch sử 240 tin, chuỗi XSS/SQL hiển thị như văn bản, gửi một lần, hai browser context trao đổi typing/tin/read, mất mạng rồi lấy bù 260 tin, 502 bong bóng không trùng, màn hình rộng 390 px và không có lỗi JavaScript. Harness không bao gồm toàn bộ AppShell; WebKit desktop không thay thế nghiệm thu Safari/iOS trên thiết bị thật.
- **SQL/Redis hai tiến trình:** migration chạy lại, dữ liệu cũ, 8 insert đồng thời, unique index, last-seen không lùi và đúng múi giờ (đã chạy cả cấu hình UTC và `+07:00`), presence nhiều tab/nhiều node, phân trang cả hai chiều với ID xen kẽ cuộc trò chuyện khác, scoped dashboard, REST dedupe, giới hạn phân tán và cap kết nối.
- **Redis chaos:** ngắt mạng Redis của cả hai node; handler vẫn phản hồi lỗi, không ghi chat và không chuyển sang limiter riêng. Khôi phục mạng, cùng mã chỉ tạo một row. Đã bắt và sửa lỗi event-loop starvation phát hiện bởi bài thử này.
- **Nginx/TLS:** polling đi đúng một upstream theo access log, nâng cấp polling → WSS thật, ACK xác thực qua chứng chỉ riêng được client tin cậy. Không sửa kho chứng chỉ Windows hoặc cấu hình Nginx đang phục vụ.
- **Thời gian thật:** peer không trả heartbeat bị dọn sau cửa sổ 25 + 20 giây; ngắt 121 giây khiến recovery thất bại đúng dự kiến, xác thực mới và lấy bù qua SQL thành công. Dừng node cũ và chuyển node còn lại vẫn nhận tin phục hồi; kiểm tra exit code 0 khi shutdown.
- **Tải tổng hợp:** các mốc 50, 100 và 500 kết nối; gửi 500 tin với nhịp mục tiêu 20 tin/giây, không trùng; 125 khách reconnect thành công. Lần nghiệm thu kết hợp cuối p95 26,18 ms, p99 49,35 ms (lần chạy riêng trước đó: 65,03/99,7 ms). Đây là số đo local với dữ liệu thử, không phải công suất production hoặc soak 2–8 giờ. Kết quả lượt nghiệm thu kết hợp cuối lưu tại `.local/websocket-checks/load-result.json`; EXPLAIN tại `chat-explain.json`.
- **Bản dựng:** frontend production biên dịch thành công; đã sửa cảnh báo thiếu `alt` của avatar mới.
- **CI:** workflow realtime thêm cài trình duyệt, test giao diện liên quan, browser matrix và Redis chaos; chưa chạy workflow trên GitHub trong tác vụ này.

Chạy thêm các lớp kiểm thử trên cùng hai endpoint thử nghiệm:

```powershell
# Cài engine trước lần đầu
npx --prefix backend playwright install chromium firefox webkit
$env:CHAT_TEST_BROWSERS='true'
$env:CHAT_TEST_CHAOS='true'
$env:CHAT_TEST_LOAD='true'
$env:CHAT_TEST_TIMING='true' # chờ đủ 121 giây thật
# Tùy chọn Nginx/TLS: đường dẫn executable local, không dùng bản đang phục vụ
$env:CHAT_TEST_NGINX_BIN='D:/path/to/nginx.exe'
$env:CHAT_TEST_OPENSSL_BIN='D:/path/to/openssl.exe'
npm --prefix backend run test:chat:infrastructure
```

Mỗi lần chạy dùng database và Redis prefix ngẫu nhiên riêng. Bài tải tăng `SOCKET_HANDSHAKE_LIMIT_PER_MINUTE` lên 2.000 vì tất cả khách giả lập có cùng IP; cấu hình mặc định vẫn là 120. Khi đứng sau proxy phải cấu hình ingress rate limit và ngưỡng peer phù hợp với số đo.

Audit dependency tại thời điểm làm việc không báo lỗi cho dependency realtime mới; vẫn báo một mục mức high ở Nodemailer có sẵn. Chưa nâng Nodemailer trong thay đổi WebSocket này.

## Phần còn phụ thuộc sản phẩm/hạ tầng

Không tuyên bố hoàn tất mọi hướng phát triển/production sign-off trong PDF:

- Theo xác nhận sản phẩm chỉ có website, đã bổ sung Web Push cho tin nhắn chat: bật/tắt theo thiết bị, outbox giao dịch, retry/lease, chống hiện nhầm tài khoản và kiểm thử SQL/HTTPS mã hóa/Chromium. Xem [hướng dẫn và kết quả Web Push](web-push.md). Chưa tích hợp ứng dụng native; không thuộc phạm vi website được xác nhận. Nghiệm thu dịch vụ push công khai trên thiết bị thực vẫn cần HTTPS và cấu hình triển khai.
- Binary protocol/subprotocol riêng (P3), attachment upload/scan/storage, Conversation/ConversationMember là hướng dài hạn. Báo cáo không khuyến nghị thay raw WebSocket ngay; không thêm những thành phần này vào giao thức chat văn bản.
- Chưa có refresh token hoặc logout thu hồi mọi JWT trên server; logout/token đổi phía client đã đóng socket. Cần thiết kế vòng đời phiên toàn ứng dụng trước khi thay cơ chế cấp token.
- Chưa nghiệm thu CDN/TLS production, Safari/iOS/Android trên thiết bị thật, tải peak theo analytics hoặc soak 2–8 giờ. Nginx local, WebKit và tải tổng hợp không đại diện các môi trường đó.
- Chưa áp migration vào database đang phục vụ hoặc triển khai bản mới lên production. Áp dụng hai migration và cập nhật frontend/backend cùng đợt theo hướng dẫn trên. Không cần Redis để chạy một node; muốn nhiều node phải cùng cấu hình Redis prefix/DB/JWT/Origin và affinity.
- Có hợp đồng v1, kiểm tra phiên bản, field mới theo hướng bổ sung và fallback REST cũ; chưa có nhiều thế hệ client native để kiểm thử tương thích chéo. Room/presence vẫn best-effort; không chứng minh người dùng đang nhìn màn hình.

Nguồn kỹ thuật: [Delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/), [Connection State Recovery](https://socket.io/docs/v4/connection-state-recovery/), [Redis Streams Adapter](https://github.com/socketio/socket.io-redis-streams-adapter), [Node Redis production usage](https://redis.io/docs/latest/develop/clients/nodejs/produsage/), [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/), [Nginx Windows](https://nginx.org/en/docs/windows.html).
