# Đối chiếu triển khai và quay lui từng tính năng — 2ac

**Cập nhật 2af, 12-09-2026:** [Bộ triển khai/quay lui cố định](release-preparation.md) đã được tạo từ commit `bc9cb1c`: 4 image ứng dụng, 5 image hạ tầng nguồn, hai frontend cùng source với cờ dự kiến/quay lui và cấu hình mặc định `legacy/false`. Đã nạp lại archive, qua 11 nhóm kiểm tra image/Compose/browser, đổi bundle giữ pending/key và kiểm tra API/Socket thật trên môi trường riêng. Quay lui web độc lập không cần secret/provider; source không đổi, tài nguyên thử đã dọn. Hoàn tất bước chuẩn bị artifact; runtime/kích hoạt vẫn HOLD cho tới khi nghiệm thu binding provider, schema/quyền, recovery point và thứ tự chuyển writer. Bước tiếp theo là đưa runtime mới lên với cờ tắt theo các điều kiện này, không bật đồng loạt bundle dự kiến.

**Cập nhật 2ae, 11-09-2026:** [Sao lưu/khôi phục trên bản sao](backup-restore-rehearsal.md) đã qua với MariaDB, PostgreSQL, MongoDB và RabbitMQ. Đã giữ bản backup có checksum, thử SIGKILL, mất toàn bộ volume thử và redelivery/ACK; đúng node/volume nguồn được ghi nhận. Hoàn tất diễn tập phục hồi local; chưa offsite và chưa chứng nhận recovery point đồng bộ của hệ thống thật. Bước tiếp theo là chốt artifact triển khai/quay lui cùng cấu hình provider. Các điều kiện triển khai và cờ vẫn HOLD.

**Cập nhật 2ad, 11-09-2026:** [Diễn tập Worker/Admin trên bản sao MongoDB](worker-admin-rehearsal.md) đã qua: Worker thiếu cấu hình không nhận việc; Admin giữ 1.142 audit và chỉ mục cũ; hai dịch vụ ready, restart/replay không gọi AI lặp. Source hiện đang dừng và được giữ nguyên. Bước xử lý hai điểm chặn đã hoàn tất ở mức mã nguồn/bản sao; runtime thật vẫn HOLD cho tới khi cấp/kiểm chứng provider, sao lưu/khôi phục và chốt artifact. Các phát hiện dưới đây là ảnh chụp lịch sử 2ac, không phải trạng thái dịch vụ hiện tại.

Ngày 09-09-2026, đối chiếu checkout `1a0747c` (2ab) và project đang có `ai-job-portal` bằng các thao tác chỉ đọc. **Kết luận: HOLD cả tám cờ**. Kết quả nghiệm thu Compose cách ly không chứng minh stack đang phục vụ đã dùng cùng bản mã, schema, secret hay dữ liệu. Chưa bật cờ, restart/recreate container, sửa `.env`, chạy migration hoặc gọi AI/SMTP.

## Kết quả đối chiếu trên máy hiện tại

