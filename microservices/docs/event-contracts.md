# Hợp đồng sự kiện RabbitMQ — payload v1

## Phạm vi

15 loại sự kiện hiện khai báo trong `shared/events.js` đã có JSON Schema 2020-12: nhóm job/company, bốn yêu cầu AI và kết quả AI, ba sự kiện application, intent thông báo manual 2g và follower sau duyệt Core 2n. `contracts/events/catalog.v1.json` liệt kê producer, queue nhận, trường định danh đối tượng và giới hạn byte của từng loại. Danh sách producer mô tả mã nguồn hiện tại, **không phải** cơ chế xác thực hoặc phân quyền RabbitMQ.

Nguồn chỉnh sửa là `shared/contracts/eventCatalog.js` và `shared/contracts/eventValidator.cjs`. Các file `contracts/events/*.payload.v1.schema.json`, catalog và bản sao validator/catalog trong `backend/src/contracts` được sinh tự động. Backend chạy độc lập, không cần import trực tiếp workspace microservices. Không sửa các bản sao bằng tay.

## Dữ liệu trên đường truyền

Body vẫn là JSON nghiệp vụ cũ, không bọc thêm lớp `data`. AMQP properties mang `messageId`, `type`, `appId`, timestamp; headers mang `x-event-version: 1`, `x-payload-version: 1`, `x-aggregate-id`, `x-occurred-at`. Correlation ID có thì giữ nguyên.

Hai version có ý nghĩa riêng: event version mô tả envelope/metadata; payload version mô tả dữ liệu nghiệp vụ. Payload có đánh dấu v1 bắt buộc đi kèm envelope hợp lệ, routing key khớp type và aggregate ID khớp đối tượng trong payload. Không tạo ID mới khi nhận lại thông điệp.

Schema chỉ bắt buộc các trường cốt lõi, kiểm tra kiểu của những trường đã biết và cho phép trường bổ sung để producer/consumer nâng cấp lệch thời điểm. Không tự ép kiểu, cắt dữ liệu, thêm mặc định hoặc xóa trường. ID số phải thuộc miền số nguyên an toàn của JavaScript; chuỗi ID dùng custom format `jobfind-id` bên cạnh pattern. Công cụ JSON Schema ngoài dự án có thể không hiểu custom format này; kiểm chứng đầy đủ bằng validator của dự án.

Ví dụ: trạng thái ứng tuyển phải dùng enum của Application; quyết định accepted/rejected phải khớp trạng thái đích; kết quả kiểm duyệt boolean phải khớp PS1/PS2. `ai.result` phân biệt bốn loại nhiệm vụ và kết quả thành công/thất bại, không cho cùng lúc có result và error; điểm matching là số nguyên 0–100. Các trường định danh được worker truyền tiếp cũng được kiểm tra ở đầu vào.

Giới hạn tính theo JSON đã serialize thành UTF-8: yêu cầu AI 8 MiB, kết quả AI 1 MiB, intent thông báo manual/Core approval 16 KiB, các nhóm còn lại 64 MiB để còn tương thích snapshot/logo legacy. Một số trường có giới hạn nhỏ hơn. Đây là trần validator, **không phải** cam kết broker/DB/client chấp nhận message lớn đến mức đó; giới hạn thực tế còn phụ thuộc cấu hình từng tầng. Chưa chuyển file/logo lớn sang object storage và chưa xác minh nội dung PDF an toàn.

## Điểm kiểm tra và xử lý lỗi

Từ 2n, `job.created` và `ai.moderate_job` có trường tùy chọn `notificationPolicy` (nếu có chỉ nhận `approval-v1`); writer Core mới lưu marker, không sửa backlog. Notification bỏ qua creation có marker. AI result handler lấy policy từ request outbox gốc (không từ AI result), chỉ khi áp dụng PS1 mới lưu từng `notification.job_approved_requested` cùng transaction. Event mới có decisionId UUID, jobId/recipientId, jobTitle/companyName nullable tối đa 255 ký tự; không có reason/note/email trong payload writer. Producer Core, consumer Notification và Admin audit. Notification bắt buộc eventId, dùng inbox/delivery hiện có, follower in-app only. Request outbox mất/hỏng thì rollback; không tự đoán policy cũ/mới. Catalog/schema đã sinh lại cả backend độc lập. Cập nhật tất cả Notification/binding và Admin trước Core writer/result-handler/relay; giữ row request làm bằng chứng khi còn có thể áp dụng kết quả. Xem `client-sync.md` 2n về rollout/rollback và giới hạn backlog/manual eligibility. Các mốc dưới mô tả lịch sử từng đợt.

