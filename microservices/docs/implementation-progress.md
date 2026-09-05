# Tiến độ bổ sung theo báo cáo PDF

Nguồn đối chiếu: “Báo cáo đánh giá chuyên sâu kiến trúc Microservices của dự án JobFind”, đặc biệt roadmap trang 33–35 và checklist trang 50–53. Đây là nhật ký phạm vi triển khai để tiếp tục công việc, không phải chứng nhận đạt production. Môi trường người dùng chọn: máy hiện tại với Docker Compose.

## Các phần đã triển khai và có kiểm thử

- Job Core và Application: transactional outbox cho các luồng đã tách; publish có confirm; thất bại lưu marker không làm mất event.
- Notification: inbox/delivery ledger, dedup event, retry có giới hạn, cách ly kết quả SMTP không chắc chắn.
- Consumer: retry/DLQ qua publisher có xác nhận, phục hồi đăng ký khi mất kết nối; không đổi queue đang có sang loại khác tại chỗ.
- Admin audit: chỉ mục unique và dedup. Search: đọc lại nguồn, CAS/tombstone, đối chiếu nhiều trang thay vì giới hạn 10.000 bản ghi.
- AI Worker: durable task/result ledger, chống gọi lặp. Job Core: inbox kết quả, hàng rào chống kết quả cũ, task/outbox cùng transaction và HTTP idempotency key theo người dùng.
- Đợt 05-09-2026: chính sách JWT HS256/issuer/audience/exp/iat/tuổi token đồng bộ backend–Gateway–Socket; chặn `/status` với người không phải ADMIN; giới hạn body tại Gateway/Job Core; fail-closed rate limit cho login/AI; chuẩn hóa correlation ID và che các trường log nhạy cảm.
- Đợt 05-09-2026: `/healthz`–`/readyz`, probe có thời hạn và không dồn truy vấn khi dependency treo, graceful shutdown, consumer drain giữ ACK trước khi đóng kênh, chờ relay/tác vụ nền.
- Đợt 05-09-2026: metric HTTP/runtime/readiness/outbox/AI, Prometheus local và alert rules; image không bind-mount, lockfile/npm ci, user không phải root, giới hạn tài nguyên; workflow CI và bài kiểm thử image cách ly.
- Đợt hợp đồng HTTP 05-09-2026: 48 thao tác nghiệp vụ (42 public/6 nội bộ) dùng chung nguồn OpenAPI 3.1.1 và validator Ajv; kiểm tra body/query/params, CV lồng nhau, phân trang, khoảng ngày và Idempotency-Key sau phân quyền. Gateway không cho method/URL không khai báo của namespace mới rơi xuống legacy. Các service dùng lỗi JSON an toàn, xử lý được controller async bị reject; audit name không còn nhận regex tùy ý. Xem `http-contracts.md` về các thay đổi tương thích trước khi chuyển container.
- Đợt hợp đồng HTTP: test toàn bộ route bằng HTTP thực, 16 trường hợp serialize từ helper frontend, đối chiếu phản hồi của một số controller, kiểm tra tài liệu/route không lệch trong CI và schema AI không ghi dữ liệu thừa trên MySQL tạm. Image đã bao gồm các JSON OpenAPI và kiểm thử được trong môi trường không mạng ngoài.
- Đợt hợp đồng event 05-09-2026: 13 loại sự kiện có schema payload v1 và catalog producer/consumer; kiểm tra trước outbox/publish và trước xử lý message có đánh dấu version. Dữ liệu sai vào DLQ có confirm, giữ bản gốc/ID; message cũ không đánh dấu và kết quả AI đã lưu giữ đường tương thích. Kết quả AI mới sai cấu trúc được lưu thành thất bại, không tự gọi lại mô hình. Xem `event-contracts.md` về pending outbox cũ và thứ tự nâng cấp.
- Đợt hợp đồng event: kiểm thử handler thực của sáu nhóm consumer với dependency mô phỏng; tích hợp RabbitMQ riêng kiểm tra 13 loại event, retry/DLQ/version/backlog; CI và image đối chiếu tài liệu sinh. Bổ sung lockfile backend vào mã nguồn và cập nhật bản vá `qs`, không thay đổi API nghiệp vụ.
- Đợt đồng bộ 2a ngày 05-09-2026: Job Core trừ hạn mức tin thường/nổi bật cùng transaction với tin/outbox/kiểm duyệt; backend legacy đăng mới/đăng lại giữ khóa người dùng/công ty và rollback khi lỗi ghi. Kiểm tra công ty hợp lệ và InnoDB trước khi ghi. 19 nhóm tích hợp trên MySQL tạm đã qua, gồm cạnh tranh đa người dùng, ghi xen kẽ cũ/mới và lỗi giữa transaction; CI đã bổ sung bài test. Chưa có HTTP idempotency cho đăng tin hoặc outbox cho writer legacy. Xem `client-sync.md`.