- Sáu dịch vụ Gateway, Identity, Core, Search, Application và Notification trả `/readyz` 200. AI Worker và Admin đang dừng với exit code 1; hai queue tương ứng không có consumer. Tại thời điểm đọc, 12 queue có tổng ready/unacked bằng 0, outbox MySQL chưa publish bằng 0. Đây là ảnh chụp tức thời, không phải bằng chứng drain lâu dài.
- AI Worker đang chạy cấu hình container cũ: thiếu `AI_MONGO_URL` và `ANTHROPIC_API_KEY`. Log phân loại lỗi thiếu URL kho tác vụ; collection `ai_worker_db.task_executions` chưa có. Compose trong checkout đã khai báo URL kho tác vụ, nhưng sửa file không thay cấu hình container đã tạo. Chưa kết luận cấu hình provider trả phí đã được lựa chọn.
- Admin có xung đột tùy chọn chỉ mục. `auditlogs.createdAt_1` hiện là chỉ mục thường, không có `expireAfterSeconds`; mã nguồn muốn TTL 180 ngày. `audit_event_id_unique` đã tồn tại. Chưa sửa/drop chỉ mục hoặc xóa log. Cần đối chiếu collation và dữ liệu trên bản sao; nếu áp dụng TTL, phải đánh giá các bản ghi cũ sẽ hết hạn trước khi thực hiện.
- 13 bảng MySQL được liệt kê trong preflight đều InnoDB; unique CV đúng hai cột đầy đủ `userId/postId`; PK và độ dài/collation của hai bảng request key đạt các kiểm tra. PostgreSQL có các cột tiến trình/snapshot được kiểm tra và unique `legacy_cv_id`. Đây là kiểm tra cấu trúc một phần; chưa chứng nhận toàn bộ kiểu/cột/chỉ mục/quyền ghi/dữ liệu lịch sử. Kết nối Core đang dùng tài khoản root.
- JWT trong `backend/.env` khớp chính sách và secret của Gateway hiện tại; secret nội bộ của bảy HTTP service khớp và khác JWT. Worker dùng RabbitMQ, không cần secret HTTP này. Chưa xác nhận backend/Socket đang chạy đã nạp đúng file/cùng phiên bản; không in giá trị hoặc hash secret.
- Tám ứng dụng vẫn dùng source bind mount, user root và filesystem ghi được; chưa áp dụng overlay image bất biến. Image ID của Node nền không phải phiên bản mã ứng dụng. Không thể chỉ chọn một image ID cũ để khôi phục đúng mã đang chạy.
- RabbitMQ dùng volume tự sinh, chưa có bằng chứng khôi phục/recreate giữ đúng volume và node identity. Không tự gắn volume mới hoặc chạy `down -v`. PostgreSQL, MongoDB, MySQL và broker chưa có biên bản restore drill được đối chiếu trong đợt này.
- File frontend trên đĩa cho thấy năm mode ở `legacy`, ba cờ boolean ở `false`. Đây không chứng minh bundle đang phục vụ: biến `REACT_APP_*` được đóng gói lúc build, tab cũ còn giữ bundle cũ. Không đổi biến ở container microservices để bật/tắt giao diện.

Bằng chứng đã lược bỏ dữ liệu cá nhân/secret tại [rollout-readiness-2ac.json](rollout-readiness-2ac.json). Các phát hiện là của thời điểm `observedAt`, cần chạy lại trước từng đợt.

## Chạy lại kiểm tra chỉ đọc

Từ `microservices`, dùng Node 22+ và Docker CLI:

```powershell
npm run local:preflight -- --project ai-job-portal
# Muốn lưu JSON thuần, bỏ wrapper npm:
node scripts/check-rollout.mjs --project ai-job-portal > "$env:TEMP\jobfind-rollout-preflight.json"
```

Collector yêu cầu tên project rõ ràng; dùng label để chọn container, từ chối chọn một service khi có nhiều container. Không import app/server/ORM startup; chỉ driver DB. MySQL/PostgreSQL chạy transaction chỉ đọc, truy vấn có giới hạn thời gian; Mongo chỉ đọc metadata/chỉ mục, Rabbit chỉ đọc số lượng. Các lệnh `docker exec` dùng danh sách đối số, không shell. Không login, POST nghiệp vụ, consume/ack queue, đọc payload event/CV hay khởi động service để làm probe.

JSON có trạng thái `pass`, `blocked`, `unknown`. Exit **2** nghĩa là giữ cờ, kể cả khi mọi probe kỹ thuật qua: collector không tự xác nhận sao lưu, cặp artifact, phiên bản backend, quyền DB hoặc biên bản nghiệm thu của người vận hành. Không có tùy chọn bỏ qua để biến unknown thành pass. Lỗi cú pháp/tham số dùng exit 1. Khi cần lưu bằng chứng, chỉ giữ JSON đã lọc; không lưu `docker inspect` nguyên bản hoặc Compose config chứa secret.

