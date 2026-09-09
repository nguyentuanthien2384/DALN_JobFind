# Nghiệm thu chuỗi xử lý nền trên Compose cách ly

Đợt **2ab** thêm `npm run test:compose-browser:integration`, bao gồm toàn bộ bài dưới và thao tác trình duyệt với API Compose thật. Riêng chế độ browser có ingress cố định trên cổng loopback ngẫu nhiên; các dịch vụ/DB/provider vẫn ở mạng internal. Xem [compose-browser-acceptance.md](compose-browser-acceptance.md) về cách chạy và kết quả mới nhất. Các điều kiện “không publish cổng” bên dưới áp dụng cho chế độ background thuần.

Đợt 2w tiếp nối browser integration 2v; 2x bổ sung ba tác vụ AI ứng viên, CV và Search đa lựa chọn. **2aa bổ sung đăng nhập legacy thật, ứng tuyển xuyên vai trò, dữ liệu lịch sử và restart: tổng 32 checkpoint qua ngày 09-09-2026**; xem [compose-application-acceptance.md](compose-application-acceptance.md). Chạy tại `microservices`:

```powershell
npm run test:compose-background:integration
```

Runner dựng image production từ checkout hiện tại và tạo một cấu hình Compose JSON tạm. Tám entrypoint thật của Gateway, Core, AI Worker, Search, Notification, Admin, Identity và Application chạy cùng MySQL, MongoDB, PostgreSQL, Redis, RabbitMQ và Elasticsearch riêng. Không dùng hoặc kế thừa `docker-compose.yml`, `compose.local.yml`, `.env` hay volume đang phục vụ người dùng.

## Điều kiện chạy và cách ly

- Docker Engine/Compose hoạt động; đủ RAM để chạy thêm stack thử nghiệm bên cạnh stack hiện tại. Image hạ tầng phải có sẵn: `mysql:8.0`, `mongo:7`, `postgres:16-alpine`, `redis:7-alpine`, `rabbitmq:4-management-alpine`, `docker.elastic.co/elasticsearch/elasticsearch:8.15.0`. Runner dùng `--pull never`; bước build image có thể tải base image/dependency.
- Project ngẫu nhiên `jobfind-accept-xxxxxxxx`, secret tổng hợp riêng, database `acceptance`, mạng Docker `internal: true`, không publish cổng, không `host.docker.internal`, không gắn Docker socket.
- Dữ liệu mẫu được tạo bằng DDL trên MySQL mới. Đây là fixture tối thiểu, không phải bài thử migration từ database hiện có.
- SDK Anthropic thật nhận `ANTHROPIC_BASE_URL=http://mock:4010` và API key giả. Máy chủ giả mô phỏng HTTP response cho kiểm duyệt, parse/match CV và SSE cho thư ứng tuyển; không thay handler, relay hoặc consumer của ứng dụng.
- Notification ghi DB và gửi HTTP realtime tới fixture có kiểm tra internal secret. Không cấu hình SMTP; địa chỉ nhận thuộc miền `.invalid`. Bài này không chứng minh email/Socket.IO thật đã được gửi tới trình duyệt.
- Kết thúc, kể cả assertion lỗi, runner chỉ xóa container/network/volume của project ngẫu nhiên vừa tạo và image thử nghiệm của nó. Không chạy lệnh dọn toàn Docker. Nếu tiến trình bị cưỡng chế tắt/máy mất điện, lấy tên project trong log để kiểm tra tài nguyên còn sót trước khi dọn thủ công.

## Các ràng buộc được kiểm tra

