# Đồng bộ backend–frontend–microservices theo từng đợt

## Đợt 1: phiên đăng nhập, lỗi API và chờ AI

Đã cập nhật mã nguồn, chưa thay container ứng dụng đang chạy và chưa triển khai bản dựng frontend để phục vụ người dùng. Không đổi URL nghiệp vụ, schema DB, dữ liệu thật, API đăng tin hoặc gọi AI/SMTP trong đợt này.

### Phiên đăng nhập

- Frontend nhận được cả 401 của Gateway và cờ `refresh: true` trên lỗi 403/404 xác thực của backend cũ. Chỉ xóa phiên khi token **thực sự gửi trong request lỗi** vẫn là token đang lưu; phản hồi đến muộn của lần đăng nhập cũ không được đăng xuất phiên mới. Request đăng nhập thất bại và request không gửi token không làm mất phiên khác.
- Xóa token/dữ liệu phiên, đóng socket và cập nhật quyền trên giao diện trước khi chuyển sang đăng nhập. Nhiều lỗi đồng thời chỉ chuyển một lần. Đang ở trang login thì xóa phiên cũ nhưng không tạo vòng lặp chuyển trang. Một phản hồi `/api/auth/me` đến muộn sau khi xóa/đổi token không ghi lại danh tính cũ.
- Tài khoản bị khóa có `authReason: inactive` và yêu cầu kết thúc phiên. Lỗi thiếu quyền thông thường không xóa phiên; middleware ADMIN legacy đã đổi `refresh` thành false cho trường hợp này. Mất kết nối, DB xác thực lỗi hoặc Redis không hoạt động không bị diễn giải thành hết phiên.
- Trang login có thông báo hết phiên/tài khoản không hoạt động. URL quay lại chỉ được dùng cho cùng origin, không nhận URL ngoài, đường dẫn `//`, ký tự điều khiển hoặc trang login/register/reset-password. Không lưu CV, mật khẩu hay form draft để tự gửi lại sau đăng nhập.
- JWT vẫn có tuổi mặc định 900 giây, backend/Gateway/Socket phải cùng policy và secret. **Chưa bổ sung refresh token**, tự gia hạn hoặc nới thời gian token. Cơ chế mới phản ứng với lỗi API, không phải bộ hẹn giờ kiểm tra token trong mọi tab hay hoàn thiện xác thực lại mọi thao tác Socket.IO.

### Dạng lỗi frontend

Axios vẫn trả lỗi dưới dạng dữ liệu với `errCode`/`errMessage`, giữ tương thích các màn hình đang dùng `res.errCode`. Phản hồi thành công vẫn trả nguyên `response.data`. Thông tin bổ sung trên lỗi gồm:

- `httpStatus`: mã HTTP; 0 nếu không nhận được phản hồi HTTP.
- `errorType`: authentication, forbidden, validation, conflict, not_found, rate_limit, unavailable, network, timeout, cancelled hoặc unknown.
- `retryAfterSeconds`: nếu có header Retry-After hợp lệ, tối đa 86400 giây.
- `requestId`: nếu có X-Correlation-Id hợp lệ, dùng đối chiếu log, không phải danh tính người dùng.

Gateway cho JavaScript phía frontend đọc Retry-After và X-Correlation-Id qua CORS. Các cổng microservice riêng và metrics secret không được đưa vào frontend. Metadata chỉ có khi server thực sự trả; không tự suy diễn mọi mã nghiệp vụ legacy thành HTTP status. Phản hồi HTTP lỗi không được trả `errCode: 0` để giao diện hiểu nhầm thành công. Không trả object lỗi Axios, request body/header, hoặc trang HTML lỗi của proxy cho component.

### AI bất đồng bộ

`parseResumeAi`, `matchCvAi`, `coverLetterAi` vẫn nhận options chứa idempotency key. Đã bổ sung timeout HTTP 15 giây và AbortSignal tùy chọn. Timeout, mất mạng hoặc hủy chờ POST **không chứng minh task chưa được lưu**: giữ key, không tự POST lần nữa. Khi người dùng chủ động thử lại cùng một ý định/nội dung, dùng lại key đó; muốn tạo ý định khác thì tạo key khác.

`waitForAiTask(taskId, options)` nay:

- Chỉ hỏi trạng thái bằng GET, không tạo nhiệm vụ thay thế. Giữ taskId trong lỗi trả về để giao diện có thể tiếp tục hỏi cùng tác vụ.
- Dừng ngay với lỗi xác thực/thiếu quyền/không tìm thấy/dữ liệu sai hoặc trạng thái task failed. Không chờ hai phút rồi báo nhầm thành timeout trong những trường hợp đó.
- Thử lại GET với khoảng chờ tăng dần cho mất mạng, timeout và các lỗi 408/429/500/502/503/504; tôn trọng Retry-After, không gọi sớm nếu thời gian đó vượt hạn chờ tổng.
- Mặc định hỏi mỗi 2 giây, hạn tổng 120 giây; mỗi GET tối đa 15 giây và không vượt thời gian còn lại. Hỗ trợ AbortSignal, dọn timer/listener sau khi kết thúc. Dừng chờ không hủy công việc trên máy chủ và không hoàn tiền/hủy lời gọi AI đã bắt đầu.
- Ném lỗi có mã `AI_POLL_TIMEOUT`, `AI_POLL_CANCELLED`, `AI_POLL_REJECTED`, `AI_RESPONSE_INVALID` hoặc `AI_TASK_FAILED` để giao diện phân biệt từng tình huống.

Đây là nền tảng client; **chưa bổ sung màn hình AI/CV mới** hoặc nút tiếp tục sau khi reload. Component sử dụng cần giữ taskId/key trong trạng thái phù hợp, hủy poll khi unmount, không lưu nội dung CV vào localStorage, và không coi timeout là task failed.

### Kiểm chứng và áp dụng

Chạy `npm run test:unit` và `npm run build` trong frontend; `npm test` trong backend; `npm test`, `npm run contracts:check` và `npm run test:image` trong microservices (sau khi build image). Test frontend mô phỏng trình duyệt/kết nối; test Gateway đối chiếu lỗi thật từ middleware với bộ phân loại frontend. Test image dùng container không mạng ngoài, kiểm tra CORS/correlation trên lỗi 401. Đây chưa phải E2E trên stack chứa dữ liệu thật.

CI đã bao phủ thay đổi trong toàn bộ frontend, cài theo lockfile, chạy unit tests và build frontend bên cạnh backend/microservices. Chưa chạy workflow trên GitHub hoặc push/deploy trong đợt này.

Mốc kiểm chứng 05-09-2026: 677 test frontend, 496 test backend và 793 test microservices đã qua. Frontend build thành công sau khi khai báo global dùng cho Web Crypto và dọn cảnh báo lint ở kiểm tra URL; image Gateway build/test cách ly và kiểm tra tài liệu contract cũng đã qua. Những kết quả này không chứng nhận các mục E2E, tải hay triển khai dữ liệu thật.

Khi triển khai: cập nhật backend trước để lỗi ADMIN thiếu quyền không còn yêu cầu logout, cập nhật Gateway để nhận cờ tài khoản không hoạt động và header CORS, rồi phục vụ bản dựng frontend mới. Giữ cấu hình API/socket trỏ Gateway theo `local-compose.md`. Không dùng thao tác chuyển ứng dụng để recreate DB/broker hoặc xóa volume.

## Đợt 2a: hạn mức đăng tin giữa Job Core và backend cũ