## Thứ tự giải quyết điều kiện còn thiếu

1. **Cố định bản hiện tại và bản dự kiến.** Chốt commit sạch cho mã mới, build image ứng dụng gắn commit/digest và hai frontend từ cùng source: bộ cờ dự kiến, bộ quay lui `legacy/false`. Ghi checksum bundle, source commit, toolchain, tám giá trị cờ, Gateway URL; ghi phiên bản backend/Socket tương thích. Tránh dùng tag `local` có thể thay nội dung làm bằng chứng quay lui. Chưa xác minh nơi đang phục vụ frontend nên chưa tạo hoặc ghi đè artifact ở đó.
2. **Sao lưu và thử phục hồi trên bản sao cách ly.** Ghi thời điểm/công cụ/checksum/kết quả phục hồi bốn kho và broker, đối chiếu số lượng cùng marker/ledger. Giữ tên volume RabbitMQ hiện tại và node identity; lập bước gắn lại chính volume đó hoặc restore đã diễn tập. Chưa được suy ra an toàn recreate từ việc queue đang rỗng.
3. **Diễn tập sửa các khác biệt Mongo/cấu hình trên bản sao.** Xác định kế hoạch TTL của audit, kiểm tra record hết hạn và unique/collation; chứng minh không mất audit ngoài chính sách đã chọn. Cấp kho task ledger và cấu hình worker, dùng provider mô phỏng trong diễn tập. Không khởi động worker thật chỉ để kiểm tra vì nó có thể tiêu thụ backlog và gọi provider.
4. **Đối chiếu schema và quyền bằng đúng user dịch vụ.** Kiểm tra toàn bộ cột, khóa, InnoDB, collation, unique và DML cần dùng; kiểm tra dữ liệu trùng trước migration. Tách tài khoản phù hợp; không dùng test INSERT/UPDATE trên dữ liệu thật hoặc xóa dữ liệu trùng để vượt preflight. Tách những startup DDL còn có thành thay đổi đã biết trong cửa sổ triển khai.
5. **Chuẩn bị phiên bản theo thứ tự phụ thuộc.** Tạm dừng các writer và nhận kết quả cần chuyển, theo dõi drain; cập nhật Application reader/importer hiểu marker `legacy-application` và Notification/Admin consumer/catalog trước. Cập nhật Core relay/result handler hiểu marker/policy, đồng bộ toàn bộ Core/legacy writer; đồng bộ Gateway/backend/Socket JWT trước phục vụ frontend mới. Không trộn writer cũ bỏ qua revision/idempotency với writer mới. Giữ frontend mới ở `legacy/false` trong khi nghiệm thu backend.
6. **Nghiệm thu bản dự kiến rồi từng cờ.** Kiểm tra health mọi dependency của cờ; login các vai trò, dữ liệu lịch sử đại diện và backlog; có biên nhận, đúng quyền công ty, không lộ note, PDF đúng bytes. Có cặp artifact quay lui đã thử giữ pending intention/task/key. Ghi người thực hiện, thời gian và kết quả; chỉ chuyển cờ tiếp theo sau khi cờ trước ổn định và có bằng chứng.

Không dùng lệnh cập nhật tất cả ứng dụng như một thay thế cho các bước trên. Thứ tự có reader/consumer trước writer, còn backend–Gateway–Socket cần cùng policy.

## Bật từng cờ và quay lui

Các cờ độc lập; thứ tự đề xuất dưới ưu tiên đọc trước ghi. “Quay lui” ở đây dùng **mã frontend 2ab hoặc mới hơn đã nghiệm thu**, build lại đúng cờ, giữ các backend/consumer tương thích để xử lý ý định cũ. Không đưa lại frontend cũ không hiểu kho ý định.

### 1. Tìm kiếm