Từ **2p**, writer manual chỉ thêm audience follower khi tin có ngày mili giây chuẩn còn hạn và công ty S1/CS1 theo dữ liệu đã khóa; Core dùng cùng chuẩn ngày, không ép chuỗi khoảng trắng/ký hiệu mũ/thập phân. Các cờ/ngày này chỉ là ngữ cảnh nội bộ, **không thay payload v1, catalog 15 event hoặc binding**. Tác giả/quyết định vẫn được lưu; lỗi truy vấn follower cần thiết hoặc ghi intent phải rollback. Consumer tiếp tục xử lý snapshot đã lưu, kể cả backlog manual trước 2p không chứa ngày/trạng thái công ty, không lọc lại theo hiện tại. Không purge/đổi ID/gửi bù khi công ty phục hồi hoặc khi no-op. Xem `client-sync.md` 2p về thời điểm snapshot và cập nhật toàn bộ backend/Core result-handler.

Từ 2h, **`job.updated` của quyết định kiểm duyệt manual** cũng được validate/INSERT cùng transaction. Không thêm event hay đổi payload v1; backend tạo snapshot theo allowlist từ post/detail/owner/company đã khóa. Outbox lưu discriminator `aggregateType=legacy-job`; relay Job Core giữ producer `legacy-backend` cho đúng `job.updated` này, giữ ID/thời điểm qua retry; row Core cũ không đổi nguồn. Search nhận event chỉ để đọc lại nguồn hiện tại, không áp dụng snapshot cũ. Ba controller manual bỏ emit trực tiếp; các đường sửa/tạo/đăng lại legacy khác chưa đổi. Cập nhật relay trước writer, giữ cả Search/Notification/Admin consumer phù hợp; xem `client-sync.md` 2h.

Từ 2i, **sửa tin legacy `/api/update-post`** cũng dùng helper/marker/relay 2h, INSERT một `job.updated` cùng snapshot mới/PS3/hủy request AI; controller không emit sau commit. Payload và revision lấy chi tiết vừa đọc lại trong transaction cùng các dòng post/owner/company đã khóa. No-op/conflict không tạo event; lỗi ghi/contract rollback toàn bộ. Không thêm event, không phát AI/notification mới cho bản sửa, không rewrite pending. Frontend/response giữ tương thích; tạo/đăng lại legacy và publisher khác chưa chuyển. Xem `client-sync.md` 2i về điều kiện rollout và đồng bộ Search bất đồng bộ.

Ngoại lệ legacy bền từ 2g: `notification.manual_moderation_requested` được validate/INSERT vào outbox trong transaction kiểm duyệt và relay Job Core gửi với producer `legacy-backend`, giữ UUID/thời điểm. Mỗi recipient/audience một event; `decisionId` chung, aggregate là jobId. Follower chỉ approve/note null; author đủ bốn action/note bắt buộc; tên/note tối đa 255 ký tự, tổng 16 KiB. Consumer đường này luôn cần eventId, không fallback direct email. Consumer/binding mới phải sẵn sàng trước writer; xem `client-sync.md` 2g. Các emit legacy khác mô tả dưới đây chưa được chuyển.

- Từ 2j, tạo tin mới legacy `/api/create-new-post` INSERT một `job.created` cùng quota/post/detail; snapshot đọc lại trong transaction, controller bỏ emit sau commit. Relay 2j giữ producer legacy cho `job.created` + `legacy-job` (relay 2h/2i chưa đủ); ID/payload đã lưu không đổi khi retry. Notification bỏ qua creation có producer legacy nhưng snapshot chưa PS1, để intent duyệt 2g thông báo follower; vẫn giữ policy Core/backlog không có producer/legacy PS1. Thay đổi consumer cũng ảnh hưởng message tạo từ đăng lại legacy còn direct; **writer đăng lại chưa có outbox**. Giữ thứ tự Notification → toàn bộ relay 2j → backend/frontend; xem `client-sync.md` 2j.
- Từ 2k, **đăng lại `/api/create-reup-post` legacy** cũng INSERT `job.created` theo ID post mới cùng quota/copy trong transaction, bỏ direct emit. Snapshot nguồn/company dưới khóa, post vừa tạo được đọc lại; giữ marker/producer/relay 2j và contract v1, không phát AI. Search không dùng ID nguồn để ghi bản đăng lại; Notification vẫn chờ intent duyệt đối với PS3 legacy. Không rewrite payload/backlog, không thêm schema/event; HTTP revision bảo vệ nguồn nhưng không phải idempotency. Xem `client-sync.md` 2k.
- Job Core/Application kiểm tra trước khi ghi outbox trên connection của transaction; dữ liệu sai ném lỗi để transaction có thể rollback. Relay kiểm tra lại trước khi mở kết nối/publish có confirm.
- Các hàm emit trực tiếp của backend legacy kiểm tra trước khi publish, bổ sung ID cho từng lần tạo message. Ngoài intent manual 2g, cập nhật tin manual 2h, sửa tin 2i, tạo mới 2j và đăng lại 2k nêu trên, các đường này vẫn best-effort, chưa transactional outbox/confirm; gọi lại hàm emit là một event mới, không phải retry giữ nguyên ID. Không suy ra bảo đảm không mất/trùng cho mọi publisher legacy từ việc có schema.
- Consumer kiểm tra message có đánh dấu trước bộ xử lý nghiệp vụ. JSON sai, schema sai, version không hỗ trợ hoặc sai định danh được chuyển sang DLQ qua publisher có confirm, không tự thử lại nghiệp vụ. ACK bản gốc chỉ sau khi chuyển thành công; nếu chưa confirm, giữ khả năng broker giao lại bản gốc. Retry của lỗi nghiệp vụ tạm thời vẫn giữ byte, ID, routing key gốc và version.
- Lỗi JSON/schema dùng thông báo cố định, không đính kèm nội dung CV/email hay chi tiết giá trị lỗi vào log/header lỗi. DLQ vẫn chứa **toàn bộ bản gốc**, gồm dữ liệu cá nhân: phải hạn chế quyền đọc và có chính sách lưu giữ riêng.
- Với yêu cầu AI có đánh dấu v1, kết quả mô hình sai cấu trúc trở thành một kết quả thất bại được lưu bền. Gửi lại kết quả đã lưu không gọi mô hình lần nữa. Không thay đổi chính sách cách ly tác vụ đã bắt đầu nhưng chưa biết kết quả.