Đã cập nhật mã nguồn và kiểm thử riêng phần hạn mức; **chưa chuyển màn hình đăng tin sang API Job Core, chưa thay container đang chạy**. Không có migration dữ liệu thật hoặc thay đổi gói đã mua trong đợt này.

### Quy tắc và tính nhất quán

- Job Core tạo tin thường trừ một `allowPost`; tin nổi bật trừ một `allowHotPost`. Hai loại không tự dùng bù cho nhau. Trừ lượt, tạo nội dung/tin PS3, lưu `job.created`, yêu cầu kiểm duyệt và outbox AI nằm trong cùng transaction. Lỗi ghi trước commit hoàn tác toàn bộ, không để lại tin mồ côi hoặc mất lượt.
- Backend legacy đăng mới và đăng lại cũng đưa việc trừ lượt/tạo tin vào transaction. Cả hai hệ thống khóa theo thứ tự người dùng → công ty → tin nguồn nếu đăng lại; đọc lại số dư dưới khóa và giữ khóa tới commit. Điều này bảo vệ cả trường hợp nhiều nhân viên cùng công ty đăng đồng thời hoặc dùng xen kẽ API cũ/mới. Luồng cộng quyền lợi thanh toán hiện có cũng khóa dòng công ty; không thay đổi hoặc gọi nhà cung cấp thanh toán trong đợt này.
- Backend tiếp tục nhận `isHot` dạng 0/1, chuỗi `"0"`/`"1"` hoặc boolean. Job Core giữ contract chỉ nhận 0/1 hoặc boolean; không coi chuỗi `"0"` là true. Không có số dư, số dư âm hoặc NULL đều không được đăng; không tự cấp lượt thay thế.
- Kiểm tra lại công ty hiện tại trong DB: phải tồn tại, hoạt động S1 và đã được duyệt CS1. Job Core từ chối nếu công ty trong danh tính Gateway không còn khớp DB. **Tạo tin bằng ADMIN cũng phải có công ty hợp lệ và đủ lượt**, không có đường tạo miễn phí bằng tài khoản không thuộc công ty. Quyền ADMIN sửa/xóa tin không thay đổi trong đợt này.
- Mỗi lần đăng kiểm tra `users`, `companies`, `posts`, `detailposts` dùng InnoDB. Nếu thiếu bảng/engine không hỗ trợ transaction thì dừng trước khi ghi; không tự chuyển engine hay sửa schema. Các bảng AI/outbox của Job Core vẫn được kiểm tra theo cơ chế startup hiện có.
- Đăng lại giữ hành vi tạo ID mới, thu một lượt theo loại của tin nguồn, không sửa tin gốc và vẫn dùng chung `detailPostId` như trước. Chưa đưa API đăng lại vào Job Core. Không thêm chính sách hoàn lượt khi xóa/từ chối tin hoặc đổi loại tin sau khi đăng.

### Phản hồi, giới hạn và áp dụng

Job Core trả 201 khi tạo thành công, 409 khi hết lượt, 403 khi công ty không hợp lệ/thông tin công ty đã đổi, 503 khi engine dữ liệu chưa bảo đảm transaction. Các lỗi này có `errCode: 2` và thông báo tiếng Việt; lỗi SQL bất ngờ trả 500 với thông báo an toàn. Backend giữ dạng phản hồi legacy HTTP 200 và `errCode`/`errMessage`/`postId` để không làm hỏng màn hình hiện tại. Thiếu quyền/hết lượt không yêu cầu đăng xuất.

**Đây chưa phải chống gửi lặp theo ý định:** API đăng mới/đăng lại chưa có Idempotency-Key. Hai POST hợp lệ có thể tạo hai tin và trừ hai lượt nếu còn đủ số dư. Mất phản hồi khi commit không chứng minh tin chưa được tạo; không tự gửi lại POST sau timeout. Key của API AI không tự áp dụng cho API đăng tin.

Publisher legacy vẫn phát sự kiện sau commit theo cơ chế best-effort; lỗi gửi sự kiện legacy không hoàn tác tin đã lưu. Đợt này không bảo đảm outbox/kiểm duyệt tự động cho luồng legacy, không phát thêm sự kiện trùng và không thay cơ chế duyệt cũ. Việc sửa tin dùng chung chi tiết, trường ngày hết hạn/giới tính, kết quả API và trạng thái kiểm duyệt vẫn cần đồng bộ trước khi chuyển giao diện.

Khi áp dụng, cập nhật/restart **backend legacy trước**, rồi mới cập nhật Job Core để không còn writer cũ trừ số dư ngoài transaction. Không đổi endpoint frontend trong bước này. Kiểm tra engine bảng bằng tài khoản vận hành; nếu không phải InnoDB, lập kế hoạch sao lưu/migration riêng. Không recreate DB/broker hoặc xóa volume để áp dụng mã nguồn.

### Kiểm chứng đợt 2a

`npm run test:posting-quota:integration` trong microservices yêu cầu dependency đã cài ở cả backend và microservices, Docker và image `mysql:8.0` có sẵn. Bài test tự tạo MySQL dùng một lần với cổng loopback ngẫu nhiên, chạy HTTP Job Core thật và Sequelize legacy thật. Không đọc secret `.env`, không khởi chạy backend server/lịch gửi mail/relay hoặc gọi AI, SMTP, PayPal. Cuối bài chỉ dọn container có nhãn sở hữu khớp.

19 nhóm kiểm tra đã qua: trừ đúng loại lượt, đăng lại, số dư bất hợp lệ, phân quyền/đổi công ty, công ty bị chặn, lỗi SQL tại từng bước, rollback legacy, 20 yêu cầu đồng thời với 3 lượt, ghi xen kẽ cũ/mới, cộng lượt đồng thời, đổi công ty/khóa công ty khi request đang chờ khóa DB, và từ chối engine MyISAM. CI đã bổ sung bài test này sau khi cài/test backend. Đây không phải benchmark tải, E2E giao diện, kiểm thử PayPal hay triển khai trên dữ liệu thật.

Mốc hồi quy ngày 05-09-2026 của đợt 2a: 823 test microservices (50 file), 516 test backend (30 suite), 677 test frontend (49 suite) đều qua; HTTP/event contracts không lệch. Đã dựng lại image `jobfind-microservices:local` và kiểm thử Gateway trong container không mạng ngoài. Không đổi mã frontend trong đợt 2a; bản build frontend của đợt 1 vẫn giữ nguyên. Không cập nhật container ứng dụng/DB thật, không push Git hoặc chạy workflow GitHub.

## Đợt 2b: sửa tin độc lập và giữ đúng ngày hết hạn

Đã cập nhật backend legacy, Job Core, schema HTTP và lời giải thích trên màn hình sửa tin. **Chưa chuyển URL nghiệp vụ frontend sang Job Core và chưa thay các container đang chạy.**

### Ngày hết hạn và các trường được sửa

