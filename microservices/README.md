# AI Job Portal — Hệ thống Microservices

Hướng dẫn bản Compose đóng gói: [Chạy local an toàn](docs/local-compose.md).
Những yêu cầu PDF đã làm và còn thiếu: [Tiến độ triển khai](docs/implementation-progress.md).
Chưa coi toàn bộ checklist PDF/production là hoàn tất.

Kiến trúc microservices xây trên nền dự án JobFind hiện có. Backend monolith cũ
(`../backend`) **vẫn chạy bình thường** — các tính năng chưa tách ra được API
Gateway định tuyến ngược về đó, nên hệ thống chuyển dần từng phần thay vì phải
viết lại toàn bộ cùng một lúc.

## Đừng nhầm với hai thư mục "service" khác trong dự án

Ba thư mục dưới đây **trùng tên nhưng khác hẳn vai trò**. Thư mục này (`microservices/`)
cố tình đặt tên khác để phân biệt.

| Thư mục | Là gì | Chạy ở đâu |
|---|---|---|
| `backend/src/services/` | Lớp nghiệp vụ **bên trong** monolith. Mỗi file gọi Sequelize (`import db from "../models/index"`). | Cùng **một tiến trình** Node với backend, cổng 5000 |
| `frontend/src/service/` | Lớp gọi API bằng axios (`axios.get(...)`). | Trong **trình duyệt** |
| `microservices/` | **8 ứng dụng độc lập** có entrypoint riêng; còn một số phụ thuộc DB legacy đang di chuyển. | **8 tiến trình** Node trong **8 container** Docker |

Không thể gộp thư mục này vào `backend/src/services/`: mỗi service cần bộ thư viện
khác nhau (`mysql2`, `@elastic/elasticsearch`, `pg`, `@anthropic-ai/sdk`) và một CSDL
riêng. Gộp lại tức là quay về monolith — mất CQRS, mất circuit breaker, mất khả năng
nhân bản riêng từng phần.

## Sơ đồ

```
                    React (cổng 3000)
                          │
                          ▼
              ┌───────────────────────┐
              │   API Gateway :4000   │  JWT · Redis rate limit
              │                       │  opossum circuit breaker
              └───────────┬───────────┘
        ┌─────────┬───────┼─────────┬──────────────┐
        ▼         ▼       ▼         ▼              ▼
   Identity   Job Core  Search   (AI qua       Backend cũ
    :4001      :4002    :4003    Job Core)      :5000
   MongoDB     MySQL     ES                    (chat, thanh toán,
                                                thông báo…)
        │         │         ▲
        │         │         │
        │         ▼         │
        │   ┌──────────────────────┐
        └──▶│  RabbitMQ  :5673     │◀── AI Worker (Claude)
            │  jobportal.events    │     chỉ HTTP vận hành nội bộ :4007
            └──────────────────────┘
```

Sơ đồ trên minh họa luồng CQRS ban đầu; hệ thống còn có Application :4004 (PostgreSQL),
Notification :4005 (MySQL/delivery ledger) và Admin :4006 (MongoDB audit + nguồn báo cáo).

## CQRS: tách Ghi và Đọc

| | Bên Ghi (Command) | Bên Đọc (Query) |
|---|---|---|
| Service | Job Core | Search |
| CSDL | MySQL | Elasticsearch |
| Vì sao | Giao dịch cần ACID (mua gói, đăng tin) | Tìm kiếm cần tốc độ và xếp hạng độ liên quan |

Luồng khi đăng một tin tuyển dụng:

1. `POST /api/jobs` → Job Core ghi vào MySQL trong một giao dịch, trạng thái `PS3` (chờ duyệt)
2. Trong cùng giao dịch, Job Core ghi thêm các bản ghi `outbox_events` cho `job.created` và `ai.moderate_job`, rồi **trả về ngay**
3. Outbox relay phát các bản ghi đã commit lên RabbitMQ và chỉ đánh dấu `publishedAt` sau khi broker xác nhận đã nhận
4. Song song:
   - Search Service nghe `job.created` → đọc lại tin hiện tại từ Job Core rồi cập nhật Elasticsearch có kiểm tra xung đột
   - AI Worker nghe `ai.moderate_job` → gọi Claude kiểm duyệt nội dung
5. AI Worker phát `ai.result` kèm mã lượt kiểm duyệt → Job Core kiểm tra lượt hiện tại, trạng thái chờ và nội dung trước khi đổi sang `PS1`/`PS2`; kết quả cũ bị bỏ qua
6. Search Service nghe `job.moderated` → đọc lại trạng thái hiện tại rồi cập nhật index

API tìm kiếm vẫn chỉ đọc Elasticsearch. Riêng đường đồng bộ index gọi nội bộ
Job Core để tránh áp dụng payload cũ, vì các nơi ghi dữ liệu chưa có phiên bản
nghiệp vụ tăng đơn điệu thống nhất. Đây là đánh đổi có chủ đích, tăng phụ thuộc
vào nguồn dữ liệu trong lúc đồng bộ; chi tiết ở phần Search bên dưới.

## Transactional Outbox (Job Core)

Các thay đổi chính của tin tuyển dụng (`create`, `update`, `delete`) không còn
phát RabbitMQ trực tiếp ngay sau khi commit. Job Core ghi dữ liệu nghiệp vụ và
event cần phát vào bảng `outbox_events` bằng **cùng một MySQL connection và
transaction**. Vì vậy nếu transaction rollback thì event cũng không tồn tại;
nếu RabbitMQ tạm thời mất kết nối, relay sẽ giữ lại event để thử lại.

Relay chạy cùng tiến trình Job Core nhưng tách khỏi request HTTP. Nó claim một
lô event chưa phát theo thứ tự tạo, phát tuần tự trong lô, rồi mới cập nhật `publishedAt`. Bản
migration tương ứng nằm tại `job-core-service/migrations/001_create_outbox_events.sql`;
hiện startup vẫn gọi `CREATE TABLE IF NOT EXISTS` để môi trường demo tự khởi động
được. Relay hiện dùng publisher confirms; Notification đã có chống trùng theo event ID
như mô tả bên dưới, chưa áp dụng cho toàn bộ consumer.

## Outbox Application và publisher confirms

Application Service ghi trạng thái hồ sơ, lịch sử và sự kiện trong cùng transaction
PostgreSQL cho `application.stage_changed` và `application.decision_email_requested`.
Địa chỉ email, tên ứng viên và thông tin việc làm trong sự kiện vẫn lấy từ snapshot
hồ sơ. `emailQueued: true` nghĩa là yêu cầu gửi đã được lưu bền vững, chưa có nghĩa
SMTP đã giao thư. Gửi lại kết quả bằng một thao tác mới tạo một event ID mới.

Schema nằm tại `application-service/migrations/001_create_outbox_events.sql`, được
startup đọc để khởi tạo bảng/index còn thiếu. Bảng outbox này nằm trong PostgreSQL
của Application, độc lập với bảng cùng tên trong MySQL của Job Core.

Relay Application khóa từng event bằng `FOR UPDATE SKIP LOCKED` trong lúc gửi,
và chỉ commit dấu `published_at` sau confirm. Các replica có thể xử lý hồ sơ khác
nhau đồng thời; event sau của cùng hồ sơ chờ event trước được gửi thành công.
Lỗi gửi được lưu vào `last_error` và thử lại với khoảng chờ tăng dần, tối đa 60 giây.
Một event lỗi kéo dài sẽ giữ các event sau của chính hồ sơ đó ở trạng thái chờ.

