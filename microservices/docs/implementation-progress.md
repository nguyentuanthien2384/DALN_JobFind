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

## Chưa hoàn tất — thứ tự tiếp tục

1. **Hợp đồng API/event đầy đủ:** mới có schema envelope v1, chưa có OpenAPI toàn bộ route và JSON Schema cho mọi payload nghiệp vụ. Cần bổ sung validator và contract test khớp frontend/legacy trước khi siết trường đầu vào. Việc có body limit chưa thay thế schema validation hay kiểm tra nội dung PDF.
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