- Đối chiếu `AddPost`: giao diện vốn khóa DatePicker khi sửa và chỉ mở chức năng Đăng lại cho tin hết hạn. Vì vậy đợt này **không mở gia hạn miễn phí bằng API sửa tin**. Cả hai writer nhận lại ngày cũ nhưng từ chối đổi ngày, yêu cầu dùng Đăng lại. Job Core nhận `timeEnd` là số mili giây hoặc chuỗi số theo schema; giá trị phải bằng ngày đang lưu, kể cả ngày đó đã hết hạn. Không âm thầm bỏ qua yêu cầu đổi ngày.
- Job Core bổ sung `genderPostCode`; trường không gửi giữ nguyên, trường nullable gửi `null` được xóa giá trị, `descriptionMarkdown: ""` được lưu chuỗi rỗng. `amount` nhận số/chuỗi số hợp lệ và so sánh theo giá trị số. `isHot`, `userId`, `statusCode` vẫn không phải trường chỉnh sửa của API này.
- Frontend giữ khóa ngày hết hạn và có thông báo giải thích việc gia hạn qua Đăng lại. Backend vẫn giữ response legacy, bổ sung `changed` để phân biệt có thay đổi hay không; controller tiếp nhận cả `id`/`postId` và luôn dùng danh tính từ phiên đăng nhập, không từ body.

### Giao dịch, nội dung dùng chung và kiểm duyệt

- Khi chi tiết thực sự thay đổi, cả hai writer tạo một dòng `detailposts` mới rồi đổi liên kết của **chính tin đang sửa** trong transaction. Không sửa tại chỗ dòng cũ, ngay cả khi tạm thời chưa thấy tin nào dùng chung: kiểm tra “chưa chia sẻ” rồi UPDATE vẫn có thể đua với thao tác đăng lại.
- Tin đăng lại khác giữ nguyên nội dung; không chuyển `posts.userId` sang người vừa sửa, không đổi loại tin, ngày đăng/ngày hết hạn hoặc trừ thêm lượt. Dòng chi tiết cũ được giữ lại; **chưa có màn hình lịch sử phiên bản hoặc tác vụ dọn snapshot không còn tham chiếu**. Không tự xóa dữ liệu cũ để giảm số dòng.
- Các writer kiểm tra bảng dùng InnoDB, khóa người sửa/tác giả theo ID tăng dần, rồi công ty, tin và chi tiết. Quyền công ty được kiểm tra lại dưới khóa; tác giả đổi sau lần đọc sơ bộ thì từ chối và yêu cầu tải lại. ADMIN vẫn được sửa tin khác công ty mà không thay tác giả; tin PS4 không được phục hồi chỉ bằng lệnh sửa.
- Job Core so sánh nội dung thực tế: đổi tên hoặc HTML mới tạo request kiểm duyệt mới và đưa tin về PS3; sửa thông tin ngoài hai trường được AI kiểm duyệt không tự thay quyết định/trạng thái đang có. Nội dung mới, tin, `job.updated`, request kiểm duyệt và outbox được commit cùng nhau. Kết quả AI cũ không được áp dụng vào request mới.
- Lưu lại nội dung y hệt không tạo snapshot/event/request AI hoặc đổi timestamp/trạng thái. Job Core đọc kết quả bằng current locking read để phản hồi và payload không dùng snapshot cũ của repeatable-read sau khi chờ một writer khác. Đã tái hiện và sửa lỗi này bằng 20 lệnh sửa đồng thời trên MySQL thật trong fixture.
- Backend legacy giữ chính sách cũ: thay đổi thực sự đưa tin về PS3 để duyệt theo luồng legacy, chưa chuyển sang outbox/kiểm duyệt tự động của Job Core. Lưu y hệt trả `changed: false` và controller không phát event. Publisher legacy khi có thay đổi vẫn best-effort sau commit.

### Giới hạn và kiểm chứng

Đây **không phải HTTP idempotency cho đăng mới/đăng lại**, cũng chưa có ETag/If-Match để phát hiện form cũ: hai nội dung khác nhau sửa cùng một trường vẫn theo lần ghi sau. Cập nhật từng phần từ Job Core giữ các trường không gửi; form legacy gửi đầy đủ vẫn có thể ghi đè trường do người khác đã chỉnh. Còn adapter cho cấu trúc dữ liệu/Allcode của màn hình, API đăng lại ở Job Core và chuyển luồng duyệt trước khi đổi endpoint.

`npm run test:job-writes:integration` (alias cũ `test:posting-quota:integration` vẫn dùng được) chạy **38 nhóm kiểm tra**: 19 nhóm hạn mức của đợt 2a và 19 nhóm sửa tin mới. Bao gồm snapshot dùng chung, nullable/giá trị bỏ trống, ngày hết hạn không đổi, no-op, quyền/đổi công ty/tác giả khi đang chờ khóa, rollback tại các bước ghi, cạnh tranh sửa/đăng lại, trường cập nhật từng phần, kết quả AI cũ và engine không hỗ trợ transaction. Dùng HTTP Job Core/Sequelize/handler kết quả AI thật với dữ liệu tổng hợp, **không gọi mô hình AI, SMTP hay PayPal**. Chỉ container MySQL tạm có nhãn sở hữu khớp bị dọn.

Ngày 05-09-2026: 851 test microservices (51 file), 517 test backend (30 suite), 677 test frontend (49 suite) và 38 nhóm tích hợp đều qua. Frontend production build thành công; HTTP/event contracts khớp nguồn. CI đã được cấu hình chạy bộ tích hợp mở rộng, nhưng **chưa push hoặc thực thi workflow trên GitHub** trong đợt này.

Image `jobfind-microservices:local` đã dựng lại và qua kiểm thử Gateway cách ly, gồm contract mới đóng gói và dừng tiến trình sạch. Các kiểm thử không thay container ứng dụng đang phục vụ hoặc dữ liệu thật; frontend mới được build nhưng chưa được triển khai để phục vụ người dùng.

Khi áp dụng: cập nhật backend trước để không còn writer sửa trực tiếp chi tiết dùng chung, sau đó Job Core và frontend. Không recreate DB/broker, chuyển engine, xóa volume hoặc dọn chi tiết cũ bằng thao tác triển khai này. Sao lưu/kiểm tra dữ liệu lịch sử vẫn là bước riêng trước rollout thật.

## Đợt 2c: đăng lại và chống gửi trùng trong Job Core

Đã bổ sung mã nguồn, hợp đồng HTTP và helper frontend. **Chưa chuyển màn hình đăng tin khỏi API legacy, chưa thay container ứng dụng và chưa chạy DDL trên dữ liệu thật.** Các mốc 2a/2b ở trên là lịch sử; giới hạn idempotency của Job Core đã được cập nhật trong đợt này.

### Nghiệp vụ và chống gửi trùng

