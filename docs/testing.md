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
npm run check          # thêm lint, build, npm audit và kiểm tra bản vá vendor
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

`npm audit --audit-level=high` đạt cả ba phần từ lượt 09/10/2026 (xem mục dependency bên dưới). `braces` được vá tại chỗ vì GHSA-vfj7-8cjw-p6xm chưa có bản sửa chính thức; npm audit không kiểm tra được bản prerelease đó nên `npm run check` và CI chạy thêm `node scripts/check-vendored-deps.mjs`. Còn 45 cảnh báo moderate ở frontend (`postcss-selector-parser` 6.x qua công cụ build CRA, `sprintf-js` chưa có bản vá) và 19 ở backend (`sprintf-js`), dưới ngưỡng `high`. Không dùng `npm audit fix --force`: lệnh này hạ `nodemon`/`react-scripts`/`http-proxy-middleware` xuống bản cũ.

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

Phạm vi coverage backend chủ yếu là controllers/services/middleware/utils/config/server/routes; không bao gồm toàn bộ models/seeders/migrations hoặc mã chạy bên trong worker `.cjs`. Frontend còn các nhánh ít được phủ ở App, AddJobType, ChatShareTools và SecuritySettings. Lượt này chưa chạy lại mutation, workflow GitHub hay nhà cung cấp AI/email/SSO/thanh toán thật, và không đổi lockfile/dependency; ba việc audit, mutation và nhà cung cấp thật được hoàn thiện ở mục kế tiếp.

Các log root lưu trong `.local/qa-*.log` (Git bỏ qua); báo cáo coverage nằm trong từng package.

## Hoàn thiện 09/10/2026: dependency, mutation và nhà cung cấp thật

### Dependency

`npm audit --audit-level=high` không còn cảnh báo high/critical ở cả ba phần (trước đó: backend 3 high + 1 critical, frontend 49 high + 2 critical, microservices 4 high + 1 critical).

- `npm audit fix` không `--force`: `proxy-addr` 2.0.8 (critical, giả mạo IP qua IPv4-mapped IPv6), `compression` 1.8.2, `shell-quote` 1.12.0, `source-map-js` 1.2.2, `postcss-selector-parser` 7.1.6. Backend nhận thêm bản vá Jest 30.5.2 và `typed-rest-client` 2.3.0 (bản 2.3.1 ghim cứng `qs` 6.15.1 có lỗ hổng; gói này chỉ dùng cho Stryker).
- `braces`: vá tại chỗ, chi tiết và cách gỡ trong [vendor/README.md](../vendor/README.md). Image gateway build từ `microservices/Dockerfile` chạy `braces` 3.0.4-jobfind.1 và `proxy-addr` 2.0.8.
- Backend bỏ `nodemon`; `npm --prefix backend run dev` dùng `node --watch --require @babel/register` (đã kiểm tra tự khởi động lại khi sửa file).
- Còn lại mức moderate: frontend 45 (`postcss-selector-parser` 6.x qua CRA/Tailwind, `sprintf-js` chưa có bản vá), backend 19 (`sprintf-js`).

### Nhà cung cấp thật

Chạy trên máy phát triển với `npm start` (giao diện `localhost:3000`, API Gateway `localhost:4000`). Khoảng 14 lượt gọi Claude trả phí, gồm 2 lượt chẩn đoán và 1 lượt đánh giá chạy lại sau khi sửa lỗi chatbot.

| Nhà cung cấp | Lệnh | Kết quả |
| --- | --- | --- |
| Claude (AI Worker) | `node microservices/scripts/test-ai-live.mjs --live --only=parse_resume,match_relevant,cover_letter_vi,moderation_scam` | 4/4 qua RabbitMQ, MongoDB, MySQL tạm: CV có cấu trúc (10,4 s), CV phù hợp được 92 điểm (5,9 s), thư tiếng Việt 275 từ (10,8 s), tin lừa đảo bị từ chối mức `nguy_hiem` (4,2 s); gửi lại không gọi model lần nữa. |
| Claude (chatbot) | `SUPPORT_EVAL_CASES=faq,jobs,injection node microservices/scripts/evaluate-support-chat.mjs` | 3/3 kiểm tra tự động qua Gateway; chữ đầu tiên sau 4,1–10,4 s. Câu trả lời đã đọc: đúng đường dẫn `/candidate/info`, `/candidate/ai-cv`, `/job`, `/candidate/cv-post`; tìm việc có gọi `search_jobs` và báo không có tin thay vì bịa; từ chối lộ khóa API/hồ sơ người khác. |
| Gmail SMTP | `test-offer-live.mjs --prepare/--browser/--cleanup --automatic` với `OFFER_LIVE_EMPLOYER`, `OFFER_LIVE_CANDIDATE` | Giao diện thật → API → outbox PostgreSQL → RabbitMQ → worker gửi 1 email (`sent`, 1 lần thử); Gmail INBOX nhận đúng Message-ID sau khoảng 20 s (IMAP chỉ đọc `EXAMINE`, lọc theo Message-ID). Hồ sơ tổng hợp đã dọn. |
| PayPal sandbox | đăng nhập nhà tuyển dụng demo → `GET /api/get-payment-link` → `POST /api/payment-success` | Tạo giao dịch 0,50 USD (2,4 s), link `www.sandbox.paypal.com`; xác nhận khi người mua chưa duyệt bị PayPal từ chối, API trả `errCode -1`, intent vẫn `PENDING` và không cộng gói. Bước người mua duyệt cần tài khoản buyer sandbox nên chưa chạy. |
| Auth0 SSO | `npm run vps:check-sso -- http://localhost:4000` | Google, GitHub, Facebook đều đi JobFind → Auth0 (`connection` đúng) → trang đăng nhập của nhà cung cấp; script dừng trước callback. Đăng nhập bằng tài khoản thật cần người dùng tự thao tác. |

Hai lỗi lộ ra khi chạy thật và đã sửa:

- Chatbot stream dấu xuống dòng trước dòng `[[GOI_Y]]` nhưng lưu câu trả lời đã `trim()`, nên nội dung người dùng thấy khác nội dung lưu (đánh giá live báo `storedTextMatchesStream` lúc đạt lúc không). `support-chat-service/src/providers.js` giữ khoảng trắng cuối đến khi có chữ tiếp theo; test mới thất bại trên mã cũ.
- `test-offer-live.mjs` giả định giao diện và `/api` cùng origin và tự ký JWT không có phiên; Gateway hiện từ chối token đó (`AUTH_ALLOW_LEGACY_TOKENS=false`). Script dùng hai origin và đăng nhập thật bằng tài khoản demo truyền qua biến môi trường, vẫn giữ quy tắc chỉ dùng ứng viên có email demo.