## Chưa hoàn tất — thứ tự tiếp tục

Đồng bộ client theo yêu cầu tiếp theo: đợt 1 đã bổ sung xử lý phiên/lỗi xuyên backend–Gateway–frontend và polling AI có hủy/timeout/backoff, giữ key khi gửi không chắc chắn; đợt 2a đã đồng bộ hạn mức đăng tin giữa các writer. CI bổ sung test/build frontend và tích hợp hạn mức. Chưa chuyển API đăng tin hoặc tạo màn hình AI/CV; còn nghiệp vụ cập nhật/ngày hết hạn/đăng lại/idempotency trước khi chuyển UI. Xem `client-sync.md` về cách áp dụng, giới hạn và thứ tự tiếp tục.

1. **Phần hợp đồng còn lại:** HTTP của 5 service và 13 event hiện tại đã có schema/validator cùng kiểm thử consumer. Còn các route monolith/Socket.IO, kiểm tra pending dữ liệu thật trước rollout và quản lý nhiều phiên bản service triển khai độc lập (chưa có Pact broker/cổng can-deploy). Chưa nghiệm thu mọi trang frontend hoặc mọi dữ liệu lịch sử. Kiểm tra kiểu/độ dài `fileBase64` không thay thế kiểm tra nội dung PDF an toàn.
2. **Tracing và phần giám sát còn lại:** lưu bền trace/correlation/causation trong Job Core outbox; OTel xuyên HTTP–outbox–RabbitMQ; metric publish/consume/DLQ, độ trễ Search, notification delivery và breaker; Grafana dashboard, Alertmanager/routing cảnh báo.
3. **Migration và lưu giữ dữ liệu:** tách DDL khỏi startup, version/lock migration, bộ test nâng cấp từ schema cũ; volume RabbitMQ có chiến lược phục hồi; backup/restore drill trên bản sao, retention inbox/outbox/AI/PII. Chưa thay đổi dữ liệu/schema/volume thật để đánh dấu những mục này hoàn tất.
4. **Database-per-service và quyền truy cập:** Gateway còn đọc MySQL legacy; Application còn đối chiếu legacy; Notification còn dùng MySQL chung; Admin còn đọc DB nghiệp vụ. Cần kế hoạch chuyển quyền sở hữu dữ liệu/projection và DB user riêng/read-only, không chỉ sửa sơ đồ hoặc xóa fallback.
5. **Các publisher legacy/direct còn lại:** Identity, luồng đồng bộ và một số sự kiện legacy chưa có transactional outbox đầy đủ. Gateway audit HTTP còn best-effort. Không thể khẳng định “mọi event đều không mất” từ các luồng đã kiểm thử.
6. **CV file và bảo mật triển khai:** chuyển dữ liệu file lớn khỏi RabbitMQ sang kho file với quyền/TTL, kiểm tra định dạng và nội dung file; secret không fallback ở môi trường có dữ liệu thật, tài khoản DB/broker riêng tối thiểu quyền. Đăng nhập chưa có refresh/revocation/JWKS; chưa có TLS/mTLS hạ tầng, registry signing/SBOM/container OS scan hoàn chỉnh.
7. **Nghiệm thu toàn hệ thống:** E2E các vai trò trên stack mới, kiểm thử dependency restart/drain dưới tải, p95/p99, kế hoạch capacity, RPO/RTO phục hồi đo được, service owner và SLO/error budget được người vận hành chấp thuận. Unit/integration pass không tương đương đạt những mục này.

## Không áp dụng cho mục tiêu local hiện tại

- Kubernetes/Helm, HPA/PDB, autoscaling/canary multi-node và cloud secret manager không phải điều kiện chạy Docker Compose trên một máy. Nếu sau này đưa lên Internet/đa máy phải đánh giá lại, không coi là đã triển khai.
- TLS tên miền công khai chưa cấu hình vì chưa có yêu cầu đưa ra Internet. Loopback port không thay thế TLS/auth cho triển khai mạng công cộng.
- Kafka, gRPC, service mesh không được thêm chỉ để đánh dấu checklist; báo cáo cũng yêu cầu chọn theo nhu cầu thực tế.

## Trạng thái môi trường thật

Bản mới chưa được áp dụng vào các container đang chạy. Chưa chạy migration, không gọi Claude/SMTP thật, không push Git hoặc deploy GitHub. Các test tích hợp dùng DB/broker riêng và tự dọn đúng container do test tạo. Xem `local-compose.md` để chuyển cấu hình theo từng bước, gồm yêu cầu sao lưu và đăng nhập lại.