- `POST /api/jobs/:id/repost` nhận duy nhất `{timeEnd}` và bắt buộc `Idempotency-Key`. Tin nguồn phải thuộc công ty hiện tại, đã hết hạn và chưa bị gỡ (`PS4`). Cả ADMIN cũng phải thuộc đúng công ty hoạt động/đã duyệt; không dùng quyền ADMIN để đăng lại tin của công ty khác hoặc bỏ qua trả lượt.
- Đăng lại tạo ID mới, sao chép chi tiết hiện tại vào snapshot mới, giữ loại thường/nổi bật của nguồn, trừ một lượt đúng loại, tạo `job.created` và yêu cầu kiểm duyệt mới cùng transaction. Tin mới luôn `PS3`; không sửa tin gốc, không tự hoàn lượt. Tin hết hạn từng bị từ chối cũng phải qua kiểm duyệt mới, không được tự công khai.
- `POST /api/jobs` hỗ trợ key tùy chọn để giữ tương thích client modern cũ. Khi đăng mới/đăng lại, ngày hết hạn mới phải trong tương lai; đăng mới không gửi ngày thì tính 30 ngày khi thực hiện lần đầu. Lặp lại yêu cầu đã được chấp nhận sau khi hết hạn vẫn trả kết quả cũ, không tạo tin mới.
- Bảng InnoDB `job_request_keys` lưu namespace **người dùng + key phân biệt hoa/thường**, loại thao tác, hash ý định, công ty, ID tin và phản hồi ban đầu. Claim key, trừ lượt, tin/chi tiết, outbox, trạng thái duyệt và lưu phản hồi nằm trong cùng transaction. Bất kỳ bước ghi nào lỗi đều rollback. Startup bảo đảm bảng trước khi mở ghi; request có key kiểm tra engine trước mutation.
- Cùng người dùng/key/nội dung trả lại đúng phản hồi 201 ban đầu, kể cả lượt còn lại bằng 0 hoặc mạng ngắt ngay sau commit. Tạo mới và đăng lại dùng chung namespace: đổi loại thao tác, tin nguồn hoặc nội dung/ngày sẽ trả 409. Giá trị số tương đương của form được chuẩn hóa; hash không lấy thời gian hiện tại hoặc nội dung nguồn có thể thay đổi. Key mới là ý định đăng thêm và có thể trừ lượt mới.
- Khi replay, kiểm tra lại quyền công ty hiện tại dưới khóa. Chuyển công ty, công ty bị khóa/chưa duyệt trả 403; mapping hỏng, tin đã xóa cứng hoặc đổi tác giả không được tự tạo lại. Phản hồi replay là **snapshot lúc chấp nhận**, không phải trạng thái duyệt hiện tại; tin đã gỡ không được phục hồi. Đọc hiện trạng là thao tác riêng.
- Lock key trước các khóa người dùng/công ty/tin. Duplicate chờ commit rồi đọc hiện trạng bằng khóa chia sẻ, không nâng khóa key để tránh cạnh tranh giữa các lần gửi lại. Đăng lại khóa người đăng/nguồn theo ID tăng dần rồi công ty/tin/chi tiết, kiểm tra lại dữ liệu sau khi chờ khóa.

### Frontend và phạm vi chưa chuyển

`src/service/jobPostingService.js` cung cấp `createJobRequestOptions`, `createJob` và `repostJob` qua Gateway. Caller phải tạo options **trước khi gửi**, giữ options cùng payload không đổi cho mọi lần thử lại của một thao tác. Helper có timeout 15 giây/AbortSignal, giữ key trên kết quả lỗi/thành công, không tự POST lại và không fallback sang writer legacy. Thiếu key hoặc mã tin nguồn không hợp lệ bị từ chối trước khi gửi mạng.

Chưa nối các helper này vào màn hình AddPost/Đăng lại. Các API legacy đăng mới/đăng lại **vẫn chưa có idempotency và outbox bền**; gửi key vào legacy không nhận bảo đảm mới. Không coi helper đã có là tính năng UI đã hoàn tất. Còn adapter form/Allcode/phản hồi, luồng kiểm duyệt, trạng thái tin của chủ sở hữu và xử lý form cũ trước khi chuyển từng màn hình. Không có ETag/If-Match hoặc tự phục hồi draft sau reload/đăng nhập.

Không có TTL/dọn key tự động: xóa key rồi retry có thể tạo tin và trừ lượt lần nữa. Phải sao lưu ledger cùng dữ liệu tin; retention/redaction cho snapshot và migration có version là phần riêng, không tự xóa bảng để rollback ứng dụng. Có thể rollback code tương thích và để nguyên bảng; không trộn nhiều phiên bản writer có/không hiểu key khi client đã sử dụng tính năng này.

### Kiểm chứng và áp dụng

Ngày 05-09-2026: **894 test microservices (52 file), 517 test backend (30 suite), 695 test frontend (50 suite)** qua; frontend production build, HTTP/event contracts và image Docker cách ly đều qua. Hợp đồng hiện có 49 thao tác (43 public/6 nội bộ), 18 trường hợp serialize helper frontend qua HTTP thực.

`npm run test:job-writes:integration` hiện chạy **61 nhóm kiểm tra**: 38 nhóm cũ + 23 nhóm create/repost có key, gồm 20 request trùng/lượt cuối cho cả tin thường và nổi bật, ngắt socket sau commit, replay sau hết hạn/đổi nội dung/duyệt/gỡ tin, namespace user/key, xung đột ý định, thay đổi quyền, lỗi từng bước/ledger, MyISAM, bản sao chi tiết và thay tác giả/công ty/gỡ nguồn khi đang chờ khóa. CI hiện có tự chạy bộ tích hợp mở rộng; chưa push/chạy workflow GitHub trong đợt này.

Chỉ MySQL tạm cùng dữ liệu tổng hợp do test tạo bị dọn; không gọi AI/SMTP/PayPal và không dùng fixture sửa hạn mức dự án thật. Image `jobfind-microservices:local` đã dựng lại, chưa được đưa vào container đang phục vụ. Khi rollout sau sao lưu/đối chiếu schema: giữ các bản sửa backend 2a/2b, cập nhật Job Core trước Gateway và chỉ bật client mới khi toàn bộ writer phục vụ route đã hỗ trợ key. Không recreate DB/broker hoặc xóa volume.

## Đợt 2d: dữ liệu biểu mẫu và đọc trạng thái tin riêng tư

Đã bổ sung mã nguồn backend/Job Core/Gateway/frontend và kiểm thử. **Chưa chuyển API đọc/ghi của AddPost sang Job Core, chưa thay container đang chạy và chưa đổi schema/dữ liệu thật.** Màn hình hiện tại đã dùng lớp chuyển đổi khi đọc dữ liệu legacy; helper modern sẵn sàng cho bước chuyển sau.

### Đọc tin trong phạm vi quản lý

- `GET /api/jobs/:id/manage` dành cho COMPANY/EMPLOYER thuộc công ty hoạt động/đã duyệt và ADMIN. Có thể đọc PS1/PS2/PS3/PS4, kể cả tin hết hạn; không chỉ người tạo mà đồng nghiệp đúng công ty cũng được xem. ADMIN có thể xem công ty khác hoặc tin không còn liên kết công ty để hỗ trợ, không có nghĩa được bỏ qua quota khi đăng mới/đăng lại.
- Kiểm tra người gọi hiện tại, công ty tác giả, trạng thái công ty và nội dung tin trong **cùng một câu SELECT**, không kiểm tra quyền bằng một lần đọc rồi lấy nội dung ở lần đọc khác. Quyền vai trò/tài khoản vẫn được Gateway xác thực trước đó. Người ngoài công ty và ID không tồn tại có cùng phản hồi 404, không trả nội dung. Không cần thêm bảng, không ghi quota/outbox hoặc tự yêu cầu AI.
- Phản hồi là trạng thái hiện tại và mã phân loại gốc, không phải snapshot 201 của idempotency. Không kèm file xác minh doanh nghiệp, thông tin đăng nhập, quota, prompt, kết quả AI hoặc ID yêu cầu kiểm duyệt. Gateway và controller đặt `Cache-Control: private, no-store`. Hợp đồng `ManagedJob` riêng cho phản hồi này.
- API công khai `/api/jobs/:id` giữ nguyên chính sách; thêm route quản lý không mở tin chờ duyệt/từ chối/đã gỡ cho ứng viên hoặc khách. PS3 chỉ có nghĩa chờ kiểm duyệt, không chứng minh worker đang xử lý. PS1 là đã duyệt, không tự đồng nghĩa còn hạn/đang hiển thị ở mọi projection.

