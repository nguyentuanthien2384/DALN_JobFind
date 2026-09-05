# Hợp đồng HTTP v1 — JobFind local

## Phạm vi đã gắn vào ứng dụng

50 thao tác HTTP nghiệp vụ của Job Core, Identity/CV, Search, Application/Talent Pool và Admin đã đăng ký qua `contractRoute`. Trong đó 44 thao tác được Gateway mở cho client, 6 thao tác chỉ dành cho giao tiếp nội bộ. Đợt 2c thêm route đăng lại, 2d thêm đọc tin trong phạm vi quản lý; giữ tên URL và hình dạng phản hồi thành công của các route đã có.

- `contracts/http/gateway.openapi.json`: OpenAPI 3.1.1 cho client, URL local `http://localhost:4000`.
- `contracts/http/{jobs,identity,search,applications,admin}.openapi.json`: đường dẫn trực tiếp từng service trong mạng Compose, bao gồm API nội bộ; không công bố các cổng này ra Internet.
- `shared/contracts/operations.js`, `schemas.js`, `responses.js`: nguồn định nghĩa dùng để gắn route, kiểm tra đầu vào và sinh tài liệu. Không sửa trực tiếp JSON đã sinh.
- `shared/requestContract.js`: kiểm tra lúc khởi động, xác thực dữ liệu trước bộ xử lý nghiệp vụ, chuyển lỗi async về middleware an toàn của Express 4.

Có thể import JSON vào công cụ đọc OpenAPI chạy trên máy. Không cần tải tài liệu hoặc dữ liệu CV thật lên một website bên ngoài. Chưa mở Swagger UI trên Gateway.

## Quy tắc client cần tuân thủ

1. Các API có body chỉ nhận `application/json`. `Content-Type` sai trả 415; JSON hỏng trả 400; body vượt ngân sách HTTP trả 413. JSON thường tối đa 1 MiB; parse-resume 12 MiB ở HTTP, lớp lưu yêu cầu AI vẫn giới hạn 8 MiB theo byte sau serialize.
2. Trường không khai báo, kiểu dữ liệu sai, object/array thay chuỗi, ID sai và giá trị ngoài giới hạn trả 400. Validator không tự chuyển kiểu, xóa trường, thêm mặc định hoặc cắt dữ liệu. Gửi đúng các trường cần sửa; không gửi nguyên bản ghi đọc từ DB kèm `_id`, `createdAt`, `roleCode`, `companyId`.
3. Query phân trang là chuỗi số nguyên không âm, không nhận số âm, số thập phân, ký hiệu mũ hoặc tham số lặp. Dùng `limit`/`offset`, không dùng `page`. `limit=0` giữ nghĩa dùng mặc định của controller: Search 12, related 6, Application 20, Audit 50. Giới hạn lần lượt 100, 20, 100, 200. Search yêu cầu `offset + limit hiệu lực <= 10000`.
4. `fromDate`/`toDate` nhận ngày ISO hoặc timestamp có múi giờ, ngày có thật và `fromDate <= toDate` khi có cả hai. Dashboard hiện gửi ngày `YYYY-MM-DD`. Không thay đổi cách controller hiểu khoảng thời gian: ngày kết thúc không tự được đổi thành cuối ngày.
5. Stage nhận mã từ `/api/applications/stages`, không gửi tên tự đặt như `interview`. Rating nhận số nguyên 1–5 hoặc chuỗi tương ứng. `amount` và `jobId` trong body vẫn nhận số nguyên hoặc chuỗi số theo schema, không nhận boolean.
6. CV lồng nhau kiểm tra skills/languages/experiences/educations và giới hạn số phần tử/độ dài. Import nhận `{parsed, fileName}` theo kết quả Resume Parser, experiences dùng `duration`; CV chỉnh tay dùng `from`/`to`.
7. `Idempotency-Key` của ba API AI không bắt buộc để giữ tương thích. Client nên tạo một key cho một ý định gửi, dùng lại khi mất phản hồi; cùng key nhưng đổi nội dung trả 409. 202 chỉ có nghĩa task/outbox đã lưu, không có nghĩa AI xử lý xong. Poll `/api/ai/tasks/{taskId}`.
8. Gateway không cho method/đường dẫn chưa khai báo trong namespace mới rơi xuống backend legacy. API legacy ngoài các namespace này và Socket.IO vẫn giữ đường đi cũ. HEAD theo route GET; preflight CORS vẫn do Gateway xử lý.
9. Job Core đăng mới `POST /api/jobs` hỗ trợ key tùy chọn; đăng lại `POST /api/jobs/:id/repost` bắt buộc key và chỉ nhận `{timeEnd}`. Cùng người dùng/key/ý định trả lại 201 với snapshot ban đầu; đổi thao tác/nguồn/nội dung trả 409. Replay kiểm tra quyền công ty hiện tại và không trừ lượt. Client chuẩn bị/giữ key cùng payload trước khi gửi, không tự fallback legacy hoặc dùng mã mới sau timeout. Key không có TTL; backup/retention phải giữ chống gửi trùng.
10. Ngày hết hạn mới phải trong tương lai (đăng mới bỏ trống mặc định 30 ngày); replay đã chấp nhận không tính lại ngày. Đăng lại chỉ nhận nguồn hết hạn/chưa gỡ trong công ty hiện tại, giữ loại tin nguồn, tạo snapshot riêng và tin mới PS3 với kiểm duyệt mới. ADMIN cũng cần công ty hoạt động/đã duyệt và đủ lượt. Chưa chuyển màn hình AddPost/Đăng lại; writer legacy không có bảo đảm idempotency này. Xem `client-sync.md` đợt 2c.
11. `GET /api/jobs/:id/manage` là đọc riêng tư cho vai trò quản lý: các trạng thái PS1–PS4, mã phân loại gốc, không nhãn Allcode/AI nội bộ. COMPANY/EMPLOYER chỉ đọc đúng công ty hoạt động/đã duyệt hiện tại; ADMIN được xem ngoài công ty. Ngoài phạm vi hoặc không tồn tại cùng trả 404, không kèm data. Quyền công ty và tin đọc trong một SELECT; `Cache-Control: private, no-store`. Route public không thay đổi; PS3 không đồng nghĩa AI đang chạy. Xem schema `ManagedJob` và đợt 2d trong `client-sync.md`.