1. Tám dịch vụ sẵn sàng qua `/readyz`.
2. Tạo tin qua Gateway, JWT và identity MySQL thật; PS3 chưa công khai/chưa báo follower trong lúc giữ phản hồi AI. Retry HTTP cùng key giữ ID/quota và số lần gọi AI.
3. Core transaction → outbox relay → RabbitMQ → AI SDK/HTTP giả → ledger MongoDB → result consumer/inbox MySQL → PS1 → Search, Notification, Admin audit.
4. Giao lại sự kiện đã commit không gọi AI hoặc tạo thông báo/audit trùng.
5. Từ chối → PS2, không xuất hiện trong Search và chỉ báo tác giả.
6. AI trả sai schema hoặc HTTP 503 → lưu thất bại, giữ PS3, không tự gọi lại hoặc tự duyệt.
7. Giữ phản hồi generation cũ, sửa metadata để tạo generation mới và từ chối; thả approval cũ không được ghi đè.
8. Realtime HTTP 503 có retry bền vững, phục hồi không nhân đôi bản ghi thông báo.
9. Event sai hợp đồng vào DLQ giữ ID/body gốc, không gọi AI.
10. Dừng Worker/Search/Notification, commit tin qua HTTP, xác nhận backlog rồi khởi động lại và chờ dữ liệu hội tụ.
11. Dừng RabbitMQ, ghi tin qua HTTP và xác nhận hai outbox event chưa phát; khởi động broker rồi chờ relay/consumer tự kết nối lại và hoàn tất đúng một lần.
12. Kiểm tra mạng/cổng/ownership và exit code khi dừng tám dịch vụ.
13. Ba tác vụ ứng viên qua Gateway → Core → worker/SDK → kết quả; replay giữ task ID và số lần gọi, tài khoản nhà tuyển dụng không đọc được task ứng viên.
14. CV Identity tạo/đọc/sửa/xóa qua Gateway và MongoDB thật; Search tham số lặp qua Gateway và Elasticsearch thật cho kết quả đúng OR/AND.

## Giới hạn

Phạm vi nghiệp vụ gồm chuỗi kiểm duyệt tin Core và từ 2x có parse/match/thư ứng viên, CV CRUD, Search nhiều bộ lọc. Từ 2aa, container legacy thử tải router/auth/controller/ORM thật; bài Application dùng login mật khẩu thật, nghiệm thu API Kanban/ứng tuyển và hồ sơ lịch sử. Các phase 2w/2x vẫn ký JWT tổng hợp. Frontend/browser được kiểm tra riêng, chưa chạy nối trực tiếp toàn Compose; PDF ở phase Application là fixture transport, chưa sinh qua màn hình. Không đo chất lượng AI, thanh toán, tải/SLO, backup/restore, migration, mất máy chủ hoặc SMTP/Socket.IO thật. Không bật cờ frontend hay triển khai lên stack `ai-job-portal`.

## Kết quả ngày 08-09-2026

**Mốc mới nhất 2x: PASS 22 checkpoint** trên project `jobfind-accept-813f2977`, gồm toàn bộ các tình huống 2w và 5 checkpoint ứng viên/CV/Search mới. Đã dọn container/volume/network/image thử thuộc project; stack thật giữ nguyên. **1.131 test microservices** qua; kiểm thử frontend/browser/build/CI và điều kiện áp dụng ở [candidate-search-sync.md](candidate-search-sync.md). Các số 2w sau đây là lịch sử.

**PASS: 17 checkpoint nghiệm thu** trên project `jobfind-accept-3341903e`, bao gồm seed/readiness, các tình huống nghiệp vụ và lỗi, hai vòng phục hồi, cách ly và graceful shutdown. Runner kết thúc exit code 0 và đã dọn container, năm volume, network và image thuộc project này. Kiểm tra sau chạy không còn tài nguyên mang project label; stack `ai-job-portal` vẫn giữ các container/image trước đó.

**Hồi quy: 1.125/1.125 microservices test, 59 file, đều qua.** HTTP contracts (52 thao tác) và 15 event giữ nguyên; kiểm tra contract, cú pháp ba script mới, YAML CI và diff whitespace qua. Không chạy lại 784 backend/1.314 frontend/360 nhóm tích hợp cũ trong đợt này vì không đổi mã sản phẩm của chúng; không cộng các số lịch sử vào số test vừa chạy.

Các lần hoàn thiện fixture đã sửa đường dẫn import trong container, đối chiếu thông báo qua inbox/eventId thay vì URL, và chờ riêng delivery worker sau khi RabbitMQ hết backlog. Không cần sửa mã nghiệp vụ production để vượt bài nghiệm thu. Fixture HTTP và runner chỉ bind mount vào container thử, không được COPY vào Dockerfile production. Thêm job CI riêng `compose-background`; cấu hình đã kiểm tra trên máy này, chưa push/chạy workflow trên GitHub.

Mốc này hoàn thành chuỗi nền kiểm duyệt tin trong bước lớn 1. Tiếp theo là bước lớn 2: đồng bộ các màn hình AI/CV và tìm kiếm/API legacy còn thiếu theo từng đợt; vẫn giữ các điều kiện rollout/rollback 2q–2u trước khi bật cờ thật.