### Đồng bộ biểu mẫu mà không tự đổi luồng ghi

- `jobFormAdapter.js` có mapping rõ ràng cho dữ liệu Job Core dạng phẳng và legacy `postDetailData`. Ưu tiên mã gốc, kể cả null; chỉ dùng mã trong association nếu API cũ không trả mã gốc. Backend chi tiết tin đã bổ sung 7 mã gốc, giữ các association/response cũ để tương thích.
- Dropdown giữ mã đang lưu dù Allcode không còn bản ghi tương ứng, có nhãn giải thích; null là “Chưa chọn”, không tự đổi thành lựa chọn đầu. Mặc định chỉ áp dụng khi tạo tin mới. Không tạo mã mới trong DB hoặc giả lập nhãn từ dữ liệu không có.
- AddPost bỏ gán giá trị dropdown bằng DOM và bỏ cập nhật state ngay trong render. Thêm lỗi tải rõ ràng, chặn lưu khi chưa tải đúng tin/không có dữ liệu/ngày lịch sử sai; bỏ phản hồi đọc đến muộn sau khi chuyển route. Vào trang tạo mới thì xóa dữ liệu tin trước đó. Hiển thị “Trạng thái lúc tải”, không giả lập cập nhật realtime; PS4 không có thao tác lưu/đăng lại.
- `buildJobCreate` tạo payload modern theo allowlist, chuẩn hóa số lượng/ngày/loại tin, đổi `genderCode` của UI thành `genderPostCode`, không gửi danh tính/quyền/trạng thái hoặc nhãn Allcode. Tạo payload và giữ nguyên nó **trước khi gán key**; không tính lại ngày/payload cho mỗi lần retry.
- `buildJobUpdate` so sánh với biểu mẫu đã tải: chỉ gửi trường thay đổi, giữ ý nghĩa clear/null, không gửi danh tính/trạng thái/loại tin/ngày hết hạn. Không đổi gì trả `null` để caller bỏ qua PUT; đổi ID/ngày/loại tin bị từ chối. Đây là giảm gửi full form, **chưa phải optimistic concurrency/If-Match**: hai người đổi cùng trường vẫn có thể ghi đè.
- `jobPostingService` thêm đọc quản lý và PUT từng phần, timeout 15 giây/AbortSignal, kiểm tra ID, từ chối patch rỗng. Không tự retry hoặc fallback legacy. Các builder/helper modern **chưa được nối vào nút Lưu/Đăng lại**; writer legacy vẫn dùng payload cũ và chưa có HTTP idempotency/outbox bền.

### Kiểm chứng và áp dụng

Ngày 05-09-2026: 916 test microservices (53 file), 517 backend (30 suite), 763 frontend (51 suite) qua; frontend production build, image Docker cách ly và HTTP/event contracts đều qua. Hợp đồng hiện có **50 thao tác (44 public/6 nội bộ)**; 20 trường hợp serialize helper frontend và thêm round-trip payload từ builder form qua HTTP thực.

`npm run test:job-writes:integration` hiện có **72 nhóm**: 61 nhóm trước + 11 nhóm đọc quản lý với MySQL/HTTP thật, gồm bốn trạng thái, phân quyền, đổi công ty, công ty khóa/chưa duyệt, actor không tồn tại, tin không liên kết công ty, mã danh mục thiếu/null, trường riêng tư, không tạo event và giữ chính sách public. Frontend có hồi quy tải thất bại/ID sai, đổi route khi đang tải, dữ liệu danh mục thiếu và ngày sai. Chưa nghiệm thu E2E trình duyệt trên stack thật hoặc mọi dữ liệu lịch sử.

Không gọi AI/SMTP/PayPal, không push/chạy workflow GitHub; chỉ dọn MySQL tạm có nhãn sở hữu của bài test. Image mới đã được dựng nhưng chưa rollout. Khi áp dụng theo từng bước: backend bổ sung mã gốc trước frontend; Job Core trước Gateway trước khi dùng helper mới. Không recreate DB/broker, xóa volume hoặc sửa Allcode lịch sử để “làm test qua”. Các điều kiện rollout/sao lưu ở đợt 2c và `local-compose.md` vẫn còn áp dụng.

## Đợt 2e: phát hiện biểu mẫu cũ khi sửa tin

Ngày 06-09-2026, đã bổ sung kiểm tra phiên bản cho backend legacy, Job Core và **nút Lưu đang dùng của AddPost**. Màn hình vẫn gọi API legacy; các helper modern được chuẩn bị nhưng chưa đổi luồng đăng mới/đăng lại/kiểm duyệt. Đợt này bổ sung bảo vệ form cũ còn thiếu tại mốc 2b/2d, không phải triển khai hết roadmap PDF.

### Hợp đồng phiên bản và giao dịch

- Đọc chi tiết legacy trả `editRevision` cùng bản ghi; đọc riêng tư modern trả `data.editRevision`. Client gửi lại giá trị đó trong body `expectedRevision` khi sửa. Backend legacy thành công trả `editRevision` ở cấp ngoài, Job Core trả `data.editRevision`; no-op giữ nguyên mã. Không lấy mã từ public projection Search hoặc snapshot phản hồi đăng mới có idempotency.
- Định dạng `jv1-` + 64 ký tự SHA-256 chữ thường, băm theo thứ tự cố định: ID tin/chi tiết bất biến/tác giả, trạng thái, ngày hết hạn, loại tin và 11 trường chi tiết. Chuẩn hóa số/chuỗi từ driver nhưng phân biệt null và chuỗi rỗng. Hai bản module có kiểm thử buộc giống nhau; không dùng timestamp có độ chính xác thấp. Không thêm bảng/cột hoặc chạy migration.
- Mã là dấu vân tay trạng thái, **không phải token phân quyền, số thứ tự sự kiện hay HTTP ETag/If-Match**. Quyền/tình trạng công ty vẫn kiểm tra lại trong transaction. So sánh dưới khóa tin và chi tiết, trước xác định no-op hoặc ghi dữ liệu. Mã cũ trả HTTP 409 với `conflict: true`; legacy dùng `errCode: 4`. Không tạo snapshot/event/AI, không trừ lượt hoặc thay tin khi xung đột. Lỗi quyền/tin đã gỡ vẫn có thể được từ chối trước phép so sánh.
- Copy-on-write ở 2b làm mã thay đổi ngay cả khi nội dung A → B → A. Tuy nhiên đây không phải lịch sử đơn điệu của mọi mutation: trạng thái bị đổi rồi khôi phục nguyên trạng hoặc writer sửa trực tiếp rồi khôi phục cùng dòng chi tiết có thể trả cùng dấu vân tay. Chưa có hàng rào phiên bản cho thao tác duyệt/chặn/mở lại; đó là đợt tiếp theo.
- `expectedRevision` **tùy chọn ở server chỉ để giữ tương thích API cũ**. Client không gửi vẫn không được bảo vệ khỏi lost update, và một writer cũ ghi sau vẫn có thể ghi đè. Mã đúng không giúp vượt quyền công ty. Bảo đảm “chỉ một người lưu” áp dụng khi các lệnh cùng xuất phát từ một phiên bản và đều gửi precondition hợp lệ; không tuyên bố mọi writer đã được chuyển.

### Biểu mẫu và tình huống kết nối không chắc chắn

