# Kiểm thử JobFind

## Chuẩn bị từ một checkout mới

Node.js tối thiểu 22.12; CI sử dụng Node.js 22. Cài đúng dependency đã khóa trước khi chạy:

```powershell
npm --prefix backend ci --ignore-scripts
npm --prefix frontend ci --ignore-scripts
npm --prefix microservices ci --ignore-scripts
```

Không cần tạo `.env` hay chạy dữ liệu mẫu để chạy các bộ kiểm thử mặc định. Cài cả frontend trước khi chạy Vitest vì các bài hợp đồng sử dụng mã frontend thực tế. Các bài unit/component thay dịch vụ ngoài bằng fixture/mock; một số bài hợp đồng và Socket.IO mở máy chủ loopback cục bộ.

## Các lệnh mặc định

```powershell
npm test               # backend, frontend, microservices, runtime
npm run test:ci        # coverage với ngưỡng bắt buộc, runtime, contracts
npm run check          # thêm lint, build và npm audit
```

`npm run test:unit` chạy riêng ba bộ unit/component/contract. `npm run test:runtime` kiểm tra launcher, máy chủ phát triển, danh mục và tính toàn vẹn bản sao lưu/phát hành. `npm run test:coverage` tạo báo cáo HTML trong `backend/coverage`, `frontend/coverage`, `microservices/coverage`.

Ngưỡng không bị hạ để làm bài kiểm thử đạt:

- Backend: statements/functions/lines ≥ 90%, branches ≥ 85%.
- Frontend: statements/lines ≥ 85%, functions ≥ 80%, branches ≥ 70%.
- Microservices: statements/functions/lines ≥ 80%, branches ≥ 75%.

Mã thoát phải là `0`; test không được tìm thấy hoặc không đạt ngưỡng là thất bại. Runtime mặc định bỏ qua một bài MySQL migration yêu cầu `TEST_CATALOG_MYSQL=1` và cấu hình backend; số bài skipped cần được ghi rõ khi báo cáo kết quả.

## Kiểm thử tích hợp trên hạ tầng riêng

Docker Desktop cần đang chạy. Các lệnh dưới tạo container và dữ liệu dùng riêng cho mỗi lượt, rồi dọn tài nguyên của chính lượt đó. Chúng sử dụng ảnh đã có sẵn (`--pull=never`), nên chuẩn bị ảnh trước:

```powershell
docker pull mysql:8.0
docker pull postgres:16-alpine
docker pull rabbitmq:4-management-alpine
docker pull redis:7-alpine
docker pull mongo:7
docker pull docker.elastic.co/elasticsearch/elasticsearch:8.15.0

npm --prefix microservices run test:job-writes:integration
npm --prefix microservices run test:application-sync:integration
npm --prefix microservices run test:event-contracts:integration
npm --prefix microservices run test:search-projection:integration
```

Các bài này kiểm tra khóa/giao dịch MySQL, hạn mức và thao tác tin, đồng bộ hồ sơ qua outbox/RabbitMQ/PostgreSQL, hợp đồng sự kiện và hội tụ tìm kiếm. Chúng dùng danh tính và dữ liệu giả; xác thực thật qua middleware được kiểm tra ở bộ auth riêng.

Đối với hành trình React và các API thật trên Compose, cài trình duyệt và chạy:

```powershell
npm --prefix microservices exec -- playwright install chromium
npm --prefix microservices run test:compose-browser:integration
```

Compose acceptance dùng AI tổng hợp. Các bộ MySQL/OIDC/browser và Redis/Web Push có cấu hình hạ tầng riêng trong `.github/workflows/authentication.yml` và `.github/workflows/realtime.yml`. Không dùng các lệnh smoke/live thay cho acceptance cô lập: một số lệnh làm việc với hệ thống đang chạy hoặc gọi nhà cung cấp thật.

## Đánh giá chất lượng test

Coverage xác nhận mã được thực thi, không chứng minh mọi lỗi đều bị phát hiện. Với thay đổi nghiệp vụ, bổ sung hành vi thành công, dữ liệu sai, quyền không hợp lệ, ranh giới và lỗi phụ thuộc liên quan. Với xử lý bất đồng bộ, kiểm tra gửi lại, phản hồi đến muộn, hủy tác vụ và tài nguyên được giải phóng. Với giao dịch/sự kiện, kiểm tra rollback, lưu trước khi phát, trùng lặp và phục hồi sau gián đoạn.

Mock DB/HTTP/SDK ở ranh giới; giữ logic nghiệp vụ đang kiểm tra thật. Assertion cần kiểm tra kết quả và tác dụng phụ quan trọng (ví dụ không ghi outbox khi giao dịch thất bại), tránh chỉ kiểm tra một hàm mock đã được gọi.

```powershell
npm --prefix backend run test:mutation
npm --prefix microservices run test:mutation
```