`REACT_APP_JOB_SEARCH_MODE`: `legacy` → `core`. Cần Search/Gateway hỗ trợ bộ lọc lặp, projection đã đối chiếu nguồn hiện tại, Core reader, danh mục và chi tiết legacy. Thử từ khóa, rỗng kết quả, lọc OR/AND, phân trang, tin ẩn/hết hạn và lỗi/tải lại; không chấp nhận “không lỗi” nếu projection thiếu tin.

Quay lui bằng `legacy`; giữ Search/consumer để hội tụ và điều tra. Không rebuild index, purge event hoặc fallback âm thầm trong bundle core. Các cờ ghi giữ nguyên.

### 2. Tiến trình ứng tuyển

`REACT_APP_APPLICATION_PROGRESS_ENABLED`: `false` → `true`. Cần Application reader trả `legacy_cv_id`, Gateway no-store, CV unique/outbox, relay marker, consumer và snapshot đã đối chiếu. Thử đọc/trạng thái tiến trình riêng, hồ sơ lịch sử, chờ đồng bộ, restart và công ty ngoài bị từ chối.

Quay lui bằng `false`; danh sách/tệp đã nộp vẫn đọc legacy. Giữ Application importer mới, outbox/marker và PostgreSQL; không hạ importer không hiểu marker hoặc ghi lại stage/snapshot.

### 3. Không gian quản lý tin

`REACT_APP_JOB_WORKSPACE_MODE`: `legacy` → `core`. Cần private list/manage/review của Core/Gateway, reader bảng note/moderation; COMPANY/EMPLOYER chỉ thấy công ty hiện tại, ADMIN giữ luồng riêng. Thử bộ lọc, xem lý do duyệt, thiếu dữ liệu và đổi quyền.

Quay lui bằng `legacy`; không coi GET hiện tại là receipt để xóa pending create/edit/repost. Chưa bật ba cờ ghi chỉ vì màn hình đọc đã qua.

### 4. AI và CV có cấu trúc

`REACT_APP_CANDIDATE_AI_ENABLED`: `false` → `true`. Cần Identity/Mongo, Core task/request ledger/outbox, worker task store, Rabbit/consumer và provider đã chọn; đầy đủ quyền và trạng thái thực tế. Diễn tập parse/match/thư, CV CRUD, dừng/tiếp tục chờ, refresh chỉ đọc và phản hồi chưa rõ kết quả.

Quay lui bằng `false`; giữ route để xem task/CV và đối chiếu ý định đã gửi. Không xóa task/request key/ledger/storage, không tự replay, không dừng worker đang xử lý chỉ vì menu đã ẩn. AI flag là cờ build, **không phải công tắc ngừng nhận POST trên máy chủ**; tab cũ vẫn có thể gửi. Nếu cần dừng khẩn việc tạo mới, phải có bước chặn writer có chủ đích và drain đã diễn tập, giữ đường đọc/đối chiếu.

### 5. Dùng CV đã chuẩn bị để ứng tuyển

`REACT_APP_PREPARED_CV_APPLICATION_ENABLED`: `false` → `true`. Cần Identity no-store, frontend PDF renderer, legacy writer bền và các điều kiện CV/outbox/Application/relay của 2y. Không bắt buộc AI flag bật nếu ứng viên đã có CV được lưu; progress flag cũng là lựa chọn đọc độc lập.

Thử chọn CV, xem và xác nhận PDF, chỉ gửi một lần, lịch sử trả đúng file, sửa/xóa nguồn không đổi bản nộp. Quay lui bằng `false`; đường chọn tệp/CV online legacy còn hoạt động, bản đã nộp và nút mở/tải PDF giữ nguyên. Không xóa CV nguồn hay file để quay lui.

### 6–8. Tạo, sửa, đăng lại tin