- AddPost bắt buộc có phiên bản hợp lệ từ lần tải tin; thiếu mã thì hiện thông báo và khóa Lưu, không âm thầm gửi thiếu precondition. `buildJobUpdate` lấy mã từ baseline đã tải, không từ form đang sửa; `updateJob` modern cũng từ chối thiếu/sai mã trước HTTP. Payload tạo mới không mang mã chỉnh sửa.
- Lưu legacy từ màn hình có timeout 15 giây, chặn bấm trùng khi đang chờ. Thành công dùng phiên bản phản hồi cho lần sửa tiếp, không tự GET rồi ghi lại. Phản hồi muộn sau khi đổi route/unmount bị bỏ qua.
- HTTP 409, lỗi mạng/timeout/máy chủ, hoặc phản hồi thành công thiếu phiên bản: giữ draft trong bộ nhớ và khóa Lưu; không retry/fallback tự động. Nút **Tải lại tin** phải qua xác nhận bỏ phần chưa lưu; có thể chọn **Giữ biểu mẫu** để sao chép nội dung trước. Lỗi validation xác định giữ mã cũ để người dùng sửa dữ liệu và gửi lại.
- Mất phản hồi sau commit không có nghĩa thao tác chưa lưu; retry bằng mã cũ nhận xung đột, GET dùng để đối chiếu. Đây không phải HTTP idempotency của PUT hoặc cơ chế tự merge. Draft không được lưu bền qua refresh/đăng xuất, không có trang so sánh lịch sử, không tự áp dụng bảo vệ này cho nút Đăng lại/kiểm duyệt legacy.

### Kiểm chứng và thứ tự áp dụng

950 test microservices (54 file), 524 backend (30 suite), 786 frontend (51 suite) qua: **2.260 test**. Production build frontend, image Docker local và bài thử image cách ly, HTTP/event contracts qua. Vẫn 50 thao tác HTTP (44 public/6 nội bộ), không thêm endpoint. Chưa nghiệm thu E2E trình duyệt trên stack thật.

`npm run test:job-writes:integration` qua **88 nhóm**: 72 cũ + 16 nhóm phiên bản, gồm đồng thời core/core, core/legacy, legacy/core, legacy/legacy; quyền của đồng nghiệp/công ty khác; no-op/stale no-op; token sau chờ khóa; trạng thái kiểm duyệt thay đổi; A→B→A; rollback outbox; mất phản hồi sau commit và tương thích writer không gửi mã. Dùng MySQL tạm, HTTP và Sequelize thật, không gọi AI/SMTP/PayPal. Chỉ dọn container và dữ liệu tạm có nhãn sở hữu khớp.

Đã dựng image nhưng **chưa thay container đang chạy, backend đang phục vụ hoặc schema/dữ liệu thật; chưa push/chạy workflow GitHub**. Trước áp dụng, giữ snapshot copy-on-write 2b và kiểm tra các điều kiện sao lưu/schema ở 2c. Cập nhật toàn bộ backend legacy/Job Core phục vụ sửa tin trước frontend, cập nhật Gateway cùng hợp đồng nếu sử dụng helper modern. Không trộn writer cũ bỏ qua `expectedRevision` với client được coi là đã bảo vệ. Khi rollback backend cũ, dừng giao diện sửa mới hoặc rollback đồng bộ; không “sửa” bằng bỏ precondition. Không recreate DB/broker, xóa volume hoặc khởi tạo lại bảng tin.

## Đợt 2f: kiểm duyệt thủ công và hàng rào kết quả AI

Ngày 06-09-2026, đã nối **Duyệt/Từ chối/Chặn/Mở lại của màn hình ManagePost đang sử dụng** vào writer legacy có giao dịch và precondition. Dùng hàng rào `job_moderation_state` đã có của Job Core để kết quả AI cũ không áp dụng sau thao tác thủ công. Không thêm API duyệt modern, không chuyển AddPost/Đăng lại sang Job Core, chưa rollout backend/frontend/container thật.

### Quyết định phải khớp bản tin đã tải

- Hai API danh sách quản lý legacy bổ sung mã phân loại gốc trong cùng lần đọc chi tiết và `editRevision` cho từng dòng; giữ dữ liệu/association cũ, thêm `Cache-Control: private, no-store`. Mã dùng cùng giao thức jv1 của 2e, không suy ra từ tên hoặc timestamp của dòng danh sách.
- Ba route legacy `PUT /api/accept-post`, `/api/ban-post`, `/api/active-post` **bắt buộc `expectedRevision`**: thiếu trả 428, sai định dạng 400, phiên bản cũ trả 409/`conflict: true` trước ghi/no-op. Đây là thay đổi không tương thích với màn hình quản trị cũ; phải triển khai có phối hợp, không tự bỏ trường bắt buộc để tránh lỗi. API sửa tin ở 2e vẫn giữ chính sách tùy chọn cho client cũ; không đánh đồng hai chính sách.
- Controller truyền user ID/role từ middleware đăng nhập, không lấy quyền ADMIN trong body; service chỉ nhận ADMIN qua đối số danh tính riêng và kiểm tra actor còn tồn tại dưới khóa. Các route vẫn qua middleware xác thực tài khoản/quyền hiện tại. Mã phiên bản không thay thế phân quyền và không phải key chống gửi POST trùng.
- Duyệt chỉ cho PS3 hoặc PS2 → PS1; từ chối PS3 → PS2; chặn PS1/PS2/PS3 → PS4; mở lại PS4 → PS3. Màn hình giữ nút Chặn ở PS1 như trước. Không thể duyệt thẳng tin PS4; phải mở lại rồi xem/xét duyệt. Gửi đúng phiên bản và đã ở trạng thái đích là no-op, không ghi thêm note/gửi mail/phát event; gửi mã cũ vẫn xung đột trước no-op.
- Từ chối/chặn/mở lại cần lý do không rỗng, tối đa 255 ký tự theo cột Note hiện có. Duyệt giữ ghi chú chuẩn của hệ thống và hành vi cập nhật `timePost` cũ. Không đổi tác giả, snapshot nội dung, `timeEnd`, loại tin hoặc quota. Thành công có `changed`, `statusCode`, `editRevision`; quyết định thực sự thay đổi trả `postId` đúng tin đã ghi để phát invalidation.

### Giao dịch và phối hợp với Job Core