Tên audit `name` là tìm kiếm chuỗi literal không phân biệt hoa/thường, không phải biểu thức chính quy do client điều khiển.

Đợt đồng bộ 2b bổ sung `genderPostCode` và `timeEnd` tùy chọn cho `JobUpdate`. `timeEnd` chỉ dùng để gửi lại giá trị đang lưu (số mili giây/chuỗi số theo schema); thay đổi ngày trả 409 và phải dùng Đăng lại, không gia hạn qua sửa tin. Trường không gửi giữ nguyên, nullable gửi null được xóa giá trị, `descriptionMarkdown: ""` là chuỗi rỗng. `isHot`/`userId`/`statusCode` không được gửi. Sửa không đổi dữ liệu không tạo event/AI; thay đổi tên/HTML phải duyệt lại. Xem `client-sync.md` về snapshot riêng, current read, giới hạn form/kiểm duyệt legacy và kiểm thử `npm run test:job-writes:integration`.

## Phân quyền và lỗi

Client dùng JWT Bearer qua Gateway. Gateway xác thực tài khoản hiện tại, xóa header danh tính do client giả mạo rồi đặt lại. Service yêu cầu `x-internal-secret`; route có quyền tiếp tục kiểm tra vai trò và công ty đang hoạt động/đã duyệt trước schema validation. Kiểm tra quyền sở hữu bản ghi trong controller vẫn giữ nguyên. Body parser có thể từ chối dữ liệu hỏng/quá lớn trước lớp quyền; schema validation không thay thế xác thực.

OpenAPI nội bộ ghi các header danh tính để mô tả giao tiếp giữa các service, không phải hướng dẫn cho frontend gửi các header đó. Không đưa secret thật vào tài liệu/example.

