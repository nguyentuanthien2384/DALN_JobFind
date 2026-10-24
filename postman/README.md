# Postman cho JobFind

Thư mục có hai collection:

| Collection | Dùng để |
|---|---|
| `JobFind-API-Tests.postman_collection.json` | Bộ kiểm thử tự động cho toàn dự án: backend cũ và microservices (433 request, có test script). Dùng với `JobFind-API-Tests-Local` (máy của bạn) hoặc `JobFind-API-Tests-Production` (https://thiennt.id.vn) |
| `JobFind-Thao-Tac-Thu-Cong.postman_collection.json` | Tự đăng ký tài khoản, mời phỏng vấn, gửi thư trúng tuyển/từ chối, chuyển giai đoạn bằng dữ liệu của bạn: kiểm tra trước rồi mới làm thật (mục bên dưới) |
| `JobFind-Demo.postman_collection.json` | Bộ request chỉ đọc để demo nhanh (phần cuối file này) |

## Thao tác thủ công: kiểm tra trước rồi mới làm thật

Dùng khi bạn muốn tự tay làm một việc thật (đăng ký tài khoản cho ai đó, hẹn phỏng vấn, gửi thư mời
nhận việc, gửi email từ chối...) mà muốn chắc chắn không sai trước khi email đi tới ứng viên.

Import `JobFind-Thao-Tac-Thu-Cong.postman_collection.json`, chọn cùng environment với bộ test (Local hoặc
Production). **Không bấm Run cả collection**: Send từng bước.

| Thư mục | Việc |
|---|---|
| 1 - Đăng ký tài khoản | Bước 1 kiểm tra, Bước 2 tạo thật, Bước 3 đăng nhập thử |
| 2 - Chọn hồ sơ ứng tuyển | Xem tài khoản nhà tuyển dụng đang dùng, tìm hồ sơ (biến `manualSearch`), đặt mã hồ sơ vào biến `manualApplicationId`, xem lại hồ sơ |
| 3 - Mời phỏng vấn (hẹn lịch) | Bước 1 kiểm tra + xem trước email, Bước 2 gửi thật |
| 4 - Gửi thư mời nhận việc | như trên |
| 5 - Gửi email từ chối | như trên |
| 6 - Chuyển giai đoạn hồ sơ | như trên; Bước 1 cho biết bước mới có gửi email cho ứng viên không |

Cách dùng mỗi việc:

1. Mở **Bước 1 - Kiểm tra trước**, sửa body (họ tên, ngày giờ, địa điểm, lời nhắn...). Ngày gợi ý
   `{{suggestedInterviewDate}}`... tự tính theo giờ Việt Nam; có thể thay bằng ngày cụ thể `YYYY-MM-DD`.
2. Bấm **Send**, mở tab **Visualize** của response:
   - Đạt: thấy hồ sơ nào, ứng viên nào, giai đoạn trước → sau, thông báo trong ứng dụng, **email gửi tới địa chỉ nào**,
     có gửi được không (và lý do nếu không), tiêu đề, Reply-To, và **bản xem trước nội dung email** đúng như ứng viên sẽ nhận.
   - Chưa đạt: lý do cụ thể (ví dụ "Thời gian phỏng vấn phải ở tương lai", "Số điện thoại đã tồn tại"). Sửa rồi Send lại.
3. Đạt rồi thì mở **Bước 2 - Gửi thật**, bấm Send. Bước 2 gửi **đúng body và đúng hồ sơ đã kiểm tra** (lưu trong biến
   `manual...Body`, `manual...AppId`), không đọc lại body bạn đang sửa. Bước 2 tự từ chối gửi (ghi lý do trong **Console**)
   nếu chưa có lần kiểm tra đạt, nếu kiểm tra đã quá 15 phút, hoặc nếu dữ liệu đó đã được gửi một lần.

Nhà tuyển dụng thao tác là tài khoản `recruiterPhone`/`recruiterPassword` trong environment (mặc định: nhà tuyển dụng
công ty B). Đổi sang tài khoản thật của bạn khi làm việc thật; chỉ sửa ở cột **Current value**.

Phía server, chế độ kiểm tra là tham số `?dryRun=true` trên chính các API thật:
`POST /api/create-new-user`, `POST /api/applications/:id/interview-invitation`,
`POST /api/applications/:id/decision-notification`, `PATCH /api/applications/:id/stage`. Server chạy đúng các bước
kiểm tra (dữ liệu, quyền, công ty, trạng thái hồ sơ, trùng số điện thoại/email) nhưng không khoá, không ghi CSDL, không
tạo outbox, không gửi email; bản xem trước email do Notification Service dựng bằng cùng mẫu và cùng quy tắc người nhận
với lúc gửi thật. Kiểm tra đăng ký có hạn mức riêng 30 lần/15 phút, không trừ vào hạn mức đăng ký thật.
Trên production, tính năng này có sau khi bạn deploy bản code mới.

## Bộ kiểm thử API

### Chuẩn bị

1. Chạy hệ thống: XAMPP MySQL (cổng `3333`), Docker Desktop, rồi `npm start` ở thư mục gốc.
2. Mở **Postman Desktop**. Bản web với browser agent không gửi được header `Origin` và
   `Cookie` mà các API đăng nhập/phiên yêu cầu. Cần Postman v11 trở lên hoặc Newman 6.1 trở lên.
3. Import `JobFind-API-Tests-Local.postman_environment.json` và
   `JobFind-API-Tests.postman_collection.json`, chọn environment **JobFind API Tests - Local**.
4. Bấm **Run** trên collection, giữ nguyên thứ tự thư mục 00 → 21.

Chạy bằng dòng lệnh (cùng kết quả):

```powershell
npx newman@6 run postman/JobFind-API-Tests.postman_collection.json -e postman/JobFind-API-Tests-Local.postman_environment.json
```

Mọi request đi qua API Gateway `http://localhost:4000`. Gateway chuyển API mới tới
microservices và API cũ tới backend (cổng 5000). Các service không mở cổng ra máy
host và chỉ nhận request có `x-internal-secret` do Gateway đặt, nên đây cũng là
cách client thật gọi hệ thống.

### Tự tay test từng request

1. Chọn environment ở góc trên bên phải Postman.
2. Lần đầu, chạy thư mục **02 - Đăng ký tài khoản** một lần (chuột phải vào thư mục → **Run folder**)
   để tạo tài khoản Postman `0999990001`; các thư mục đăng nhập/phiên/tương tác dùng tài khoản này.
3. Mở một request bất kỳ, bấm **Send**. Không cần đăng nhập trước: tab **Authorization** ghi request
   dùng token của tài khoản nào (ví dụ `{{adminAccessToken}}`), và collection tự lấy/làm mới token đó
   (xem mục "Access token và refresh token").
4. Xem kết quả ở tab **Test Results** (đạt/không đạt từng kiểm tra) và **Body** (dữ liệu trả về).
   Tab **Pre-request Script** / **Tests** của request cho biết request đang kiểm tra điều gì.
5. Muốn chạy một nhóm chức năng: chuột phải vào thư mục → **Run folder**. Request nào bị bỏ qua
   (do cờ chưa bật hoặc gần chạm giới hạn tần suất) có ghi lý do trong **Console** (góc dưới trái).
6. Có thể sửa body/tham số rồi Send lại để thử trường hợp khác. Một số request phụ thuộc biến do
   request trước lưu lại (ví dụ `cvId`, `applicationId`): khi đó chạy cả thư mục từ đầu.

Lỗi thường gặp: `403 Invalid request origin` khi đăng nhập là do biến `origin` không khớp tên miền
giao diện; `429` là chạm giới hạn tần suất, đợi theo thời gian trong thông báo; `401` ở một request
lẻ thường do tài khoản Postman chưa được tạo (chạy thư mục 02).

### Test trên server production (https://thiennt.id.vn)

Import thêm `JobFind-API-Tests-Production.postman_environment.json` và chọn environment
**JobFind API Tests - Production (thiennt.id.vn)**. Mọi request đi qua Caddy → API Gateway như
người dùng thật. Khác với local:

- Caddy chỉ mở `/api/*` và `/socket.io/*`. Các endpoint vận hành của Gateway (`/healthz`, `/readyz`,
  `/status`, `/metrics`) không có trên Internet: biến `opsEndpoints = false` bỏ qua các test đó và
  chạy 4 test kiểm tra chúng thật sự không lộ ra ngoài (kèm HSTS, X-Frame-Options).
- Dữ liệu trên server được xuất từ máy local, nên tài khoản và mã tin dùng chung. Nếu bạn đã đổi
  mật khẩu admin hoặc tài khoản demo trên server, sửa ở cột **Current value** của environment
  (giá trị này chỉ nằm trên máy bạn), đừng ghi vào file rồi đẩy lên GitHub.
- Chạy cả collection trên production sẽ tạo tài khoản Postman trong CSDL thật và tạo rồi xoá
  ngay vài bản ghi thử (kỹ năng, mã danh mục, tag, đánh giá...), giống như ở local. Muốn chỉ
  xem mà không ghi gì: chạy thư mục **10 - Search Service** (công khai, chỉ đọc).
- Chỉ những gì đã deploy mới được test: sửa code ở máy, commit, push, rồi chạy
  `cd /root/DALN_JobFind/deploy && sh scripts/update.sh` trên VPS trước khi test lại.
- Không nên bật `allowSideEffects` trên production (tạo tin thật, hồ sơ thật, giao dịch PayPal).
  `allowEmails` gửi email thật như ở local; production bỏ qua địa chỉ mẫu như `@example.com`.

### Nội dung

| Thư mục | Chức năng | Kiểm tra chính |
|---|---|---|
| 00 | Khởi động và xác thực | `/healthz`, `/readyz`, đăng nhập 5 tài khoản (lưu access token + refresh token), nội dung JWT, làm mới access token bằng refresh token, `/status` (7 đích định tuyến healthy, không có circuit breaker mở); trên production: các endpoint vận hành không lộ ra Internet, HSTS |
| 01 | API Gateway | 401/403 theo JWT và vai trò, giả mạo `x-user-role`, chặn `/internal`, path traversal, hợp đồng API (400/415), `X-Correlation-Id`, rate limit, CORS, bắt tay Socket.IO (realtime), `/metrics`, đăng nhập thiếu `Origin`/sai mật khẩu |
| 02 | Đăng ký | Kiểm tra số điện thoại, lỗi từng trường, chặn tự đăng ký ADMIN, trùng số điện thoại/email, kiểm tra trước bằng `?dryRun=true` (không tạo tài khoản), đăng nhập bằng số điện thoại và email, quyền của tài khoản mới |
| 03 | Đăng nhập, phiên, mật khẩu | Cookie refresh HttpOnly, xoay vòng refresh token, phát hiện dùng lại token cũ, thu hồi từng phiên, đăng xuất, đăng xuất mọi thiết bị, đổi mật khẩu, quên mật khẩu/OTP sai, SSO (302/303), khoá và mở khoá tài khoản |
| 04 | Người dùng | Sửa hồ sơ, chặn tự nâng quyền và sửa người khác, cài đặt tìm việc và kỹ năng, quyền xem hồ sơ ứng viên của nhà tuyển dụng, danh sách người dùng của admin |
| 05 | Identity (MongoDB) | Hồ sơ mở rộng, tạo/sửa/import/xoá CV |
| 06 | Danh mục | Ngành, tỉnh, kỹ năng; admin thêm/sửa/xoá mã danh mục và kỹ năng |
| 07 | Công ty | Danh sách/chi tiết công khai không lộ dữ liệu riêng, thông tin riêng và nhân sự công ty mình, danh sách admin, phân quyền tạo/sửa/khoá/rời công ty |
| 08 | Tin tuyển dụng (trang web) | Lọc, tìm, tin nổi bật, chi tiết, việc tương tự, gợi ý cho ứng viên, quản lý tin, ghi chú kiểm duyệt, thống kê, phân quyền duyệt/khoá tin |
| 09 | Job Core (MySQL) | Tin công khai, phạm vi theo công ty, `editRevision` và xung đột 409, sửa không đổi nội dung |
| 10 | Search (Elasticsearch) | Từ khoá, gõ sai chính tả, lọc, phân trang, facets, gợi ý, tin liên quan, đối chiếu với Job Core |
| 11 | Ứng tuyển, tìm ứng viên | Nộp CV bị từ chối (thiếu dữ liệu, sai vai trò, tin không tồn tại/hết hạn, nộp trùng), CV kèm % khớp kỹ năng, chi tiết CV, thống kê, lọc ứng viên, mở hồ sơ đã mở (không trừ lượt) |
| 12 | Application (PostgreSQL) | Kanban, phễu, chi tiết hồ sơ, đánh giá sao, kho ứng viên, lịch phỏng vấn, chặn đọc hồ sơ công ty khác |
| 13a | Phỏng vấn và kết quả | Lịch quá khứ, thiếu link/địa điểm, hạn xác nhận sai, sai công ty, ứng viên tự gửi, hồ sơ không tồn tại; kiểm tra trước (`?dryRun=true`) thư mời phỏng vấn, thư mời nhận việc, từ chối, chuyển giai đoạn: có bản xem trước email, hồ sơ không đổi, hồ sơ đã nhận việc vẫn bị chặn 409. **Không gửi email** |
| 13b | Phỏng vấn và kết quả (email thật) | Đặt lại hồ sơ về "mới ứng tuyển" (không gửi email), mời phỏng vấn, lịch phỏng vấn của ứng viên và công ty, thư mời nhận việc, nhận việc, chặn mời lại (409), đang xem xét, từ chối, thông báo trong ứng dụng. **Mặc định bỏ qua** |
| 14 | Gói dịch vụ, thanh toán | Bảng giá, lịch sử mua, doanh thu (admin), thanh toán PayPal bị từ chối (số lượng sai, giao dịch giả mạo) |
| 15 | Tương tác | Lưu/bỏ lưu tin, theo dõi/bỏ theo dõi công ty, gửi/sửa/xoá đánh giá công ty |
| 16 | Thông báo, chat, push | Thông báo, việc làm theo dõi/gợi ý, hội thoại, gửi tin nhắn bị từ chối, đăng ký/huỷ Web Push |
| 17 | Admin & Reporting | 5 loại báo cáo, nhật ký, thao tác ở thư mục 09 đã được ghi vào nhật ký, master data |
| 18 | Support Chat | Kho kiến thức, mã khách, câu trả lời SSE (`state → token → done`), hội thoại, hàng đợi chuyển nhân viên |
| 19 | AI | 19a kiểm tra đầu vào (không gọi AI); 19b tạo tác vụ thật, idempotency, chờ kết quả. **19b mặc định bỏ qua** |
| 20 | Tạo tin thật (CQRS) | Tạo tin, idempotency, sự kiện `job.created`/`job.deleted` qua Outbox → RabbitMQ → Admin, gỡ tin. **Mặc định bỏ qua** |
| 21 | Ghi dữ liệu thật khác | Nộp CV mới và đồng bộ sang Kanban, nhắn tin idempotent, link PayPal sandbox. **Mặc định bỏ qua** |

Notification Service không có API công khai: nó nhận sự kiện RabbitMQ, và có một API nội bộ
`/internal/email-preview` mà Application Service gọi khi `?dryRun=true` (Gateway chặn `/internal` từ bên ngoài).
Thư mục 13a kiểm tra bản xem trước email đó; 13b kiểm tra email thật và thông báo trong ứng dụng.

### Tài khoản và dữ liệu dùng

| Biến | Giá trị mặc định | Dùng cho |
|---|---|---|
| `admin*` | `0795095049` / `123456` | Quản trị |
| `employer*` | `0795095042` / `123456` | Nhà tuyển dụng công ty A (id 12) |
| `employer2*` | `0918800001` / `Demo@123456` | Nhà tuyển dụng công ty B (id 28): truy cập chéo công ty, luồng email |
| `candidate*` | `0764188123` / `123456` | Ứng viên demo (chỉ đọc) |
| `testCandidate*` | `0987650001` / `KiemThu@2026` | Ứng viên kiểm thử có 2 hồ sơ ở tin `testOfferJobId`, `testRejectJobId` |
| `pm*` | `0999990001` / `Postman@2026` | Tài khoản Postman, tạo ở lần chạy đầu. Mọi thao tác phá huỷ (đổi mật khẩu, đăng xuất mọi thiết bị, khoá tài khoản...) chỉ làm trên tài khoản này |
| `testInboxEmail` | (trống) | Hộp thư nhận email thật ở 13b, phải trùng email của `testCandidate` |
| `hrContactEmail` | `postman-hr@thiennt.id.vn` | Email HR (Reply-To) trong thư mời |

### Access token và refresh token

Mỗi tài khoản (`admin`, `employer`, `employer2`, `candidate`, `testCandidate`, `pm`) có hai biến:

| Biến | Lấy từ đâu | Dùng ở đâu |
|---|---|---|
| `<tài khoản>AccessToken` | trường `token` trong body của `POST /api/login` hoặc `POST /api/auth/refresh`. JWT ký HS256, sống 15 phút, gắn với một phiên (`sid`) | tab **Authorization → Bearer Token** của mọi request cần đăng nhập |
| `<tài khoản>RefreshToken` | header `Set-Cookie` của các request trên: cookie HttpOnly `jobfind_rt` (production: `__Host-jobfind_rt`, tên lưu ở biến `refreshCookieName`). API cố ý không trả refresh token trong JSON để mã JavaScript trên trình duyệt không đọc được | header `Cookie` của `POST /api/auth/refresh` |

Thư mục **00** đăng nhập cả 5 tài khoản để điền hai biến này, rồi minh hoạ ba bước: đọc nội dung access token
(header, `sub`, `sid`, `exp - iat = 900`), làm mới access token bằng refresh token (refresh token được xoay vòng:
token cũ mất hiệu lực), và dùng access token mới. Thư mục **03** kiểm tra kỹ phần bảo mật: dùng lại refresh token
cũ bị phát hiện và thu hồi cả phiên, đăng xuất, đăng xuất mọi thiết bị, đổi mật khẩu.

Khi bạn bấm Send ở bất kỳ request nào, script của collection làm giống trình duyệt:

1. Access token của tài khoản đó còn trên 1 phút: dùng luôn.
2. Sắp hết hạn hoặc đang trống: gọi `POST /api/auth/refresh` bằng refresh token, lưu cặp token mới.
3. Refresh token hết hạn (8 giờ), bị thu hồi hoặc trả về sai tài khoản: đăng nhập lại bằng số điện thoại/mật khẩu
   trong environment.

Nếu access token còn hạn nhưng đã bị thu hồi (đăng xuất mọi thiết bị, đổi mật khẩu, khoá tài khoản trên web, server
đổi `JWT_SECRET`), request đó nhận `401`, collection xoá access token và **lần Send kế tiếp** tự lấy token mới.

Mọi request tắt cookie jar của Postman (Settings → *Disable cookie jar*): các tài khoản dùng chung một tên cookie
trên cùng tên miền, nên refresh token được giữ riêng cho từng tài khoản trong biến thay vì trong cookie jar.

### Dữ liệu bị thay đổi khi chạy

Ở chế độ mặc định, bộ test chỉ để lại tài khoản Postman (tạo một lần) và cài đặt tìm
việc của nó (`isFindJob = 0`, `isTakeMail = 0` nên không hiện cho nhà tuyển dụng):

- CV, mã danh mục, kỹ năng, tag master data, hội thoại chatbot, ứng viên trong kho, tin
  đã lưu, công ty theo dõi, đánh giá công ty và thiết bị Web Push được tạo rồi xoá ngay.
- Đánh giá sao của một hồ sơ, hồ sơ cá nhân của tài khoản Postman và `headline` của ứng
  viên demo được đổi rồi khôi phục. Nếu ứng viên chưa có `headline` thì sau khi chạy trường
  này có giá trị `null` (giao diện không dùng trường này).
- Mật khẩu tài khoản Postman được đổi rồi đổi lại; nếu lần chạy trước dừng giữa chừng
  (đang khoá hoặc đang ở mật khẩu tạm), request đăng nhập ở thư mục 02 tự khôi phục.
- Nộp CV, mời phỏng vấn và gửi kết quả chỉ được thử với yêu cầu bị từ chối trước khi ghi.
- Các request ghi (POST/PUT/PATCH/DELETE) vẫn được ghi vào nhật ký hệ thống của Admin.

Một số API có giới hạn tần suất theo IP hoặc theo tài khoản. Các test chạm vào chúng tự ghi
lại số lần gọi và tự bỏ qua khi gần chạm ngưỡng, nên có thể chạy collection nhiều lần liên
tiếp mà không tự khoá mình (khi đó một số test hiện "bỏ qua" trong Console):

| Giới hạn | Ngưỡng của hệ thống | Test tự bỏ qua khi |
|---|---|---|
| Đăng nhập sai | 10 lần / 15 phút / IP | đã sai 5 lần |
| Làm mới phiên thất bại | 10 lần / 15 phút / IP | đã gọi 6 lần |
| Đăng ký | 10 lần / giờ / IP | đã gọi 6 lần |
| Kiểm tra trước khi đăng ký (`?dryRun=true`) | 30 lần / 15 phút / IP, tính riêng | đã gọi 15 lần |
| Xin OTP, đổi mật khẩu bằng OTP | 5 lần / 15 phút / IP (mỗi API) | đã gọi 3 lần |
| AI và chatbot | 30 lần / giờ / tài khoản | còn 5 lượt |

### Bật các phần có tác dụng phụ

| Cờ | Thư mục | Tác dụng phụ |
|---|---|---|
| `allowEmails = true` (và điền `testInboxEmail`) | 13b | Gửi 5 email thật tới `testInboxEmail`; đổi giai đoạn 2 hồ sơ của `testCandidate` (cuối cùng: nhận việc và từ chối, lần chạy sau tự đặt lại); đánh dấu đã đọc thông báo của tài khoản đó |
| `allowAiCalls = true` | 19b | 1 lượt gọi Claude (tốn quota) |
| `allowSideEffects = true` | 20, 21 | Trừ 1 lượt đăng tin của công ty B, gửi yêu cầu AI kiểm duyệt, để lại 1 tin `PS4`; 1 hồ sơ ứng tuyển thật ở tin `testNewApplyJobId` (kèm email báo cho nhà tuyển dụng), 1 tin nhắn cố định, 1 giao dịch PayPal sandbox chờ thanh toán |

Phần 13b chỉ gửi khi email trên cả hai hồ sơ trùng đúng `testInboxEmail`, nên không bao
giờ gửi nhầm cho người khác. Ở môi trường dev, email tới địa chỉ mẫu (`example.com`,
`.test`...) được Notification Service chuyển về hộp thư của dự án.

### Sửa bộ test

Collection được sinh từ `postman/generator/`: mỗi file trong `folders/` là một nhóm thư mục,
`lib.mjs` chứa các đoạn test dùng chung, `fixtures.mjs` chứa CV PDF mẫu và khoá Web Push.
Sau khi sửa, chạy lại:

```powershell
node postman/generator/build.mjs
```

Lệnh này kiểm tra cú pháp mọi script và tên request trùng trước khi ghi đè hai collection
(bộ test API và bộ thao tác thủ công, nguồn ở `folders/manual.mjs`) cùng hai environment.
Nếu bạn sửa trực tiếp trong Postman, hãy export lại collection; lần build sau sẽ ghi đè
các sửa đổi đó.

## Dữ liệu demo Postman

Import lần lượt `JobFind-Demo.postman_environment.json` và
`JobFind-Demo.postman_collection.json`, sau đó chọn environment **JobFind Demo - Local**.

Collection dùng Gateway `http://localhost:4000`. Gateway chuyển API mới tới
microservices và chuyển API cũ tới backend/XAMPP, nên đây là URL phù hợp nhất
để demo kiến trúc đầy đủ.

## Tài khoản dữ liệu gốc

| Vai trò | Số điện thoại | Mật khẩu | ID |
|---|---:|---:|---:|
| Admin | `0795095049` | `123456` | user `1` |
| Nhà tuyển dụng | `0795095042` | `123456` | user `18`, company `12` |
| Ứng viên | `0764188123` | `123456` | user `36` |

## Bản ghi dùng trong Collection

| Dữ liệu | Giá trị |
|---|---|
| Tin React của nhà tuyển dụng | post `22` |
| Tin Developer ứng viên đã nộp | post `46` |
| CV mẫu | `9100` đến `9105` |

Chạy lần lượt ba request trong thư mục **01 - Login and tokens**. Collection
tự lưu JWT vào Environment; các request còn lại chỉ đọc dữ liệu, không làm
thay đổi cơ sở dữ liệu mẫu. Đăng nhập và bắt tay Socket.IO gửi header `Origin`
(biến `origin`); `/status` chỉ dành cho ADMIN nên nằm trong thư mục **05 - Admin data**.

Trước khi demo, bảo đảm XAMPP MySQL (cổng `3333`), backend (cổng `5000`) và
Docker Desktop đang chạy.