- Kiểm tra InnoDB, khóa user theo ID tăng dần → công ty → tin → chi tiết; kiểm tra lại tác giả và phiên bản; lưu hủy yêu cầu AI, trạng thái tin và Note **trong một transaction**. Lỗi ghi note/trạng thái/hàng rào hoàn tác toàn bộ. ADMIN vẫn có thể kiểm duyệt tin ngoài công ty mình; duyệt không tự mở khóa/duyệt công ty và không thay chính sách public.
- Thay đổi thủ công đặt request kiểm duyệt hiện có thành `cancelled`. Handler AI vốn khóa cùng dòng tin rồi kiểm tra request/state; nếu AI commit trước, quyết định từ danh sách cũ bị 409; nếu quyết định thủ công commit trước, kết quả AI cũ nhận `stale`. Không đồng thời chấp nhận cả hai quyết định trên cùng trạng thái đã tải.
- **Mở lại là chờ duyệt thủ công, không phải tự công bố hoặc gửi AI mới.** Chặn rồi mở lại không phục hồi request AI trước đó. Request mới chỉ được tạo bởi luồng Job Core thích hợp, ví dụ sửa tên/HTML; ID mới và nội dung mới vẫn phải khớp khi áp dụng kết quả.
- Mọi sửa thực sự ở writer legacy cũng hủy request AI cùng transaction, kể cả chỉ đổi metadata nhưng giữ tên/HTML. Vì legacy đưa tin về PS3 chờ duyệt thủ công, chỉ kiểm tra hash tên/HTML chưa đủ để chặn AI cũ. No-op legacy không hủy một request đang chờ hợp lệ.
- CSDL legacy độc lập chưa có bảng `job_moderation_state` vẫn sửa/duyệt được; nếu bảng có thì phải InnoDB và truy cập được. Chỉ trường hợp bảng thực sự không tồn tại được bỏ qua; lỗi SQL/quyền/schema không bị nuốt. Không tự tạo bảng hoặc đổi engine. `notes` phải tồn tại và dùng InnoDB. Đây vẫn là cơ chế chuyển tiếp trên DB dùng chung, chưa hoàn thành database-per-service.
- Email tác giả, notification người theo dõi và event/invalidation legacy vẫn **best-effort sau commit**, chưa có outbox/dedup bền. Lỗi gửi notification không biến một quyết định đã commit thành lỗi nghiệp vụ để người dùng lặp lại; rollback/no-op/conflict không phát những side effect mới đó. Không hủy mail/event đã phát trước đó, không ngăn worker thực hiện lời gọi AI đã nằm trong hàng đợi; hàng rào chỉ ngăn kết quả cũ thay trạng thái tin. Không tuyên bố exactly-once email hoặc mọi event đều không mất.

### Hành vi màn hình quản trị

- Chốt row/phiên bản khi mở hộp thoại, không tự lấy mã mới rồi áp dụng lại quyết định cũ. Thiếu phiên bản hoặc tải danh sách lỗi thì không cho duyệt. Chặn gửi trùng khi đang chờ, timeout 15 giây; thành công tải lại danh sách, không giả định kết quả AI hay trạng thái projection tức thời.
- 409/428/tin không tồn tại hoặc kết quả mạng/máy chủ không chắc chắn: khóa thao tác, yêu cầu người dùng tải lại và xem tin trước khi quyết định lại; không retry/fallback. NoteModal đợi kết quả, giữ ghi chú khi lỗi, nhắc sao chép trước khi đóng/tải lại. Các màn hình khác dùng NoteModal vẫn giữ hành vi cũ nếu không bật chế độ đợi.
- Kết quả tải/confirmation từ bộ lọc, trang, route hoặc component cũ bị bỏ qua. Khóa đổi bộ lọc/trang trong lúc gửi hoặc nhập ghi chú. Giao diện quản trị dùng endpoint ADMIN ngay cả khi vào từ link một tin; recruiter vẫn dùng endpoint theo công ty. Draft chỉ nằm trong bộ nhớ; đổi route/rời trang vẫn có thể mất ghi chú chưa lưu. Không có so sánh lịch sử/auto-merge.
- jv1 vẫn là dấu vân tay trạng thái: thay đổi rồi khôi phục toàn bộ cùng nội dung/trạng thái có thể có mã giống trước (giới hạn 2e); không phải bộ đếm của mọi chuyển trạng thái. Luồng xóa Job Core, dữ liệu lịch sử, mọi writer cũ không hỗ trợ hàng rào và nghiệm thu E2E toàn stack còn cần đối chiếu riêng.

### Kiểm chứng và áp dụng

950 test microservices (54 file), 543 backend (31 suite), 801 frontend (51 suite) qua: **2.294 test**, frontend production build và HTTP/event contracts qua. 50 thao tác modern/13 event không đổi; ba route legacy trên chưa được đưa vào catalog OpenAPI modern. CI đã gọi bộ tích hợp mở rộng nhưng chưa push/chạy workflow GitHub.

`npm run test:job-writes:integration`: **107 nhóm** (88 cũ + 19 mới), MySQL thật trong container tạm. Gồm các chuyển trạng thái, stale repeat/no-op, duyệt và sửa qua hai writer, AI cũ sau chặn/mở lại hoặc sửa metadata, AI mới sau sửa nội dung, cạnh tranh manual/manual, manual/core, manual/AI, lỗi ghi từng bảng và engine không an toàn. Gọi writer giao dịch/handler AI thật với dữ liệu tổng hợp; lớp SMTP/follower sau commit được kiểm chứng bằng unit test, không gọi provider thật. Chỉ xóa container/volume MySQL tạm có nhãn sở hữu.

Trước rollout: sao lưu và kiểm tra schema/engine/quyền truy cập bảng Note/hàng rào; giữ các bản copy-on-write/precondition 2b–2e và handler AI có request/state fence. Cập nhật **toàn bộ writer backend** và frontend quản trị trong cùng cửa sổ bảo trì; trong khoảng lệch phiên bản tạm dừng duyệt để không có writer cũ bỏ qua precondition. Backend mới từ chối màn hình cũ bằng 428; backend cũ có thể bỏ qua trường nên không an toàn khi dùng màn hình mới. Không phục hồi compatibility bằng loại bỏ precondition. Không recreate DB/broker, xóa bảng/volume hoặc tự thay đổi schema/dữ liệu thật. Đợt này chưa cập nhật tiến trình/container đang phục vụ và chưa nghiệm thu E2E trình duyệt trên stack đó.

## Đợt 2g: thông báo kiểm duyệt thủ công được lưu bền

Ngày 06-09-2026, thay lớp SMTP/ghi thông báo follower best-effort của **bốn quyết định manual ở 2f** bằng yêu cầu thông báo trong cùng transaction. Không đổi endpoint, request, revision hoặc chuyển thêm màn hình. Không chạy migration hay thay các tiến trình đang phục vụ.

### Lưu cùng quyết định, gửi độc lập

- Writer legacy lưu trạng thái + Note + hủy AI request + các dòng `outbox_events` trên **cùng Sequelize transaction**. Lỗi ghi một dòng hoặc cả lô người nhận, lỗi đọc danh sách theo dõi, lỗi schema/quyền DB đều làm transaction thất bại; không trả thành công kèm thông báo chưa được ghi. No-op/stale/rollback không để lại intent mới.
- Đây là **adapter chuyển tiếp trên MySQL dùng chung**, không phải database-per-service: backend ghi vào bảng outbox hiện có của Job Core; relay Job Core hiện có claim/lease/retry/publish confirm rồi ghi marker. Không tạo relay thứ hai trong backend. Riêng event mới được relay ghi producer `legacy-backend`, giữ nguyên ID/thời điểm đã lưu qua retry; các event Job Core cũ không đổi producer. Metadata này không thay thế ACL broker.
- Event v1 mới `notification.manual_moderation_requested` có `decisionId` chung cho quyết định, `jobId`, `recipientId`, `audience`, `action`, snapshot tên tin/công ty và note. Mỗi người nhận/vai trò có một UUID event riêng; backend và relay đều kiểm tra cùng schema sinh tự động. Trần 16 KiB/event, không đưa HTML tin, email hay toàn bộ danh sách follower vào một message.
- Snapshot follower lấy một lần trong transaction khi duyệt; loại dòng follow trùng và ID rỗng/không hợp lệ, ghi theo lô tối đa 100 intent. Sau commit không đọc lại follower hay tên tin để gửi lại. Người theo dõi mới về sau không được thêm vào một quyết định cũ. Tác giả đồng thời theo dõi công ty nhận hai thông báo khác vai trò với hai event ID, nhưng chỉ một email cho quyết định đó. Snapshot danh sách hiện còn đọc vào bộ nhớ và mọi lô nằm trong transaction giữ khóa tin; chưa nghiệm thu fan-out rất lớn/độ trễ dưới tải.
- Duyệt/từ chối/chặn/mở lại đều tạo intent cho tác giả. Chỉ **duyệt thực sự** tạo thêm follower intent, không có ở mở lại PS3. Payload follower bắt buộc action approve và note null, không làm lộ lý do nội bộ.
- Notification bắt buộc có event ID cho đường mới, không fallback về gửi trực tiếp. Inbox + thông báo + yêu cầu gửi email/realtime được commit cùng nhau, dedup theo event ID/người nhận. Chạy lại cùng message không tạo thêm thông báo hay yêu cầu email. Tác giả có email và thông báo trong ứng dụng; follower vẫn **chỉ trong ứng dụng**, không bật email hàng loạt. Email tác giả được tra tại lần tạo delivery đầu tiên, không phải snapshot địa chỉ tại thời điểm quyết định; sau đó delivery giữ địa chỉ đã lưu.
- Bỏ hoàn toàn SMTP/follower bulk insert sau commit ở `postService` cho các quyết định này, tránh gửi đôi. Mẫu mail escape nội dung tên/lý do, nhắc đây là quyết định đã ghi nhận và dẫn về quản lý để xem trạng thái mới nhất. Preview tối đa 255 Unicode code point khớp cột legacy, không cắt đôi surrogate; email/intent giữ đầy đủ tên và lý do. Hai chuông thông báo frontend hiện đọc `content`/`link` chung nên không cần sửa giao diện trong đợt này.