## Nâng cấp và tương thích dữ liệu cũ

1. Sao lưu, kiểm tra image và kiểm tra dữ liệu pending trên bản sao trước khi thay ứng dụng thật. Không sửa queue arguments, purge queue, xóa inbox/ledger hoặc đánh dấu event đã publish bằng tay.
2. Cập nhật consumer trước producer. Một số service kiêm cả hai vai trò: ưu tiên các consumer đầu cuối, sau đó worker/Job Core/Application và cuối cùng backend phát sự kiện. Consumer cũ vốn bỏ qua header mới và vẫn đọc body cũ, nhưng chưa có lớp kiểm tra v1. Bảo đảm toàn bộ consumer đã nâng cấp trước khi nghiệm thu khả năng chặn dữ liệu sai.
3. Message cũ **không có** `x-payload-version` tiếp tục đường tương thích cũ, kể cả envelope v1 cũ hoặc message không ID. Không tự gán version/ID cho backlog, không tuyên bố message thiếu ID đã có dedup.
4. Outbox hiện chưa có cột payload version. Relay dùng **v1 cố định** cho các row pending, gồm row được tạo trước đợt này. Row không hợp lệ được giữ pending với lỗi và lịch gửi lại, không bị xóa hoặc bỏ qua. Trong Application, nó còn chặn các event sau của cùng aggregate để giữ thứ tự. Cần đối chiếu dữ liệu lỗi có kiểm soát; không tự nới schema hoặc sửa payload với cùng event ID đã từng được xử lý. Đợt này chưa đọc/di chuyển pending row trên DB thật.
5. Kết quả AI cũ đã lưu và tác vụ cũ không đánh dấu giữ đường tương thích không payload version. Ngoại lệ publisher `payloadVersion: null` chỉ dành cho `ai-worker`/`ai.result`; không được dùng để bỏ qua validator cho producer khác. Không viết lại kết quả cũ, đổi ID hay gọi AI trả phí để tạo bản mới chỉ nhằm hợp schema.
6. Trước khi có payload v2, phải lưu version cùng outbox/task, thêm consumer hiểu cả phiên bản cũ và mới, và kiểm tra backlog. **Không đổi default của relay từ 1 sang 2**: việc đó sẽ âm thầm đổi version dữ liệu cũ. Thêm trường tùy chọn mới phải có kiểm thử consumer tương thích; thêm trường bắt buộc, đổi kiểu/enum hoặc thu hẹp giới hạn cần phiên bản mới và kế hoạch chuyển đổi.

## Kiểm chứng

Chạy tại thư mục `microservices`:

```powershell
npm run contracts:generate
npm run contracts:check
npm test
npm run test:event-contracts:integration
npm run test:ai-requests:integration
docker build -t jobfind-microservices:local .
npm run test:image
```

Bài tích hợp event cần image `rabbitmq:4-management-alpine` có sẵn; nếu thiếu, tải image đó trước khi chạy. Script tạo broker riêng với cổng loopback ngẫu nhiên, không đọc `.env`, không chạm queue thật. Nó kiểm tra cả 15 loại qua publish có confirm, marker creation/intent approval giao đảo thứ tự và lặp, schema/version sai vào DLQ, backlog cũ, targeted retry và replay AI cũ; chỉ xóa container cùng dữ liệu tạm do chính nó tạo sau khi kiểm tra nhãn sở hữu.

Test consumer dùng bộ xử lý thật của Search, Notification, Application, Admin, AI Worker và AI Result, với DB/SMTP/AI được mô phỏng. Chúng kiểm tra dữ liệu và ID vào đúng nhánh nghiệp vụ; không thay thế E2E mọi vai trò hoặc mọi dữ liệu lịch sử. CI kiểm tra bản sinh không lệch, unit/consumer contracts, broker cách ly và các contract đóng gói trong image. Chưa có Pact broker hay cổng triển khai đối chiếu từng phiên bản service độc lập.

Đợt này không khởi động lại container ứng dụng thật, không chạy migration, gọi AI/SMTP, push hoặc deploy GitHub. Xem `implementation-progress.md` về các yêu cầu PDF còn lại và `local-compose.md` về điều kiện chuyển image.