Bật riêng `REACT_APP_JOB_CREATE_MODE`, rồi `REACT_APP_JOB_EDIT_MODE`, rồi `REACT_APP_JOB_REPOST_MODE` từ `legacy` → `core`. Cần toàn bộ writer/revision/receipt/hạn mức/manual/AI policy 2q–2u và consumer tương thích; request ledger đúng PK/collation, khóa nghiệp vụ và outbox cùng transaction. Provider cũng phải sẵn sàng vì các thao tác Core có thể tạo yêu cầu duyệt AI.

- Tạo: kiểm tra một ý định/key → một tin và một lần trừ lượt, mất phản hồi rồi đối chiếu đúng writer.
- Sửa: kiểm tra revision cũ bị từ chối, no-op không tạo event/AI, sửa thật trở về chờ duyệt, phản hồi muộn không ghi đè nháp.
- Đăng lại: chỉ nguồn hết hạn hợp lệ, giữ đúng revision/key/ngày đã gửi, một receipt mới không trừ lượt lần nữa.

Quay lui **chỉ cờ có lỗi** về `legacy`, giữ các cờ đã nghiệm thu khác theo manifest. Ý định Core đã lưu vẫn đối chiếu Core với key/payload/revision cũ; ý định legacy vẫn legacy. Không đổi key/ngày, không tự POST/fallback, không xóa sessionStorage/receipt. Giữ mọi endpoint/ledger/fence/consumer cần cho backlog kể cả sau khi quay lui giao diện.

## Khi phải dừng và cách xác nhận quay lui

Dừng chuyển cờ ngay khi có sai quyền/công ty, lệch bytes PDF/snapshot, trừ lượt hoặc tạo tác vụ lặp, mất ý định sau refresh, thiếu reader hợp lệ hoặc writer khác policy. Theo dõi 5xx >2%/10 phút, outbox cũ >60 giây, AI pending >5 phút như ngưỡng cảnh báo hiện có; đây là tín hiệu điều tra, không phải cho phép chờ khi có lỗi tính toàn vẹn.

Ghi thời điểm lỗi và ID đã che dữ liệu riêng, giữ bundle/image đang gây lỗi để đối chiếu. Phục vụ frontend quay lui đã xác minh checksum/cờ; yêu cầu tải lại phiên giao diện, kiểm tra bundle mới thực sự được phục vụ và tab cũ. Xem được task và hồ sơ đã gửi, đối chiếu pending bằng đúng writer; xác nhận không thêm event/hồ sơ/lượt ngoài dự kiến. Theo dõi backlog hội tụ và quyền qua các vai trò trước kết thúc sự cố.

Không tự quay lui schema, restore DB đè dữ liệu phát sinh sau backup, purge queue, xóa volume/index/ledger hoặc hạ consumer không hiểu marker. Nếu cần quay lui server, chỉ dùng bộ backend/Gateway/worker/reader đã diễn tập với dữ liệu mới; “image trước đó” không đủ điều kiện. Hiện chưa có bộ như vậy được xác nhận cho target.

## Kiểm chứng đợt này

- Bộ preflight chạy chỉ đọc trên target; kết quả giữ cờ, không coi các điều kiện unknown là đạt.
- 1.145 kiểm thử microservices / 60 file qua, gồm 12 ca mới cho preflight: thiếu bằng chứng, unique thừa cột/prefix/nonunique, PK, InnoDB, collation và độc lập cờ.
- 303 kiểm thử frontend / 8 suite về rollback AI, lịch sử, prepared CV, create/edit/repost/workspace và tìm kiếm qua. Đây là kiểm thử hồi quy giao diện, **chưa phải diễn tập phục vụ bundle quay lui trên target**.
- Không chạy lại Compose/browser/PDF của 2ab vì đợt này không đổi mã ứng dụng; giữ biên bản [2ab](compose-browser-acceptance.md). Bước triển khai tiếp theo cụ thể là diễn tập sửa cấu hình worker và xung đột chỉ mục audit trên bản sao, cùng bản sao lưu và artifact cố định, trước thay đổi stack hiện tại.