Mutation testing thay đổi các điều kiện trong nhóm mã bảo mật/thanh toán/hạn mức/tuyển dụng để kiểm tra sức phát hiện lỗi; CI yêu cầu điểm tối thiểu 85. Workflow chạy định kỳ và cho phép `workflow_dispatch`. Không suy ra mutation đạt chỉ từ coverage đạt.

CI thu thập kiểm thử của cả ba phần trước bước audit và lưu coverage artifact cả khi kiểm tra ngưỡng thất bại. Kết quả local, kết quả GitHub Actions và xác nhận với AI/email/SSO/thanh toán thật cần được báo cáo riêng. Không có bộ test hữu hạn nào chứng minh dự án hoàn chỉnh 100%; mỗi thay đổi cần giữ các ca hồi quy đã bắt được lỗi và thêm ca cho hành vi mới.

Tại lượt rà soát 09/10/2026, `npm audit --audit-level=high` chưa đạt với dependency hiện tại: backend 25 cảnh báo (3 high, 1 critical), frontend 80 (49 high, 2 critical), microservices 5 (4 high, 1 critical). Đây là số cảnh báo dependency, gồm cả phụ thuộc phát triển, không phải số lỗi do test chứng minh có thể khai thác. Các gợi ý `--force` có thể thay đổi phiên bản lớn hoặc hạ phiên bản công cụ; chưa áp dụng trong lượt hoàn thiện test. Vì vậy coverage/build đạt không đồng nghĩa `npm run check`, CI hay phát hành đã đạt.

## Kết quả rà soát 09/10/2026

Đã chạy lại trên worktree Windows với Node.js 24.21.0; CI vẫn dùng Node.js 22. Không suy ra kết quả CI từ lượt chạy local.

- Backend: 90 bộ, 2.489 ca đạt. Coverage statements 96,83%, branches 90,92%, functions 97,16%, lines 98,21%.
- Frontend: 122 bộ, 2.225 ca đạt. Coverage statements 90,76%, branches 83,96%, functions 89,45%, lines 94,13%.
- Microservices: 75 tệp, 1.818 ca đạt. Coverage statements 95,90%, branches 91,62%, functions 94,24%, lines 97,91%.
- Runtime: 62 ca đạt, 1 MySQL migration tùy chọn bị bỏ qua. HTTP/event contract generation khớp, lint và production build đạt.
- RabbitMQ thật trên container riêng: 8 kiểm tra đạt. Đồng bộ hồ sơ MySQL → outbox → RabbitMQ → PostgreSQL: 10 kiểm tra đạt, gồm outage/recovery, retry và rollback.
- Thao tác tin và hành trình nhà tuyển dụng: 360 kiểm tra đạt (348 MySQL/HTTP, 12 trình duyệt React/Gateway/JWT/Redis/Core/legacy). Không có lỗi JavaScript chưa xử lý hoặc request ra dịch vụ ngoài trong lượt trình duyệt; container/dữ liệu kiểm thử đã được dọn.

Thêm 83 ca hồi quy: 49 backend, 20 frontend, 14 microservices. Các ca mới kiểm tra Redis lifecycle, phân quyền hỗ trợ, worker PDF bị treo/quá tải, PostgreSQL acquisition/BEGIN/COMMIT/ROLLBACK thất bại, invitation outbox, retry consumer, HTTP auth proxy, polling dùng chung, dữ liệu đếm sai, PDF phản hồi muộn/hết phiên và browser page restore. Hai lỗi nghiệp vụ được chứng minh bằng test thất bại trước sửa rồi đạt sau sửa: rollback che lỗi gốc và số lượng backlog quản trị chấp nhận dữ liệu sai.

Cấu hình Jest đã sửa để tìm test trong worktree Windows, unit frontend chặn thêm `fetch`, Redis adapter được đưa vào coverage, lệnh kiểm tra tổng bắt buộc ngưỡng coverage. Harness MySQL chuyển sang deadline 120 giây thay vì số lượt thử có thể hết sau 45 giây; MySQL khởi tạo mới thực tế cần khoảng 73 giây trên máy kiểm tra. Giữ chẩn đoán startup và chỉ dọn container/dữ liệu thuộc lượt kiểm thử.

Phạm vi coverage backend chủ yếu là controllers/services/middleware/utils/config/server/routes; không bao gồm toàn bộ models/seeders/migrations hoặc mã chạy bên trong worker `.cjs`. Frontend còn các nhánh ít được phủ ở App, AddJobType, ChatShareTools và SecuritySettings. Chưa chạy lại mutation toàn bộ, mọi workflow GitHub hoặc các nhà cung cấp AI/email/SSO/thanh toán thật trong lượt này.

Các log root lưu trong `.local/qa-*.log` (Git bỏ qua); báo cáo coverage nằm trong từng package. Thay đổi lockfile/dependency không thuộc lượt này; kết quả audit chưa đạt được giữ nguyên để không che tình trạng phát hành.