Phản hồi lỗi giữ envelope `errCode`/`errMessage`; ưu tiên đọc HTTP status, vì mã nghiệp vụ cũ còn 1/2/3/-1. Các lỗi transport mới dùng 400/413/415; lỗi không xử lý được trả thông báo chung, không trả SQL/stack/nội dung CV. Gateway vẫn đổi lỗi downstream 5xx thành 502 theo circuit breaker hiện có. Một số báo cáo còn trả dữ liệu phần Application bằng 0/rỗng khi PostgreSQL lỗi; `/internal/sync` có thể trả HTTP 200 với `errCode=-1`. Tài liệu không coi những phản hồi đó là dữ liệu đầy đủ.

## Sinh và kiểm chứng

Chạy trong `microservices`:

```powershell
npm run contracts:generate
npm run contracts:check
npm test
npm run test:ai-requests:integration
npm run test:image
```

`contracts:check` và test CI phát hiện tài liệu lệch nguồn, tham chiếu schema hỏng, thiếu/trùng route và API nội bộ xuất hiện trong danh sách public. Test HTTP thực kiểm tra toàn bộ 50 route với dữ liệu mẫu hợp lệ, các đầu vào xấu và thứ tự kiểm tra quyền. 20 trường hợp còn gọi chính helper frontend, serialize URL/body/header rồi gửi vào bộ kiểm tra HTTP, thêm round-trip builder form create/edit. Một số test controller đối chiếu phản hồi JSON thực tế với schema. Test tích hợp dùng MySQL/RabbitMQ tạm chứng minh đầu vào AI không hợp lệ không tạo key/task/outbox, và không làm hỏng idempotency khi gửi đồng thời. Bộ `test:job-writes:integration` có đăng lại/create có key, rollback, mất socket sau commit và đọc quản lý đúng quyền/trạng thái; không dùng dữ liệu dự án thật.

Validator phản hồi chỉ dùng trong kiểm thử, không sửa/chặn phản hồi sau khi DB đã commit (tránh khiến client gửi lại một lệnh đã thành công). Response schema cho phép trường bổ sung trong quá trình chuyển đổi legacy; đây chưa phải contract test E2E cho mọi dữ liệu lịch sử và mọi trang frontend.

`jobfind-id` là chuỗi số nguyên dương nằm trong miền số nguyên an toàn của JavaScript; `jobfind-uint-N` là chuỗi số nguyên không âm tối đa N. Đây là custom format của Ajv trên server, không phải format chuẩn mà mọi công cụ OpenAPI đều tự kiểm tra. Pattern/length vẫn được công bố trong JSON; phải chạy kiểm thử trên server để xác nhận đầy đủ các điều kiện liên trường và giới hạn số.

Tài liệu tham khảo: [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html), [Ajv — dữ liệu không bị tự thay đổi](https://ajv.js.org/guide/modifying-data.html).

## Phiên bản và phần chưa bao phủ

Đây là bản hợp đồng đầu tiên, `info.version=1.0.0`; giữ URL `/api/...` để không phá frontend. Việc siết dữ liệu từng bị bỏ qua là thay đổi hành vi cần thử trước khi chuyển container thật. Từ bản này: thêm response field tùy chọn là thay đổi tương thích; thêm trường bắt buộc, đổi kiểu/enum hoặc thu hẹp đầu vào cần phiên bản lớn, kế hoạch client/rollout và test hồi quy. Không chỉ tăng số version rồi âm thầm thay yêu cầu của client.

- `/health`, `/healthz`, `/readyz`, `/metrics`, `/status`, `/` là API vận hành: xem `local-compose.md`. Socket.IO và toàn bộ route monolith legacy chưa được mô tả bằng OpenAPI trong đợt này.
- Envelope event v1 giữ body cũ; đợt tiếp theo đã bổ sung schema cho 13 event và header payload version riêng, cùng kiểm thử consumer. Xem `event-contracts.md`; message backlog không đánh dấu không tự bị ép theo schema mới. Pending outbox cần kiểm tra riêng trước rollout.
- `fileBase64` hiện chỉ được kiểm tra kiểu/độ dài, chưa kiểm tra file có thực sự là PDF an toàn. Object storage, quét nội dung, TTL/quyền download và bỏ base64 khỏi queue chưa triển khai.
- Không gọi AI trả phí, gửi SMTP, sửa schema/dữ liệu thật hoặc tự khởi động lại stack đang phục vụ người dùng trong đợt này.
