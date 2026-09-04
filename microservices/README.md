# AI Job Portal — Hệ thống Microservices

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
| `microservices/` | **6 ứng dụng độc lập**, mỗi cái có `package.json`, `node_modules` và CSDL riêng. | **6 tiến trình** Node trong **6 container** Docker |

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
            │  jobportal.events    │     không mở cổng HTTP
            └──────────────────────┘
```

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
   - Search Service nghe `job.created` → dựng index Elasticsearch
   - AI Worker nghe `ai.moderate_job` → gọi Claude kiểm duyệt nội dung
5. AI Worker phát `ai.result` → Job Core đổi trạng thái sang `PS1` (hiển thị) hoặc `PS2` (bị chặn)
6. Search Service nghe `job.moderated` → cập nhật trạng thái trong index

Tin bị chặn biến khỏi kết quả tìm kiếm mà không ai phải gọi ai trực tiếp.

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
có thể được phát lại. Hai outbox đã dùng envelope v1 và Notification đã chống trùng
cho sự kiện có ID. Chống trùng ở các consumer khác, publisher confirms cho các
luồng publish trực tiếp còn lại và reliable DLQ vẫn là các bước kế tiếp; chưa có
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
giữ khi đưa vào DLQ, nhưng xác nhận giao tin sang DLQ vẫn chưa được nâng cấp.

Với sự kiện có ID, Notification thực hiện một transaction MySQL:

1. Khóa inbox theo `(eventId, recipientId)`; đã xử lý thì bỏ qua.
2. Ghi một thông báo vào bảng `notifications` và các yêu cầu email/realtime vào
   `notification_deliveries`, cùng connection với inbox.
3. Commit rồi mới trả thành công cho consumer xác nhận RabbitMQ.

Khóa chính inbox và khóa duy nhất `(eventId, recipientId, channel)` ngăn tạo trùng
khi nhận lại cùng event. Lỗi lưu làm rollback cả transaction và chuyển sự kiện
theo đường lỗi/DLQ hiện có; **chưa có tự động retry/replay DLQ**. Người dùng bấm gửi
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
với ID mới chỉ để bỏ qua chống trùng. Nếu replay DLQ, giữ body, ID và metadata,
phát về routing key gốc (header `x-original-routing-key`), không dùng tên queue
DLQ làm routing key.

Kiểm thử phần này không gọi SMTP thật:

```powershell
npm test -- tests/event-envelope.test.js tests/notification-delivery-store.test.js tests/notification-delivery-worker.test.js tests/notification-consumer.test.js tests/shared.test.js
```

Các bài kiểm tra transaction/đồng thời dùng database test double; vẫn cần kiểm
thử tích hợp MySQL/RabbitMQ thật trước khi triển khai. Sự kiện publish trực tiếp
không có ID, AI/Search/Admin và các luồng khác chưa được chống trùng trong phần này.

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