Hai outbox dùng `shared/outboxPublisher.js` với kênh confirm riêng. Mỗi lần mở
kết nối/kênh có giới hạn 10 giây, mỗi lần chờ confirm/drain cũng giới hạn 10 giây.
Publisher xử lý ACK, NACK, channel đóng, timeout và `mandatory` return khi không có
queue nào nhận được sự kiện. `messageId` giữ nguyên khi relay gửi lại; payload JSON
và routing key hiện tại được giữ nguyên. Chi tiết giao thức xem
[RabbitMQ Publisher Confirms](https://www.rabbitmq.com/docs/confirms).

Confirm xác nhận broker nhận sự kiện, không xác nhận email đã gửi hoặc mọi consumer
đã xử lý. Nếu broker đã nhận nhưng tiến trình/DB lỗi trước khi ghi dấu đã gửi, event
có thể được phát lại. Hai outbox đã dùng envelope v1; Notification/Admin đã chống
trùng cho sự kiện có ID, Search đã bảo vệ kết quả đồng bộ như phần bên dưới.
AI Worker cũng đã có ledger chống gọi lại tác vụ có ID và phát kết quả có confirm.
Job Core nhận kết quả AI bằng inbox + giao dịch và phát `job.moderated` qua outbox.
Ba endpoint CV cũng ghi `ai_tasks` + yêu cầu AI vào cùng giao dịch outbox, như
phần "Job Core: lưu bền vững yêu cầu AI từ CV" bên dưới.
Các publisher trực tiếp còn lại vẫn là các bước kế tiếp. DLQ/retry đã dùng confirms
như phần hướng dẫn bên dưới; chưa có
bảo đảm SMTP giao thư đúng một lần.

Để áp dụng trong môi trường local có Docker đang chạy, từ thư mục `microservices`:

```powershell
docker compose up -d --no-deps --force-recreate application-service job-core-service
docker compose logs --tail=100 application-service job-core-service
```


Không cần nạp lại database mẫu hoặc thêm biến môi trường. Có thể xem backlog bằng
truy vấn chỉ đọc sau trong PostgreSQL `application_db`:

```sql
SELECT id, aggregate_id, event_type, attempts, next_attempt_at, last_error
FROM outbox_events
WHERE published_at IS NULL
ORDER BY sequence
LIMIT 20;
```

Test hồi quy không cần Docker:

```powershell
npm test -- tests/application-outbox.test.js tests/confirmed-publisher.test.js tests/outbox-publisher.test.js tests/outbox.test.js
```

## Event envelope v1 và chống trùng Notification

Phần bổ sung tiếp theo sau hai outbox: chuẩn hóa metadata sự kiện và lưu bền vững
việc xử lý thông báo. Hợp đồng logic nằm tại
`contracts/events/envelope.v1.schema.json`, mã dùng chung tại `shared/eventEnvelope.js`.
Envelope gồm `eventId`, `eventType`, `eventVersion`, `aggregateId`, `occurredAt`,
`producer`, `correlationId` và `data`. Đây mới là hợp đồng metadata; chưa phải
schema kiểm tra mọi trường nghiệp vụ riêng của từng loại event.

Để tương thích với consumer cũ, **body JSON vẫn là dữ liệu nghiệp vụ cũ**, không
bọc thêm một lớp `data`. Trên RabbitMQ, ID/type/producer/correlation dùng các
properties `messageId`/`type`/`appId`/`correlationId`; phiên bản, aggregate và thời
điểm dùng headers `x-event-version`, `x-aggregate-id`, `x-occurred-at`.
`timestamp` dùng giây Unix. `occurredAt` lấy từ thời điểm lưu outbox, không thay đổi
khi retry. Application có correlation ID sẵn; Job Core hiện để `null`.

Shared consumer kiểm tra phiên bản và routing key trước khi gọi handler, truyền
metadata ở tham số thứ ba. Event cũ chỉ có `messageId` cũng được nhận diện;
event không có ID vẫn đi luồng legacy, **không tự tạo ID lúc nhận**. Metadata được
giữ khi đưa vào DLQ. Chuyển tin sang DLQ hiện đã chờ publisher confirm.

Với sự kiện có ID, Notification thực hiện một transaction MySQL:

1. Khóa inbox theo `(eventId, recipientId)`; đã xử lý thì bỏ qua.
2. Ghi một thông báo vào bảng `notifications` và các yêu cầu email/realtime vào
   `notification_deliveries`, cùng connection với inbox.
3. Commit rồi mới trả thành công cho consumer xác nhận RabbitMQ.

Khóa chính inbox và khóa duy nhất `(eventId, recipientId, channel)` ngăn tạo trùng
khi nhận lại cùng event. Lỗi lưu làm rollback cả transaction và chuyển sự kiện
theo chính sách retry có giới hạn rồi DLQ bên dưới; **chưa có tự động replay DLQ**.
Người dùng bấm gửi
lại kết quả là yêu cầu mới có ID mới nên vẫn gửi được. Với `job.created`, chống
trùng áp dụng riêng từng người theo dõi; danh sách người theo dõi vẫn được đọc
lại khi replay, chưa đóng băng danh sách người nhận cho toàn event.

Worker xử lý các yêu cầu đã commit độc lập với RabbitMQ, khóa từng lần gửi bằng
token. Email/realtime có trạng thái `pending`, `processing`, `sent`, `skipped`,
`failed` hoặc `unknown`. Lỗi chắc chắn chưa gửi (ví dụ DNS hoặc SMTP từ chối tạm
thời) được thử lại với khoảng chờ tăng dần, tối đa 60 giây và 10 lần. Thiếu cấu hình
email/realtime thì tiếp tục chờ; địa chỉ không hợp lệ bị bỏ qua. Realtime có thể
được đẩy lại cùng notification ID, không tạo thêm bản ghi trong chuông; giao diện
vẫn có thể thấy tín hiệu realtime lặp.

**Giới hạn SMTP:** timeout/mất kết nối hoặc tiến trình chết sau khi gửi có thể
không xác định được server đã nhận thư hay chưa. Worker đánh dấu `unknown` và
không tự gửi lại. Lần xử lý bị treo quá 5 phút cũng được chuyển email sang
`unknown` khi worker quét; realtime trở về hàng chờ. Mỗi lời gọi có deadline 60
giây; deadline không bảo đảm hủy SMTP đang chạy, nên kết quả đến muộn cũng không
kích hoạt retry. `Message-ID` ổn định chỉ giúp đối chiếu, không phải bảo đảm hộp
thư bên nhận sẽ loại trùng. Xem [SMTP transport của Nodemailer](https://nodemailer.com/smtp).

Migration `notification-service/migrations/001_create_notification_delivery.sql`
chỉ tạo hai bảng mới nếu thiếu; startup tự áp dụng và kiểm tra cả ba bảng dùng
InnoDB. Nếu MySQL/schema chưa sẵn sàng, service dừng trước khi nhận/gửi thông báo.
Không tự chuyển storage engine, không sửa/xóa thông báo cũ. Cần quyền tạo bảng và
đọc/ghi các bảng mới. Chưa có tác vụ tự xóa inbox: phải giữ ID ít nhất bằng cửa sổ
replay để không mất khả năng chống trùng; payload có dữ liệu cá nhân nên cần quản
lý quyền truy cập và chính sách lưu trữ trước khi triển khai production.

Áp dụng local khi Docker/MySQL đã chạy, từ thư mục `microservices`. Dừng hết
Notification phiên bản cũ trước khi chạy bản mới để tránh worker cũ gửi trực
tiếp song song với worker mới. Khi nâng cấp cụm nhiều replica cũng áp dụng quy
tắc này. Ví dụ với Compose của dự án:

```powershell
docker compose stop notification-service
docker compose up -d --no-deps --force-recreate notification-service application-service job-core-service
docker compose logs --tail=100 notification-service
```

Không nạp lại dữ liệu mẫu. Worker sẽ tự tiếp tục gửi các yêu cầu `pending` đã lưu,
kể cả khi RabbitMQ đang kết nối lại. Kiểm tra bằng truy vấn chỉ đọc trong MySQL:

```sql
SELECT channel, status, COUNT(*) AS total
FROM notification_deliveries GROUP BY channel, status;

SELECT id, eventId, recipientId, channel, status, attempts, lastError, updatedAt
FROM notification_deliveries
WHERE status IN ('unknown', 'failed')
ORDER BY updatedAt DESC LIMIT 20;
```

Với `unknown`, đối chiếu nhật ký SMTP và `messageId` trong payload trước khi quyết
định gửi mới. Không đổi hàng loạt `unknown` về `pending`. Khắc phục cấu hình/người
nhận của `failed` trước khi dùng thao tác gửi lại trong ứng dụng. Không replay
với ID mới chỉ để bỏ qua chống trùng. Replay DLQ cần giữ body/ID/metadata và chọn
đúng consumer đích; không phát lại lên topic chung chỉ để sửa một dịch vụ vì có
thể kích hoạt lại các consumer khác. Phần này chưa cung cấp công cụ replay tự động.

Kiểm thử phần này không gọi SMTP thật:

```powershell
npm test -- tests/event-envelope.test.js tests/notification-delivery-store.test.js tests/notification-delivery-worker.test.js tests/notification-consumer.test.js tests/shared.test.js
```

Các bài kiểm tra transaction/đồng thời dùng database test double; vẫn cần kiểm
thử tích hợp MySQL/RabbitMQ thật trước khi triển khai. Sự kiện publish trực tiếp
không có ID và các luồng khác chưa được chống trùng trong phần này.
Admin, Search và AI Worker đã được bổ sung riêng ở các phần bên dưới.

## DLQ có xác nhận và retry có giới hạn

Mọi consumer dùng `shared/rabbitmq.js` hiện chuyển lỗi qua publisher riêng tại
`shared/messageTransfer.js`. Kết nối confirm dùng chung cách quản lý với outbox
(`shared/confirmedConnection.js`), nhưng **khác connection/channel** để lỗi chuyển
tin không đóng kênh đang giữ các bản gốc chưa ACK.

Trình tự: phát bản raw vào `${queueName}.dead-letter` qua exchange
`jobportal.events.dead-letter`, chờ publisher confirm và buffer drain, rồi mới ACK
bản gốc. `mandatory: true` phát hiện trường hợp không có queue đích. Connect/setup
có giới hạn 10 giây; confirm/drain cũng có giới hạn 10 giây. Broker NACK, return,
timeout hoặc mất kết nối đều không được coi là đã chuyển thành công. Bản gốc được
requeue sau khoảng nghỉ 2 giây nếu kênh nhận vẫn sống; khi kênh nhận đã đóng, để
RabbitMQ tự giao lại. Không có nhánh loại bỏ bản gốc khi chưa xác nhận bản chuyển.

Đây là cơ chế **at-least-once**, không phải exactly-once. Nếu broker đã nhận bản
chuyển nhưng ACK/confirm bị mất, DLQ/retry có thể có bản trùng; vẫn phải giữ event
ID và dùng consumer chống trùng. Giới hạn này được mô tả trong
[RabbitMQ Reliability Guide](https://www.rabbitmq.com/docs/reliability).

Raw body, message ID, correlation ID, phiên bản, thời điểm và producer được giữ
nguyên. Thêm `x-failed-queue`, `x-original-routing-key`, `x-error`, `x-failed-at`
để điều tra. Không sao chép `expiration` khiến tin lỗi có thể tự hết hạn hoặc
AMQP `userId` gắn với tài khoản publisher cũ. Không tự tạo event ID cho tin legacy.

Retry handler **mặc định tắt**. Notification, Admin, Search và Job Core nhận `ai.result` hiện bật, đồng thời cần cả hai:

- Event có ID nên đi qua cơ chế chống trùng của consumer tương ứng.
- Lỗi nằm trong danh sách tạm thời của consumer: Notification/Admin/Job Core AI-result nhận diện
  lỗi database như mất kết nối, deadlock, lock timeout hoặc quá nhiều kết nối;
  Search nhận diện lỗi nguồn HTTP/Elasticsearch như phần riêng bên dưới. Sai schema/quyền truy cập, dữ liệu lỗi,
  lỗi không nhận diện được và event legacy không được tự retry theo chính sách này.

Lịch retry là 2, 10, 30 giây: tối đa ba lượt sau lần xử lý đầu trong một chuỗi
retry. Hết lượt thì vào DLQ. `x-retry-count` nằm trong tin bền vững, nên consumer
khởi động lại đọc tiếp số lượt đã ghi. Các lần broker redelivery do mất ACK hoặc
crash có thể làm một lượt chạy lại; đây không phải giới hạn tuyệt đối số lần gọi
handler khi hạ tầng liên tục gián đoạn. Lỗi chuyển tin ở mức hạ tầng không tiêu
hao lượt retry nghiệp vụ, không tự bỏ tin khi hết số lần mất kết nối.

Trong thời gian chờ, bản gốc **vẫn unacknowledged trong RabbitMQ**, chiếm một slot
prefetch (Notification là 10, Admin là 50, Search là 20, Job Core AI-result mặc định 5). Sau khi chờ, publisher phát bền vững về
đúng queue của consumer bị lỗi qua default exchange, giữ routing key nghiệp vụ trong header, rồi
mới ACK bản gốc khi có confirm. Không phát lại lên topic chung, không tạo queue
TTL và không đổi arguments/type của queue hiện tại. Điều này phù hợp bước nâng
cấp nhỏ hiện tại; khi lưu lượng lớn cần tách hạ tầng lập lịch retry để không giữ
slot prefetch. Restart trong lúc chờ có thể làm bắt đầu lại khoảng chờ của lượt đó.

Nếu gặp JSON hỏng, phiên bản envelope không hỗ trợ hoặc metadata retry không hợp
lệ, consumer chuyển thẳng DLQ, không gọi handler. AI Worker gọi model
và luồng legacy vẫn **chưa được bật tự retry nghiệp vụ**. Redelivery của RabbitMQ
(ví dụ mất ACK hoặc chuyển DLQ lỗi) vẫn có thể xảy ra. AI Worker có ledger như phần
riêng bên dưới; Job Core nhận `ai.result` đã có giao dịch/inbox và kiểm tra lượt
kiểm duyệt. Một số luồng legacy vẫn cần bổ sung tiếp. Retry handler không gửi SMTP: worker email
riêng vẫn giữ nguyên nguyên tắc `unknown` không tự gửi lại.

Kênh nhận tự kết nối/đăng ký lại khi channel đóng, kết nối mất hoặc broker hủy
consumer. Callback cũ không ACK sang channel mới. Lỗi ACK sau xử lý thành công
không bị biến thành lỗi nghiệp vụ/DLQ; đóng kênh gốc để broker giao lại. Khi đóng
kết nối có chủ đích, không tự mở lại.

Áp dụng local khi Docker và các dependency đã sẵn sàng: khởi động lại những
service dùng thư viện RabbitMQ chung. Giữ toàn bộ volume/queue/inbox hiện có,
không purge DLQ hoặc nạp lại dữ liệu mẫu. Dừng hết Notification cũ trước khi nâng
cấp để tránh trộn hai phiên bản xử lý retry:

```powershell
docker compose stop notification-service
docker compose up -d --no-deps --force-recreate job-core-service application-service notification-service search-service ai-worker admin-service identity-service api-gateway
docker compose logs --tail=100 notification-service
docker compose exec rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers
```

Khi điều tra, xem queue `notification-service.events.dead-letter`, `x-error`,
`x-retry-count` và event ID. Dùng chế độ xem có **requeue** trong RabbitMQ Management
nếu cần đọc tin; tránh chế độ đọc rồi xóa. `messages_unacknowledged` tăng tạm thời
có thể là đang backoff, không nhất thiết consumer bị treo. Sửa nguyên nhân trước
khi lập kế hoạch replay đúng consumer, không tự replay toàn bộ DLQ.

Kiểm thử không gọi broker/email thật:

```powershell
npm test -- tests/message-transfer.test.js tests/rabbitmq-lifecycle.test.js tests/notification-retry-policy.test.js tests/shared.test.js tests/outbox-publisher.test.js
```

Cần chạy kiểm thử tích hợp RabbitMQ/MySQL thật trước khi triển khai. Thứ tự xử lý
nghiệp vụ xuyên các replica, công cụ replay có kiểm soát, chống trùng các consumer
còn lại và confirms cho publish trực tiếp vẫn chưa được giải quyết trong phần này.

## Chống ghi trùng nhật ký Admin

Admin nhận metadata sự kiện từ shared consumer và lưu `eventId`, `eventVersion`,
`aggregateId`, `occurredAt`, `correlationId` cùng nhật ký. `service` dùng producer
trong envelope; event cũ thiếu producer vẫn dùng tiền tố routing key như trước.
Payload vẫn được lược bỏ trường nhạy cảm trước khi ghi. Có thể tra cứu một sự kiện
qua API quản trị hiện có: `GET /api/admin/audit?eventId=<event-id>`.

Với event có ID, thao tác `updateOne` dùng `upsert` và `$setOnInsert`: chỉ tạo bản
ghi khi chưa có, không sửa payload hoặc `createdAt` của bản ghi đã tồn tại. Unique
index `audit_event_id_unique` áp dụng riêng cho `kind: event` có `eventId` dạng
chuỗi, phân biệt hoa/thường. Nhật ký chính là dấu đã xử lý: không có hai thao tác
ghi rời rạc giữa inbox và audit log. Đây là cách dùng ghi nguyên tử trên một tài
liệu và unique index của MongoDB; xem [MongoDB Atomicity and Transactions](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/).

Ghi mới yêu cầu `writeConcern: majority`, journal và timeout 5 giây. Khi đã khớp
một bản ghi hoặc có xung đột unique key do xử lý đồng thời, Admin kiểm tra lại bằng
majority read trên primary trước khi coi là đã ghi. Không bỏ qua mọi lỗi `11000`:
chỉ xung đột đúng khóa `eventId` hiện tại mới được kiểm tra như một bản trùng.

Startup **chờ tạo index xong trước khi nhận sự kiện**. Chỉ tạo index khai báo còn
thiếu, không xóa index tùy chỉnh, không sửa/xóa dữ liệu cũ. Nếu có dữ liệu mang ID
trùng sẵn hoặc thiếu quyền tạo index, service dừng để người vận hành kiểm tra;
không tự dọn các bản ghi đó. Partial index cho phép giữ nhiều nhật ký legacy/action
không có ID; xem [MongoDB Unique Indexes](https://www.mongodb.com/docs/manual/core/index-unique/).

Lỗi ghi MongoDB không còn bị bắt rồi trả thành công cho RabbitMQ. Lỗi kết nối,
write concern, xung đột ghi và một số lỗi tạm thời đã nhận diện được thử lại sau
2/10/30 giây **chỉ khi event có ID**. Sai quyền, dữ liệu/schema hoặc lỗi không nhận
diện được chuyển theo DLQ có confirm. Queue `admin-service.audit` độc lập với
Notification/Search; retry Admin không phát lại cho các consumer kia.

Giới hạn phần này:

- Event không có ID vẫn ghi theo luồng cũ; không suy đoán ID từ nội dung và không
  bật retry nghiệp vụ cho chúng. Lỗi ghi vẫn được chuyển DLQ, không nuốt lỗi.
- Nhật ký thao tác HTTP từ Gateway (`kind: action`) chưa có chống trùng trong lần
  bổ sung này. Nhật ký trùng hoặc bị bỏ sót trước đây không được tự sửa/bù.
- TTL 180 ngày giữ nguyên, tính từ lần ghi đầu. Replay không kéo dài ngày lưu.
  Sau khi TTL hoặc người vận hành xóa bản ghi, dấu chống trùng của event đó cũng
  mất; replay lại có thể tạo nhật ký mới. Không cam kết chống trùng vĩnh viễn.
- MongoDB local hiện là standalone. `majority` ở đây không thay thế replica set,
  backup hay kiểm thử failover; không phải bảo đảm exactly-once cho toàn hệ thống.

Áp dụng khi các dependency đang chạy, từ thư mục `microservices`. Dừng hết Admin
phiên bản cũ trước để không còn consumer ghi nhật ký bỏ qua event ID:

```powershell
docker compose stop admin-service
docker compose up -d --no-deps --force-recreate admin-service
docker compose logs --tail=100 admin-service
```

Không cần biến môi trường mới hoặc nạp lại dữ liệu mẫu. Trong MongoDB `admin_db`,
có thể kiểm tra chỉ đọc bằng `db.auditlogs.getIndexes()` và tra `eventId` trong
`db.auditlogs`. Nếu index không tạo được, không xóa hàng loạt nhật ký để bỏ qua lỗi.

Kiểm thử hồi quy:

```powershell
npm test -- tests/admin.test.js tests/admin-audit-events.test.js tests/admin-audit-model.test.js tests/admin-bootstrap.test.js
npm run test:admin-audit:integration
```

Bài integration cần Docker đang chạy và image `mongo:7` đã có. Script **không đọc
MONGO_URL của dự án**: tạo MongoDB tạm, chỉ mở cổng localhost ngẫu nhiên và tự dọn
đúng container/volume tạm sau khi kiểm tra nhãn sở hữu. Không tải image tự động,
không thay đổi database/container dịch vụ đang dùng. Sáu kiểm tra trên MongoDB
thật bao gồm 50 upsert đồng thời, bảo toàn nhật ký/index cũ, replay, ID phân biệt
hoa/thường, tính tương thích legacy và lỗi tạo index. Mất phản hồi sau khi MongoDB
ghi thành công được mô phỏng ở phía client; chưa phải thử ngắt mạng hoặc failover
replica set. RabbitMQ ACK/retry/DLQ của Admin được kiểm tra bằng test double.

## Search: đồng bộ an toàn khi sự kiện trùng hoặc đến muộn

Các sự kiện `job.created`, `job.updated`, `job.deleted`, `job.moderated` và
`company.updated` giờ chỉ cung cấp ID cần đối chiếu. Không dùng tiêu đề/trạng thái
trong payload cũ và không dùng `occurredAt` để suy đoán thứ tự dữ liệu. Job Core,
AI moderation và backend cũ chưa có bộ đếm phiên bản nghiệp vụ thống nhất.

Job Core bổ sung `GET /internal/jobs/:id`, được bảo vệ bằng `INTERNAL_SECRET` như
API nội bộ hiện có. Endpoint đọc trực tiếp MySQL hiện tại, trả cả tin chờ duyệt,
bị chặn, PS4 và trạng thái công ty. Chỉ HTTP 404 có `errCode: 2` nghĩa là không
còn bản ghi; thiếu route, sai secret, timeout, lỗi database hay JSON sai cấu trúc
đều là lỗi đồng bộ, tuyệt đối không phải lệnh xóa tin.

Mỗi lần cập nhật một tin thực hiện theo thứ tự:

1. Đọc realtime document Elasticsearch cùng `_seq_no` và `_primary_term`.
2. Sau đó đọc trạng thái hiện tại từ Job Core.
3. Ghi với `if_seq_no`/`if_primary_term`; nếu chưa có document thì dùng `op_type: create`.
4. Khi một lượt khác đã ghi trước, bỏ snapshot nguồn cũ và đọc lại **cả hai bên**.
   Tối đa 5 lần tranh chấp trong một lượt; không đổi generation rồi ghi lại payload cũ.

Cơ chế này dùng [Elasticsearch optimistic concurrency control](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/optimistic-concurrency-control),
hoạt động cả khi nhiều Search replica hoặc lượt dựng lại index cùng ghi một tin.
Replay không tạo thêm document; nội dung không đổi thì giữ `indexedAt` cũ. Dù vậy
vẫn ghi có điều kiện để tăng generation, chặn lượt chậm trong tình huống nguồn
đổi A → B → A. Đây là chống trùng ở **kết quả nghiệp vụ**, không phải sổ lưu toàn
bộ event ID và không bảo đảm mỗi event chỉ gây một lần đọc/ghi.

Tin PS4 hoặc không còn ở nguồn được thay bằng tombstone tối thiểu trên chính ID
cũ (`searchDeleted: true`), không xóa vật lý document. Nhờ giữ generation, một
lượt cập nhật cũ đang chạy dở không thể tự làm tin xuất hiện lại. Nếu nguồn thật
sự khôi phục tin, lần đối chiếu sau được phép hiển thị lại. Search/suggest/facets/
related đều lọc tombstone; API không trả `searchSync`/`searchDeleted`. Health và
reindex count không tính tombstone, nhưng vẫn có thể tính tin chưa được duyệt.
`searchSync` là object không được lập chỉ mục, chứa hash và dấu chẩn đoán gần nhất;
`triggerEventId` không phải phiên bản dữ liệu hay danh sách sự kiện đã xử lý.

Dựng lại index và sự kiện công ty cũng đi qua đường đối chiếu từng ID này, không
còn bulk ghi snapshot cũ, xóa orphan trực tiếp hay `updateByQuery` trạng thái cũ.
Danh sách Job Core chỉ để tìm ID, kết hợp với ID đang có trong Elasticsearch.
Trước khi quét có refresh để thấy cả ghi vừa được xác nhận; sau đó quét hết các
trang bằng [scroll và đóng cursor](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results),
không còn giới hạn 10.000 tin. Danh sách nguồn rỗng vẫn kiểm tra từng tin trong
index. Mỗi lượt đối chiếu dùng tối đa 4 tác vụ con; một tiến trình chỉ có một lượt
rebuild đang chạy. Số tác vụ này không phải giới hạn toàn cụm và chưa phân trang
API danh sách MySQL, nên cần theo dõi tải khi dữ liệu lớn.

Lỗi một phần không còn được báo là dựng index thành công: API `/internal/reindex`
trả 503; các ghi đã thành công không rollback. Lỗi đối chiếu lúc khởi động/định kỳ
được ghi log, Search tiếp tục phục vụ index cũ và thử lại theo chu kỳ
`RECONCILE_MINUTES` (mặc định 10). `/health` hiện phản ánh ES truy cập được, **không
chứng minh index đã cập nhật đầy đủ**. Thành công rebuild cũng không phải snapshot
nguyên tử của toàn bộ MySQL trong lúc nguồn tiếp tục thay đổi.

Search bật retry 2/10/30 giây cho event có ID khi gặp lỗi kết nối/timeout đã nhận
diện, HTTP 429/500/502/503/504, hoặc hết 5 lượt tranh chấp CAS. Sai ID/schema/quyền,
404 không đúng hợp đồng và lỗi không nhận diện không tự retry; chuyển DLQ theo
wrapper dùng chung. Event legacy không có ID vẫn đọc lại nguồn an toàn, nhưng
không bật retry nghiệp vụ; đối chiếu định kỳ là đường bù. Chưa có replay DLQ tự động.

Điều kiện và giới hạn:

- Job Core phải đọc **MySQL primary hiện tại**, không đặt cache hoặc read replica
  có độ trễ trước endpoint này. Search không tự sửa thứ tự thao tác ghi ngay tại
  nguồn; Job Core đã có hàng rào riêng cho kết quả AI ở phần bên dưới. Chưa chuẩn
  hóa phiên bản cho mọi thao tác legacy/SQL trực tiếp.
- Mọi writer vào index `jobs` phải dùng đường CAS mới. Search cũ, script ghi thẳng
  ES hoặc việc xóa tombstone/index có thể làm mất bảo vệ. Chưa có chính sách dọn
  tombstone; không tự thêm TTL. Mapping mới chỉ bổ sung, không reset index.
- Đây vẫn là eventual consistency, không phải transaction chung MySQL–ES hay
  exactly-once. Phụ thuộc nguồn lúc đồng bộ và chi phí đọc/ghi tăng; chuẩn hóa
  domain version ở toàn bộ writer là bước tối ưu riêng sau này.

Áp dụng trong môi trường local khi đã sẵn sàng (chưa chạy các lệnh này trong lần bổ sung):

```powershell
docker compose stop search-service
docker compose up -d --no-deps --force-recreate job-core-service
```

Chờ Job Core sẵn sàng và xác nhận endpoint mới trả đúng JSON với secret nội bộ,
rồi mới chạy:

```powershell
docker compose up -d --no-deps --force-recreate search-service
docker compose logs --tail=100 search-service
```

Phải dừng **tất cả** Search replica cũ trước khi cho bản mới ghi index, không chạy
cuốn chiếu lẫn hai kiểu writer. Không cần đổi schema MySQL, thêm biến môi trường,
nạp dữ liệu mẫu hoặc khởi động lại database. Kiểm tra log đối chiếu, kết quả tìm
kiếm và lượng lỗi/DLQ sau nâng cấp; không chỉ dựa vào health.

Kiểm thử:

```powershell
npm test
npm run test:search-projection:integration
```

Bài integration dùng image ES 8.15.0 có sẵn, cổng localhost ngẫu nhiên và nguồn
HTTP giả lập có kiểm soát; không kết nối ES/MySQL/RabbitMQ của dự án. Script tự
kiểm tra nhãn sở hữu rồi dọn đúng container/volume tạm. 11 kiểm tra ES thật gồm
CAS đồng thời, replay, A → B → A, tombstone với rebuild chậm, trạng thái công ty/
kiểm duyệt, lỗi nguồn, phản hồi ghi bị mất được mô phỏng ở client, nguồn rỗng và
quét hơn 10.000 ID. Chưa phải kiểm thử end-to-end MySQL–RabbitMQ–ES hoặc ES failover.
Controller nguồn, bảo vệ API, retry và wiring được kiểm tra bằng unit test.

## AI Worker: chống gọi lại tác vụ đã nhận

Worker bổ sung ledger `ai_worker_db.task_executions` trên MongoDB hiện có, tách
database khỏi Identity/Admin. `AI_MONGO_URL` được cấp riêng trong Compose; chạy
ngoài Docker phải tự cấu hình URI có tên database dành riêng cho AI. Worker phải
kết nối được ledger và kiểm tra index trước khi nhận tác vụ. Không đổi schema
MySQL, không ghi vào database nghiệp vụ của service khác.

Phạm vi nhận diện:

- Ưu tiên `eventId` của tin đầu vào. Outbox Job Core đã cấp ID cho các yêu cầu
  `ai.moderate_job` mới. Hai ID khác nhau là hai yêu cầu khác nhau, kể cả cùng job.
- Ba tác vụ CV/độ khớp/thư ứng tuyển mới dùng outbox với `eventId = taskId`.
  Tin legacy đã tồn tại không có event ID vẫn dùng cặp routing key + taskId làm khóa.
- Kiểm duyệt legacy không có cả event ID lẫn task ID vẫn tương thích luồng cũ,
  có cảnh báo và **chưa chống trùng**. Không suy đoán danh tính từ jobId hoặc hash
  nội dung, vì một tin có thể được sửa và kiểm duyệt nhiều lần.
- Khóa đã tồn tại nhưng nội dung đầu vào khác sẽ bị từ chối (`AI_TASK_ID_CONFLICT`).
  Hash chỉ để phát hiện xung đột; không dùng làm danh tính tác vụ và không lưu CV gốc.

Ledger có ba trạng thái, mỗi bước là một
[ghi nguyên tử trên một document MongoDB](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/):

1. `started`: insert khóa `_id` duy nhất, kèm owner và dấu thời gian, **trước khi
   gọi AI**. Chỉ worker nhận xác nhận insert thành công được chạy model. Claim
   không có TTL, không hết hạn để worker khác tự giành lại.
2. `ready`: lưu nguyên kết quả thành công/thất bại và envelope `ai.result` trước
   khi gửi RabbitMQ. Mã sự kiện kết quả ổn định theo khóa tác vụ; thời điểm và
   correlation ID được giữ nguyên khi gửi lại kết quả đã lưu.
3. `published`: chỉ đánh dấu sau publisher confirm. Lược bỏ nội dung kết quả khỏi
   ledger, giữ khóa/hash/dấu trạng thái. Tin trùng đã published được bỏ qua, không
   gọi model hoặc phát kết quả lại.

Các bản trùng trong cùng tiến trình chờ chung công việc đang chạy. Giữa các
replica, khóa MongoDB là hàng rào chính: nếu thấy `started` mà chưa có kết quả thì
không gọi AI lần nữa, kể cả bản ghi rất cũ. Có thể worker khác còn đang xử lý,
hoặc đã chết sau khi gửi yêu cầu tới nhà cung cấp. Không thể phân biệt chắc chắn
hai trường hợp chỉ bằng thời gian, nên báo `AI_TASK_UNRESOLVED` và để wrapper
chuyển bản tin vào DLQ để kiểm tra. Một bản trùng có thể vào DLQ trong khi owner
cũ vẫn chạy và hoàn thành bình thường. Không coi trạng thái này là đã thành công.

Nếu lần gọi model ném lỗi, worker lưu kết quả `ok: false` như trước, không tự chạy
lại cùng tác vụ. Tắt retry ẩn trong SDK bằng `maxRetries: 0`; mặc định SDK tự thử
lại một số lỗi, xem [Claude TypeScript SDK — Retries](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript#retries).
Điều này không kiểm soát việc xử lý/fallback nội bộ tại nhà cung cấp và không phải
cam kết họ chỉ tính phí đúng một lần. Cấu hình model, prompt và fallback giữ nguyên.

Lỗi lưu ledger/gửi RabbitMQ không bị bắt thành lỗi model nữa. Đặc biệt, gửi một
kết quả thành công thất bại sẽ không phát thêm kết quả thất bại mâu thuẫn. Khi
nhận lại bản tin ở trạng thái `ready`, chỉ gửi lại envelope đã lưu, không gọi AI.
MongoDB dùng ghi `majority` + journal, có timeout; mất xác nhận insert không được
coi là đã giành quyền chạy. Không bật retry handler tự động cho AI trong bước này.

Giới hạn quan trọng:

- Đây là bảo vệ số lần gọi ở worker cho tác vụ nhận diện được, không phải
  exactly-once toàn hệ thống. Crash sau khi model chạy nhưng trước khi lưu kết quả
  có thể để lại `started` và người dùng chưa nhận được kết quả. Không tự xóa dấu
  claim, không tự chạy lại hoặc tạo ID mới để vượt qua trạng thái chưa xác định.
- Không có relay nền cho kết quả ở bước này. Khi lỗi chuyển kết quả, tin đầu vào
  đi qua DLQ có confirm; việc phục hồi cần kiểm tra/replay có chủ đích. `ready`
  chỉ được gửi tiếp khi worker nhận lại tin đầu vào tương ứng.
- Kết quả vẫn có thể được giao hơn một lần (hai replica cùng đọc `ready`, confirm
  hoặc dấu published bị mất). Chúng giữ cùng event ID và nội dung. Job Core đã
  được bổ sung inbox/giao dịch và mã lượt kiểm duyệt như phần bên dưới. Điều này
  không tự bật replay DLQ hoặc retry việc gọi model.
- `published` xác nhận broker nhận tin, không chứng minh Job Core xử lý xong.
  Endpoint CV của Job Core đã dùng outbox ở phần bên dưới; việc lưu yêu cầu không
  đồng nghĩa model đã chạy hoặc kết quả đã đến người dùng.
- Không backfill tác vụ đã chạy bằng worker cũ. Phải giữ ledger bền vững và cùng
  database cho mọi replica; xóa ledger hoặc đổi ID/cách đóng gói khi replay có thể
  gây gọi lại. Chưa có chính sách xóa khóa lịch sử.
- Kết quả ở `ready` có thể chứa dữ liệu CV, cần phân quyền và bảo vệ backup; phần
  kết quả được bỏ sau confirm. Đây không phải xóa dữ liệu khỏi RabbitMQ/DLQ,
  Job Core, nhật ký Admin hay backup. Không ghi payload/result ra log của worker.

Kiểm tra chỉ đọc trong database AI, không hiển thị nội dung CV/kết quả:

```javascript
db.task_executions.find(
  { state: { $in: ["started", "ready"] } },
  { _id: 1, eventId: 1, aggregateId: 1, routingKey: 1, state: 1, startedAt: 1, completedAt: 1 }
).sort({ startedAt: 1 })
```

Với `started`, đối chiếu worker còn sống, log và yêu cầu phía nhà cung cấp trước
khi quyết định xử lý; không dùng tuổi bản ghi làm bằng chứng AI chưa chạy. Với
`ready`, kiểm tra trạng thái nghiệp vụ hiện tại và nguy cơ kết quả cũ ở Job Core
trước khi replay. Giữ nguyên body, routing key, message ID và metadata gốc; chỉ
gửi về đúng queue `ai-worker.jobs`, không phát lại lên topic cho mọi consumer.
Chưa bổ sung công cụ replay hoặc sửa ledger tự động.

Áp dụng khi đã sẵn sàng: ngừng tạo tác vụ mới, chờ worker cũ hoàn thành việc đang
chạy và dừng **tất cả** replica cũ; không chạy lẫn bản có/không có ledger. Cài phụ
thuộc từ workspace `microservices`, bảo đảm MongoDB đang sẵn sàng, rồi recreate
riêng AI Worker bằng cấu hình Compose mới. Không restart/xóa database hay nạp
dữ liệu mẫu. Việc dừng tiến trình đang gọi AI có thể để lại tác vụ chưa xác định.
Lần bổ sung này **chưa chạy thao tác triển khai**.

Kiểm thử:

```powershell
npm test
npm run test:ai-tasks:integration
```

Integration dùng MongoDB 7 tạm trên cổng localhost ngẫu nhiên, tự xác minh nhãn sở
hữu trước khi dọn container/volume. 11 kiểm tra gồm 30 worker độc lập tranh cùng
khóa, đọc lại qua kết nối mới, xung đột input, các điểm mất phản hồi ghi, claim
chưa xác định, gửi lại kết quả và tương thích legacy. Model/RabbitMQ được giả lập:
không dùng API key, không phát sinh phí AI, chưa phải kiểm thử Claude/RabbitMQ
end-to-end hoặc MongoDB replica-set failover. Unit test kiểm tra thêm wiring,
thứ tự các bước, giới hạn concurrency và tắt retry SDK.

## Job Core: nhận kết quả AI đúng một lần về mặt nghiệp vụ

Job Core bổ sung hai bảng trong cùng MySQL hiện tại: `ai_result_inbox` và
`job_moderation_state`. Chỉ tạo bảng mới bằng `CREATE TABLE IF NOT EXISTS`, không
ALTER/xóa dữ liệu bảng `posts`, `detailposts` hoặc `ai_tasks`. Trước khi nhận việc,
startup kiểm tra cả sáu bảng tham gia (`posts`, `detailposts`, `ai_tasks`,
`outbox_events` và hai bảng mới) đều dùng InnoDB; không tự đổi storage engine.

Với mỗi `ai.result` có event ID, một giao dịch bao gồm:

1. Ghi dấu inbox bằng khóa event ID phân biệt hoa/thường và hash nội dung.
2. Khóa dòng công việc/tin tuyển dụng để đọc trạng thái mới nhất.
3. Nếu kết quả còn hợp lệ, cập nhật dữ liệu và đóng lượt kiểm duyệt.
4. Với quyết định kiểm duyệt được áp dụng, ghi `job.moderated` vào outbox bằng
   cùng connection; sau đó ghi kết cục inbox rồi commit.

Không gọi RabbitMQ, AI hoặc SMTP trong giao dịch này. Relay có confirm hiện có
phát thông báo sau commit; Notification/Admin nhận được event ID ổn định để
chống trùng. Mất ACK/commit response có thể làm consumer chạy lại, nhưng cùng ID
và cùng nội dung không tạo lại thay đổi hoặc thông báo. Cùng ID nhưng nội dung
khác bị từ chối (`AI_RESULT_ID_CONFLICT`), không ghi đè kết quả trước.

Các locking read dùng `FOR UPDATE` và giữ khóa đến cuối giao dịch, theo
[MySQL Locking Reads](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html).
Inbox, dữ liệu nghiệp vụ và ý định phát sự kiện cùng rollback khi có lỗi. Điều
này không phải exactly-once truyền tải: RabbitMQ vẫn có thể giao trùng và các
consumer khác vẫn phải giữ cơ chế chống trùng của riêng mình.

### Hàng rào chống kết quả kiểm duyệt cũ

Mỗi lần tạo tin hoặc cập nhật tiêu đề/mô tả qua Job Core:

- Tạo UUID mới `moderationRequestId`, dùng cùng UUID làm ID event `ai.moderate_job`.
- Ghi mã hiện tại và hash nguyên văn `name`/`descriptionHTML` vào
  `job_moderation_state`, cùng giao dịch ghi tin/outbox.
- Tin ở trạng thái `PS3` trong lúc chờ. Cập nhật không đụng hai trường nội dung
  này không tạo lượt kiểm duyệt mới. Gửi lại hai trường dù nội dung giống nhau
  vẫn tạo lượt mới; không suy đoán danh tính từ nội dung hoặc thời gian.

AI Worker trả lại mã từ yêu cầu gốc trong phần điều khiển của kết quả, không lấy
mã do model sinh ra. Job Core chỉ áp dụng khi mã khớp lượt `pending`, tin còn
`PS3` và hash nội dung hiện tại vẫn khớp. Kết quả cũ/mất đối tượng/đã xử lý được
ghi nhận `stale` rồi ACK, không đổi tin hoặc tạo thông báo. A → B → A qua Job Core
vẫn dùng mã mới, nên không vô tình chấp nhận quyết định của lần A đầu tiên.

Gỡ tin đặt `PS4` và hủy lượt kiểm duyệt trong cùng giao dịch. Sửa một tin đã gỡ
trả 409, không tự khôi phục nó. Kết quả đến sau quyết định duyệt/từ chối thủ công
không được ghi đè trạng thái đó. Nếu AI trả lỗi hạ tầng, giữ tin `PS3`, đánh dấu
lượt là `failed` để kiểm tra/duyệt thủ công; lỗi hạ tầng không phải kết luận vi phạm.

Giới hạn với writer cũ: kiểm tra hash phát hiện nội dung hiện tại đã bị sửa trực
tiếp, nhưng backend cũ/SQL ngoài Job Core chưa tạo mã lượt mới và chưa tham gia
giao thức này. Không bảo đảm phát hiện mọi chuỗi A → B → A hay chuỗi thay đổi trạng
thái xảy ra hoàn toàn ở writer cũ rồi trở lại giá trị ban đầu trước khi nhận kết
quả. Không có trigger mới hoặc chuyển đổi toàn bộ backend cũ trong bước này.

### Kết quả CV và tương thích tin cũ

Với parse CV/độ khớp/thư ứng tuyển, kiểm tra `taskId`, loại tác vụ và trạng thái
trong `ai_tasks`. Chỉ tác vụ `pending` nhận kết quả đầu tiên; `done`/`failed` không
bị cập nhật lại bởi kết quả đến sau, kể cả một event ID khác hoặc tin legacy không
có event ID. Không nhận kết quả sai loại, sai đối tượng hay `ok`/`approved` không
phải boolean. JSON kết quả được lưu nguyên vẹn, không cắt giữa chuỗi ở 60.000 ký
tự như trước; từ chối kết quả vượt 1 MiB. Không tự sửa các JSON hỏng đã tồn tại.

Kết quả kiểm duyệt cũ thiếu `moderationRequestId` không đủ căn cứ để tự duyệt:
`AI_RESULT_UNCORRELATED` đưa vào DLQ để kiểm tra, **không suy đoán/bổ sung token**
từ lượt đang chờ. Quy tắc này áp dụng cả kết quả có event ID nhưng thiếu token.
Không backfill, không tự tái kiểm duyệt hàng loạt hoặc gọi lại AI. Nếu cần, người
vận hành kiểm tra tin rồi chủ động duyệt tay hoặc yêu cầu một lượt kiểm duyệt mới.

Handler kết quả bật retry 2/10/30 giây cho lỗi MySQL tạm thời đã nhận diện và event
có ID (mất kết nối, deadlock, lock timeout, quá nhiều kết nối). Retry chạy lại
**toàn bộ giao dịch**, không gọi model. Sai schema/quyền/dữ liệu/ID hoặc thiếu
token không tự retry. Tin legacy không có event ID không bật retry nghiệp vụ.
Xem [MySQL handling deadlocks](https://dev.mysql.com/doc/refman/8.0/en/innodb-deadlocks-handling.html).
Không có replay DLQ tự động trong thay đổi này.

### Áp dụng và kiểm tra

Khi sẵn sàng triển khai, cần tạm ngừng tạo/sửa tin và tạo tác vụ AI mới, để các
worker cũ hoàn tất công việc đang chạy rồi dừng tất cả Job Core/AI Worker replica
cũ. Không chạy lẫn hai phiên bản xử lý kết quả. Backup MySQL, kiểm tra InnoDB và
quyền tạo hai bảng mới; không tự đổi engine hoặc xóa dữ liệu để vượt lỗi startup.

Nâng AI Worker để hỗ trợ trả token, rồi nâng Job Core trước khi mở lại luồng ghi
và xử lý hàng đợi. Kiểm tra riêng các yêu cầu/kết quả cũ đang ở queue, DLQ hoặc
ledger `ready`: bản đã lưu không được tự thêm token khi replay. Chúng có thể cần
duyệt thủ công hoặc tạo yêu cầu mới có chủ đích. Không restart database, nạp lại
dữ liệu mẫu hoặc xóa inbox/ledger. Lần bổ sung này **chưa triển khai**.

Kiểm tra chỉ đọc, không lấy nội dung CV/kết quả:

```sql
SELECT eventId, resultType, aggregateId, outcome, processedAt
FROM ai_result_inbox ORDER BY processedAt DESC LIMIT 50;
SELECT jobId, requestId, state, requestedAt, resolvedAt
FROM job_moderation_state ORDER BY requestedAt DESC LIMIT 50;
```

Không có TTL/cleanup tự động cho hai bảng mới. Xóa inbox hoặc đặt lại tác vụ về
`pending` có thể làm mất bảo vệ; chỉ thực hiện theo quy trình phục hồi đã xem xét.
Kết quả CV vẫn nằm trong `ai_tasks` như trước, inbox chỉ giữ hash/metadata/kết cục.

```powershell
npm test
npm run test:ai-results:integration
```

11 kiểm tra trên MySQL 8.0 tạm bao gồm 30 bản sao đồng thời, rollback cả inbox/
outbox/trạng thái, mất phản hồi sau commit thật, A → B → A, khóa khi sửa/nhận kết
quả, tin bị gỡ/duyệt tay, nội dung thay đổi trực tiếp và JSON dài. Script dùng image
có sẵn, cổng localhost và database riêng; tự kiểm tra nhãn sở hữu trước khi dọn
container/volume tạm. Không đọc cấu hình MySQL của dự án, không gọi RabbitMQ/AI/
SMTP thật. Mất phản hồi được mô phỏng phía client, chưa phải thử failover hay
kiểm thử end-to-end; retry/wiring/echo token được kiểm tra bằng unit test.

## Job Core: lưu bền vững yêu cầu AI từ CV

Ba endpoint `POST /ai/parse-resume`, `/ai/match-cv`, `/ai/cover-letter` dùng
`libs/aiTaskRequest.js` để lưu tác vụ và ý định gửi AI trong **cùng một giao dịch
MySQL**. Tái sử dụng `ai_tasks` và `outbox_events` đã có. Phần chống trùng HTTP
bên dưới bổ sung riêng bảng `ai_request_keys`; kiểm tra InnoDB tại startup vẫn áp dụng.

Luồng nhận một yêu cầu mới (sau khi kiểm tra khóa gửi lại, nếu có):

1. Kiểm tra trường bắt buộc/kiểu dữ liệu. Match/thư vẫn chỉ đọc tin `PS1` thuộc
   công ty `S1`/`CS1`; không tìm thấy hoặc không công khai trả 404.
2. Tạo `taskId` UUID mới, đóng gói toàn bộ đầu vào worker rồi kiểm tra kích thước.
3. Cùng connection: insert `ai_tasks` ở trạng thái `pending`, sau đó insert outbox
   có `aggregateType = ai_task`, `aggregateId = taskId`, `eventId = taskId`.
4. Chỉ trả HTTP 202 cùng `{ errCode: 0, taskId, errMessage }` sau khi commit được
   xác nhận. Giao diện tiếp tục hỏi `/ai/tasks/:taskId` như trước.

Handler HTTP không mở kết nối RabbitMQ. Nếu Job Core đang chạy mà đường gửi tới
broker gặp lỗi, yêu cầu vẫn được nhận khi MySQL hoạt động; relay giữ bản ghi chờ
và thử gửi lại. Startup Job Core vẫn cần kết nối consumer RabbitMQ trước khi mở
cổng HTTP, nên thay đổi này không cho phép khởi động toàn service khi broker tắt.
Relay dùng publisher confirm + mandatory routing đã có; không đánh dấu đã gửi
nếu không có queue phù hợp. Retry giữ nguyên event ID, thời điểm và payload đã lưu.

Với match/thư, tiêu đề, mô tả và tên công ty là snapshot tại lần đọc tin hợp lệ
trong request. Relay không đọc lại tin khi gửi: thay đổi sau đó không làm một
event ID mang hai nội dung khác nhau. Đây không phải khóa ngăn tin/công ty thay
đổi đồng thời với lúc nhận yêu cầu, cũng không phải tự hủy tác vụ nếu tin bị gỡ sau đó.

### Giới hạn đầu vào và lỗi

- Payload gửi worker tối đa **8 MiB JSON UTF-8**, tính cả base64, Unicode, ký tự
  escape và metadata. File PDF gốc phải nhỏ hơn khoảng 6 MiB để còn chỗ cho tên
  file/metadata. Dữ liệu gốc quá lớn trả 413 trước khi mở giao dịch. Nếu snapshot
  tin làm payload vượt giới hạn, rollback giao dịch và trả 413, không cắt nội dung.
- `fileBase64`/`resumeText` phải là chuỗi không rỗng; `fileName`/`language` nếu có
  phải là chuỗi hoặc null; `jobId` là số nguyên dương an toàn hoặc chuỗi số tương
  ứng. Chưa thêm bước xác thực nội dung PDF/base64 hay đổi giới hạn/prompt của model.
- `ai_tasks.input` chỉ giữ metadata (`fileName` hoặc `jobId`/`language`), lưu JSON
  nguyên vẹn thay vì cắt ở 60.000 ký tự. Không tự sửa JSON cũ đã hỏng.
- Lỗi ghi task/outbox làm rollback cả giao dịch. Handler trả 500, không trả 202
  hoặc mã tác vụ khi chưa xác nhận commit; log chỉ loại tác vụ/mã lỗi, không đưa
  SQL hay nội dung CV từ lỗi MySQL vào phản hồi/log của handler.

Các POST cùng tài khoản/khóa/nội dung đã có chống trùng như phần bên dưới. POST
không có khóa hoặc dùng khóa mới vẫn tạo tác vụ độc lập, kể cả cùng nội dung. Nếu
commit thành công nhưng phản hồi bị mất, task/outbox có thể tồn tại dù client
gặp 500/timeout; gửi lại phải giữ nguyên khóa. Handler không tự retry giao dịch.

### Dữ liệu lưu giữ và áp dụng

Outbox giờ chứa toàn bộ CV base64/nội dung CV và snapshot tin cần cho worker.
Payload vẫn được giữ sau `publishedAt`, theo cách lưu của outbox hiện tại; chưa
thêm TTL, mã hóa ứng dụng hoặc tự xóa. Cần giới hạn quyền đọc outbox và bảo vệ
database/backup như dữ liệu CV. `ai_tasks.input` không giữ thêm một bản CV gốc.
Chính sách lưu giữ/xóa cần xét cả outbox, RabbitMQ/DLQ, kết quả và backup.

Nâng Job Core sau khi AI Worker đã có ledger hỗ trợ envelope v1 từ bước trước.
Giữ queue/binding bền vững và cấu hình MySQL/RabbitMQ đã có. Lớp gọi API frontend
đã hỗ trợ khóa gửi lại như phần sau; không cài thêm thư viện hoặc restart database.
Lần bổ sung này **chưa triển khai**.

Không backfill task `pending` cũ thiếu outbox: metadata cũ không đủ khôi phục CV và
không chứng minh AI chưa chạy. Giữ nguyên metadata khi xử lý tin legacy; tự thêm
event ID cho tin đã dùng khóa `task:<routingKey>:<taskId>` sẽ đổi khóa ledger sang
`event:<eventId>` và có thể làm AI chạy lại. Không có replay DLQ hoặc tự gọi lại
model trong thay đổi này.

Kiểm tra chỉ đọc, không lấy payload CV:

```sql
SELECT t.id, t.type, t.status, t.createdAt, e.attempts,
       e.nextAttemptAt, e.publishedAt
FROM ai_tasks t
LEFT JOIN outbox_events e ON e.id = t.id AND e.aggregateType = 'ai_task'
ORDER BY t.createdAt DESC LIMIT 50;
```

### Kiểm thử

```powershell
npm test
npm run test:ai-requests:integration
```

Script có 18 kiểm tra dùng MySQL 8.0, RabbitMQ 4 tạm và HTTP localhost. Mười kiểm
tra outbox gồm: cả ba endpoint lưu dữ liệu
khi transport lỗi, snapshot ổn định, rollback sau insert outbox thật, lỗi insert
task, dữ liệu quá lớn/không hợp lệ/tin không công khai, retry sau mất kết nối,
mandatory routing, phục hồi gửi thật, lỗi đánh dấu DB sau broker confirm và nhận
kết quả/hỏi trạng thái bằng đúng task ID. Unit test kiểm tra thêm chờ commit,
commit không xác định, biên 8 MiB và tính byte Unicode/JSON escape. Tám kiểm tra
HTTP bổ sung được mô tả ở phần chống trùng bên dưới.

Script chỉ dùng image có sẵn, cổng localhost ngẫu nhiên và thông tin kết nối tạm
do nó tạo, không đọc cấu hình database dự án. SQL trigger gây lỗi chỉ tồn tại
trong database thử; kiểm tra nhãn sở hữu trước khi dọn từng container/volume.
Không gọi Claude/SMTP; chưa thử failover database, AI Worker/MongoDB hoặc toàn
luồng HTTP qua Gateway trong script này. Dừng giữa chừng có thể cần dọn container
mang nhãn `jobfind.ai-requests-test` sau khi xác minh đúng phiên thử.

## Job Core: chống tạo trùng tác vụ khi gửi lại HTTP

Ba endpoint AI nhận header tùy chọn `Idempotency-Key`. Khóa dài 1–128 ký tự ASCII,
bắt đầu bằng chữ/số, còn lại là chữ/số hoặc `._:-`, phân biệt hoa/thường. Mỗi lượt
gửi có chủ đích cần một khóa ngẫu nhiên mới; mọi lần gửi lại của lượt đó giữ nguyên
khóa và nội dung. Không dùng CV, user ID hay hash nội dung làm khóa.

Bảng mới `ai_request_keys` có khóa chính `(userId, requestKey)`, lưu loại tác vụ,
hash ý định của client, `taskId` và thời điểm. Không lưu thêm CV vào bảng này.
Tài khoản được lấy từ danh tính do Gateway xác thực; client không thể dùng khóa
để xem tác vụ của tài khoản khác. Cùng khóa nhưng khác tài khoản là hai yêu cầu
riêng; cùng tài khoản mà đổi endpoint/nội dung trả 409, không lộ task ID cũ.

Trong một giao dịch InnoDB, Job Core insert khóa trước, sau đó mới đọc snapshot
tin, ghi task và outbox. Một request trùng sẽ chờ giao dịch đầu kết thúc:

- Nếu lần đầu commit, cùng loại/hash trả lại task ID đã lưu, không đọc lại tin,
  không ghi task/outbox mới. HTTP vẫn trả 202; dùng API hỏi trạng thái để biết
  task còn `pending` hay đã `done`/`failed`. Không đặt lại trạng thái của task.
- Nếu lần đầu rollback, khóa/task/outbox đều không tồn tại; lần gửi sau có thể
  nhận việc. Lỗi validation, 404 hoặc rollback không được lưu như một kết quả cố định.
- Nếu khóa trỏ đến task bị mất/sai chủ/sai loại, trả 409 yêu cầu đối chiếu thủ công;
  không tự tạo task thay thế hoặc tự gọi lại model.

Hash dùng các trường client thực sự điều khiển: file/name cho parse; resume/job ID
cho match; thêm ngôn ngữ cho thư. Job ID số và chuỗi số được chuẩn hóa như nhau;
ngôn ngữ bỏ trống/null/chuỗi rỗng tương đương mặc định `en`, tên file bỏ trống và
null tương đương. Giữ nguyên văn CV/tên file/ngôn ngữ khác; trường API không sử
dụng không tham gia hash. Snapshot công ty/tin không nằm trong hash này: retry
sau khi tin thay đổi/ẩn/gỡ vẫn tìm được task cũ. Khóa mới vẫn phải qua kiểm tra
tin công khai hiện tại. Phiên bản hash hiện là `1`; không đổi quy tắc khi replay.

### Cách dùng từ frontend

`frontend/src/service/aiSearchService.js` xuất `createAiRequestOptions()`. Giao diện
cần tạo options **một lần cho mỗi lượt thao tác**, giữ trong state/ref rồi truyền
lại cho cả lần gửi đầu, lần bấm trùng và lần thử lại sau lỗi:

```js
const options = createAiRequestOptions();
const result = await matchCvAi(resumeText, jobId, options);
// Khi người dùng thử lại chính lượt trên:
const retried = await matchCvAi(resumeText, jobId, options);
```

Chữ ký tương ứng: `parseResumeAi(fileBase64, fileName, options)` và
`coverLetterAi(resumeText, jobId, language, options)`. Thay đổi input hoặc chủ động
yêu cầu AI xử lý mới phải tạo options mới. Không tự đổi khóa khi gặp 409/timeout.

Để tương thích lời gọi cũ, bỏ options sẽ tạo khóa mới cho **mỗi lần gọi hàm**.
Kết quả thành công hoặc lỗi đã được Axios chuẩn hóa đều có thêm `idempotencyKey`;
promise bị reject cũng giữ khóa trên Error. Nếu lần đầu không giữ options, có
thể thử lại với `{ idempotencyKey: result.idempotencyKey }`. Không có retry mạng
tự động, cache kết quả theo nội dung hay lưu CV/khóa vào localStorage.

Hiện repo chưa có màn hình gọi ba hàm AI này ngoài lớp service/test. Phần này
hoàn thiện hợp đồng API và helper; chưa gắn cơ chế vào nút UI cụ thể. Bỏ options
trên hai lần bấm hoặc làm mất khóa khi tải lại trang vẫn có thể tạo hai tác vụ.
Client cũ gửi trực tiếp HTTP không có header cũng chưa được bảo vệ khỏi gửi trùng.

### Nâng cấp và kiểm tra

Job Core tạo thêm bảng bằng `CREATE TABLE IF NOT EXISTS`, kiểm tra InnoDB trước
khi mở HTTP/consumer; không ALTER bảng nghiệp vụ, không backfill task cũ. Cần
backup và quyền tạo bảng. Dừng/loại khỏi phục vụ tất cả replica Job Core cũ trước
khi đưa client có khóa vào sử dụng: bản cũ bỏ qua header và có thể tạo trùng.
Nâng toàn bộ Job Core trước, sau đó nâng lớp gọi API frontend. Không cần đổi
AI Worker ở bước này. Thay đổi **chưa được triển khai**.

Không có TTL/xóa tự động cho khóa; xóa mapping có thể biến retry cũ thành lượt
gọi AI mới. Giữ mapping và task cùng quy trình lưu giữ/phục hồi. Không xem một
500/timeout là bằng chứng giao dịch đã rollback; dùng lại khóa để đối chiếu.

```sql
SELECT k.userId, k.type, k.taskId, k.createdAt, t.status
FROM ai_request_keys k LEFT JOIN ai_tasks t ON t.id = k.taskId
ORDER BY k.createdAt DESC LIMIT 50;
```

Tám kiểm tra HTTP/MySQL thật bổ sung trong `test:ai-requests:integration` bao gồm
20 lần gửi đồng thời cho mỗi endpoint, retry sau tin bị gỡ, xung đột input/loại,
chủ động ngắt kết nối HTTP sau commit thật, rollback cả ba bảng, 404 không giữ
khóa, cách ly người dùng/phân biệt hoa thường và task hoàn tất/bị mất. Unit test
kiểm tra startup, header qua Gateway, chuẩn hóa input và helper frontend. HTTP
test gọi các handler với middleware tin cậy thật trên localhost, chưa chạy qua
Gateway/JWT thật hay trình duyệt/AI Worker; không gọi AI tính phí.

## Bốn tính năng AI

Tất cả chạy trong AI Worker — **không mở cổng HTTP**, chỉ nhận việc qua RabbitMQ.
Một đợt CV ồ ạt chỉ làm hàng đợi dài ra, không làm sập API.

| Tính năng | Sự kiện | Mô tả |
|---|---|---|
| Resume Parser | `ai.parse_resume` | Đọc thẳng file PDF → JSON có cấu trúc |
| Smart Matching | `ai.match_cv` | Chấm điểm % độ khớp CV ↔ mô tả công việc |
| Content Moderation | `ai.moderate_job` | Quét tin tuyển dụng tìm dấu hiệu lừa đảo, đa cấp, thu phí ứng viên |
| Cover Letter | `ai.cover_letter` | Sinh thư ứng tuyển |

Ba tính năng đầu dùng **structured outputs** (`output_config.format`) nên kết quả
luôn đúng schema, không phải tự parse JSON lẫn trong văn xuôi.

## Chạy hệ thống

```bash
cd microservices
cp .env.example .env      # điền ANTHROPIC_API_KEY
docker compose up -d
docker compose logs -f    # theo dõi
```

Yêu cầu: MySQL (XAMPP) đang chạy ở cổng 3333 với CSDL `jobfindtest`, và backend cũ
chạy ở cổng 5000 nếu muốn dùng các tính năng chưa tách.

### Cổng

Các cổng **cố tình lệch** so với mặc định vì máy này đang chạy sẵn project tham
khảo `unicode_nodejs` chiếm 3000 / 5672 / 15672 / 27018 / 8500.

| Thành phần | Cổng | Ghi chú |
|---|---|---|
| API Gateway | 4000 | Cổng duy nhất ra ngoài |
| Identity Service | 4001 | Chỉ trong mạng Docker |
| Job Core Service | 4002 | Chỉ trong mạng Docker |
| Search Service | 4003 | Chỉ trong mạng Docker |
| MongoDB | 27019 | |
| Elasticsearch | 9201 | |
| Redis | 6380 | |
| RabbitMQ | 5673 | Giao diện quản trị: http://localhost:15673 (tài khoản lấy từ `.env`) |

## Kiểm tra nhanh

```bash
curl http://localhost:4000/health
curl http://localhost:4000/status        # trạng thái service + circuit breaker
curl "http://localhost:4000/api/search/jobs?q=react&limit=5"
curl http://localhost:4000/api/search/facets
```

## Ba cơ chế bảo vệ ở Gateway

**Circuit breaker (opossum).** Khi một service bên dưới treo, mọi request đi qua
Gateway đều nằm chờ hết timeout; kết nối dồn lại và Gateway chết theo. Breaker đếm
số lần thất bại, vượt 50% thì ngắt cầu dao và trả lỗi ngay lập tức. Sau 15 giây nó
cho một request thử đi qua để dò xem service đã sống lại chưa. Xem trạng thái ở
`/status`.

**Rate limit bằng Redis.** Đếm trong bộ nhớ không dùng được vì Gateway có thể chạy
nhiều bản sao — kẻ tấn công chỉ cần rải request đều ra các bản sao là vượt hạn mức.
Redis cho tất cả cùng đếm một chỗ. Riêng đăng nhập chỉ tính lần **thất bại**, nên
người dùng đúng mật khẩu không bao giờ bị khóa.

**Xác thực tập trung.** Gateway giải mã JWT một lần rồi truyền danh tính xuống bằng
header `x-user-id` / `x-user-role` / `x-company-id`. Các header này bị **xóa khỏi
request của client** trước khi Gateway tự đặt lại — nếu không, ai cũng có thể tự gửi
`x-user-role: ADMIN`.

## Kết nối frontend

Đổi một dòng trong `frontend/.env`:

```
REACT_APP_BACKEND_URL=http://localhost:4000
```

Toàn bộ giao diện hiện có tiếp tục chạy (Gateway định tuyến về backend cũ). Các
tính năng mới gọi qua `frontend/src/service/aiSearchService.js`.

## Quản lý hồ sơ ứng tuyển (Application & Workflow Service)

Trước đây toàn bộ "quản lý CV" của nhà tuyển dụng chỉ là một cột `isChecked` 0/1 —
đã đọc hay chưa đọc. Service này thay thế bằng một quy trình tuyển dụng thật.

**Sáu bước:** Mới ứng tuyển → Đang xem xét → Phỏng vấn → Đề nghị nhận việc →
Đã nhận việc / Từ chối. Kéo thả giữa các cột tại `/admin/pipeline`.

| Tính năng | Ghi chú |
|---|---|
| Bảng Kanban | Kéo thả chuyển bước, cập nhật giao diện trước rồi gọi máy chủ |
| Lịch sử chuyển bước | Ai chuyển, từ đâu sang đâu, lý do — ghi cùng giao dịch với lần chuyển |
| Chấm sao 1–5 | Đánh giá nhanh ngay trên thẻ |
| Ghi chú nội bộ | Trao đổi giữa người tuyển dụng, ứng viên không xem được |
| Kho ứng viên | Lưu người hay nhưng chưa hợp vị trí, gắn nhãn để tìm lại |
| Phễu tuyển dụng | Số hồ sơ mỗi bước + tỷ lệ tuyển thành công |

**Gửi kết quả qua email.** Mở chi tiết hồ sơ tại `/admin/pipeline`, nhập lời nhắn
(nếu cần) rồi chọn **Gửi trúng tuyển** hoặc **Gửi không trúng tuyển**. Thao tác
này chuyển hồ sơ vào cột kết quả tương ứng, gửi email tới địa chỉ đã lưu khi ứng
viên nộp hồ sơ, tạo thông báo trong ứng dụng và lưu lịch sử gửi. Nhà tuyển dụng
có thể gửi lại email mà không cần thay đổi trạng thái hồ sơ.

**Snapshot khi nộp.** Bảng `applications` giữ bản sao hồ sơ tại thời điểm ứng viên
bấm nộp (`cv_snapshot` kiểu JSONB). Nếu chỉ lưu khóa ngoại rồi đọc ngược về hồ sơ
gốc, ứng viên sửa CV một tháng sau sẽ làm thay đổi cả những hồ sơ đã nộp từ trước —
nhà tuyển dụng xem lại sẽ thấy một nội dung khác hẳn cái họ đã đọc và đã đánh giá.

Hồ sơ cũ trong MySQL được tự động kéo sang lúc khởi động (`legacy_cv_id` có ràng
buộc UNIQUE nên chạy lại bao nhiêu lần cũng không nhân bản).

## Thông báo (Notification Service)

Nghe sự kiện từ RabbitMQ rồi gửi qua ba kênh. Sự kiện có ID dùng inbox và hàng đợi
gửi bền vững như mô tả ở phần trên: lưu thông báo/yêu cầu gửi trước, rồi xử lý
email và realtime độc lập. Sự kiện legacy không có ID vẫn dùng luồng gửi trực tiếp.

| Kênh | Cách làm |
|---|---|
| Lưu vào CSDL | Ghi thẳng vào bảng `notifications` đang có → chuông thông báo trên giao diện chạy ngay, không sửa một dòng frontend |
| Email | nodemailer; sự kiện có ID chờ cấu hình trong hàng đợi, legacy bỏ qua nếu chưa cấu hình |
| Realtime | Nhờ backend cũ đẩy qua Socket.IO (backend cũ đang giữ kết nối với trình duyệt) |

Sự kiện đang nghe:

- `application.stage_changed` → báo ứng viên khi hồ sơ chuyển bước
- `application.decision_email_requested` → gửi kết quả trúng tuyển hoặc không trúng tuyển do nhà tuyển dụng chọn
- `job.moderated` → báo người đăng tin khi AI duyệt xong
- `job.created` → báo những người đang theo dõi công ty đó

**Vì sao không dựng máy chủ Socket.IO thứ hai:** backend cũ đã giữ sẵn kết nối
WebSocket với trình duyệt. Dựng thêm một máy chủ nữa sẽ bắt frontend mở hai kết nối
song song. Thay vào đó Notification Service gọi endpoint nội bộ
`/internal/emit-notification`, được bảo vệ bằng khóa dùng chung `INTERNAL_SECRET`
(không dùng JWT vì đây là giao tiếp giữa hai máy chủ, không có người dùng nào ở giữa).

Để gửi email thật, thêm `EMAIL_APP` và `EMAIL_APP_PASSWORD` (Gmail App Password)
vào `microservices/.env`. Đặt `FRONTEND_URL` thành địa chỉ frontend công khai để
các nút trong email mở đúng trang, sau đó khởi động lại Notification Service.
Email dùng chung khung responsive, có bản văn bản thuần và không phụ thuộc ảnh
ngoài. Dữ liệu mẫu
có thể chứa địa chỉ như `example@gmail.com`; trong `NODE_ENV=development`, các
địa chỉ mẫu được chuyển an toàn tới `EMAIL_DEMO_RECIPIENT`, hoặc tới `EMAIL_APP`
nếu chưa đặt biến này. Trong production, địa chỉ mẫu/không hợp lệ bị bỏ qua trước
khi gọi SMTP nên không tạo thêm thư báo lỗi 550.

> ⚠️ **Gateway phải chuyển tiếp được WebSocket.** Lớp proxy dựa trên axios chỉ xử lý
> được request/response thường, không làm được HTTP Upgrade. Nếu thiếu đoạn
> `http-proxy-middleware` với `ws: true` trong `api-gateway/src/app.js`, chat và
> thông báo realtime sẽ **chết lặng — không báo lỗi gì cả**. Bộ smoke test có một
> mục canh riêng cho chuyện này.

## Báo cáo & Nhật ký (Admin & Reporting Service)

Vào `/admin/reports`. Ba nhóm chức năng:

**Biểu đồ thống kê.** Nối số liệu từ **cả ba cơ sở dữ liệu** — tin tuyển dụng và
doanh thu ở MySQL, hồ sơ ứng tuyển ở PostgreSQL, nhật ký ở MongoDB. Người xem chỉ
gọi một API cho mỗi khối; phần nối dữ liệu nằm ở phía máy chủ.

> Đây là ngoại lệ **có chủ đích** so với nguyên tắc "mỗi service một CSDL riêng":
> báo cáo cần trả lời những câu hỏi không đoán trước được. Nếu bắt mọi số liệu phải
> đi qua sự kiện, ta sẽ phải dựng sẵn một bảng tổng hợp cho từng câu hỏi — và thêm
> một câu hỏi mới là phải sửa cả hệ thống. Đổi lại, service này **chỉ đọc**, tuyệt
> đối không ghi vào MySQL hay PostgreSQL.

**Nhật ký hoạt động.** Là service duy nhất đăng ký `#` trên RabbitMQ — nghe **toàn
bộ** sự kiện của hệ thống. Cộng thêm mọi thao tác làm thay đổi dữ liệu đi qua
Gateway (đặt ở Gateway nên bao phủ cả phần còn nằm ở backend cũ; nếu để từng service
tự ghi, một service quên là có một mảng trống mà không ai biết).

Tra cứu ngược được: `GET /api/admin/audit/target/job/57` cho ra toàn bộ dấu vết của
tin đó xuyên qua các service:

```
event job.created        (job-core-service)
event ai.moderate_job    (job-core-service → ai-worker)
event ai.result          (ai-worker)
```

Nhật ký tự xóa sau 180 ngày bằng cơ chế hết hạn của MongoDB, không phải dọn tay.
Event có ID đã chống trùng như phần hướng dẫn bên trên; thao tác Gateway và event
legacy không có ID chưa được chống trùng.
Các đường dẫn nhạy cảm (đăng nhập, đổi mật khẩu) **không** được ghi.

**Master data.** Bảng `allcodes` **không** được chuyển sang MongoDB: cột `code` của
nó đang bị khóa ngoại từ `posts` và `detailposts` tham chiếu tới, bê đi là backend cũ
gãy lập tức. Thay vào đó service này giữ một lớp phủ bên trên — từ đồng nghĩa và
nhóm danh mục. Ví dụ gõ "IT", "công nghệ thông tin" hay "lập trình" đều ra cùng một
nhóm việc; `allcodes` không có chỗ cho thứ đó.

## Những phần chưa làm

Đủ 6 microservice trong bản thiết kế + AI Worker. Còn lại:

- Tách frontend thành 3 app riêng
- Prometheus / Grafana / Loki (project tham khảo có sẵn cấu hình để lấy về)
- Nối bảng từ đồng nghĩa vào Search Service (`GET /internal/alias-map` đã sẵn sàng,
  chỉ còn thiếu bên đọc)

So với TopCV, còn thiếu: hẹn lịch phỏng vấn, xuất CV ra PDF theo mẫu, gửi email
hàng loạt cho ứng viên, đánh giá công ty có kiểm chứng, và bản đồ lương theo ngành.

So với TopCV, còn thiếu: hẹn lịch phỏng vấn, xuất CV ra PDF theo mẫu, gửi email
hàng loạt cho ứng viên, đánh giá công ty có kiểm chứng, và bản đồ lương theo ngành.