### Giới hạn cần giữ rõ

Đã lưu bền **ý định**, không cam kết email chắc chắn tới hộp thư hay SMTP exactly-once. Chính sách delivery cũ vẫn áp dụng: cấu hình thiếu giữ pending, địa chỉ không hợp lệ có thể skipped, lỗi vĩnh viễn failed và lần gửi SMTP không biết kết quả phải cách ly unknown, không tự gửi lại mù quáng. Retry nghiệp vụ bị giới hạn, DLQ cần vận hành đối chiếu; không xóa inbox/delivery/event để ép gửi lại. Thông báo có thể đến chậm/khác thứ tự quyết định; không dùng chúng làm nguồn trạng thái hiện tại.

`job.updated`/dashboard invalidation của controller manual vẫn best-effort sau commit. Các publisher legacy tạo/sửa/đăng lại tin, công ty, nộp CV và Identity chưa được chuyển toàn bộ. Không phát `job.created` hoặc `job.moderated` giả để gửi follower, không thêm yêu cầu AI. Hành vi follower từ `job.created` của luồng khác và nguy cơ thông báo nghiệp vụ tương tự từ các đường khác chưa được thống nhất; dedup ở đây chỉ cho cùng intent đã lưu, không phải mọi event cùng job.

### Kiểm chứng và thứ tự áp dụng

**2.322 test qua**: 554 backend (32 suite), 967 microservices (54 file), 801 frontend (51 suite). Hợp đồng hiện có **50 thao tác HTTP và 14 event**, image local và bài test image cách ly qua. Không sửa hoặc build lại frontend trong đợt này. `test:job-writes:integration` có **114 nhóm**: bổ sung lỗi outbox và batch sau, thiếu/sai engine, snapshot 207 intent có follow trùng/tác giả cũng theo dõi, nhận lặp/đồng thời vào inbox SQL thật, rollback delivery, Unicode dài trên VARCHAR(255). Tích hợp broker riêng có **5 nhóm** kiểm tra 14 payload cùng confirm/retry/DLQ/backlog. Không chạy worker gửi SMTP/realtime hoặc gọi AI/PayPal trong các fixture. Chỉ dọn container/volume tạm có nhãn sở hữu. CI đã gọi các script này từ mốc trước; chưa push/chạy workflow GitHub.

1. Tạm dừng thao tác kiểm duyệt khi nâng cấp; sao lưu và kiểm tra trên bản sao trước. Xác minh backend, Job Core, Notification dùng **cùng database hiện tại**; outbox/notes và các bảng ghi liên quan phải InnoDB, đúng schema, đủ quyền đọc metadata/INSERT. Notification cần inbox/delivery/notifications InnoDB và các cột người dùng đang dùng. Backend không tự tạo/sửa bảng; outbox thiếu/không InnoDB khiến thay đổi manual trả 503 và rollback, kể cả cài legacy độc lập không có Job Core. Lỗi schema/quyền khác không bị nuốt.
2. Nâng cấp Notification và Admin consumer trước, xác nhận queue Notification đã bind **routing key mới** và consumer khỏe; sau đó Job Core relay/các validator dùng catalog 14 event; cuối cùng toàn bộ backend legacy. Giữ frontend 2f có precondition. Không bật writer mới trước khi binding sẵn sàng: broker confirm không chứng minh Notification có queue nhận, nhất là khi chỉ Audit nhận `#`.
3. Giữ nguyên DB/broker/queue/volume, không purge hay đánh dấu `publishedAt` bằng tay. Sau cập nhật có kiểm soát, theo dõi pending outbox, lỗi relay, inbox/delivery pending/failed/unknown và DLQ; nghiệm thu một quyết định và một lần nhận lại trên dữ liệu thử được phép. Chưa thực hiện bước này trên stack thật ở đợt 2g.
4. Khi rollback, dừng quyết định mới và giữ consumer/relay hiểu event mới cho đến khi đối chiếu hết backlog. Không rollback/xóa bảng, đổi event ID, gửi lại quyết định để ép email hoặc bật thêm lớp SMTP trực tiếp trong writer mới. Không coi việc build image là đã rollout backend (image microservices không chứa backend legacy).

## Thứ tự các đợt còn lại

1. Tiếp tục outbox legacy: **`job.updated`/invalidation sau quyết định thủ công**, rồi tạo/sửa/đăng lại tin và những publisher còn lại. Ý định thông báo manual đã lưu cùng quyết định ở 2g; không đồng nghĩa mọi event legacy đã bền. Sau đó mới chuyển quyền sở hữu từng luồng ghi và thống nhất thông báo nghiệp vụ giữa các đường cũ/mới.
2. Chuyển từng màn hình khi đủ nghiệp vụ: vòng đời UI giữ payload/key, phản hồi đăng thành công, danh sách/note, các client chưa gửi revision và nghiệm thu quyền. Hạn mức 2a; snapshot/ngày hết hạn 2b; đăng lại/idempotency modern 2c; adapter/đọc quản lý 2d; sửa tin có precondition 2e; duyệt legacy có precondition/hàng rào AI 2f đã triển khai trong mã nguồn. Còn các giới hạn/rollout nêu trên; không chỉ đổi `/api/create-new-post` thành `/api/jobs`.
3. Nối màn hình AI/CV và chuyển luồng tìm kiếm/đăng tin theo từng màn hình khi phía server đủ nghiệp vụ. Hiện màn hình Kanban/báo cáo và gợi ý tìm kiếm đã có gọi microservice; danh sách tìm kiếm chính/đăng tin vẫn còn API legacy. Không coi helper API đã có là giao diện tính năng đã hoàn tất.
4. Nghiệm thu các vai trò trên stack mới, hạn mức và thao tác lặp, token hết hạn, dịch vụ gián đoạn/phục hồi, dữ liệu cập nhật chậm giữa dịch vụ. Các mục kiến trúc/vận hành khác của PDF tiếp tục theo `implementation-progress.md`.
