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

## Thứ tự các đợt còn lại

1. Tiếp tục đồng bộ trước khi đổi API đăng tin: adapter phản hồi/Allcode cho form, đọc trạng thái tin của chủ sở hữu, chuyển luồng kiểm duyệt và xử lý xung đột form cũ. Hạn mức đã xử lý ở đợt 2a; sửa độc lập/giữ ngày hết hạn ở 2b; API đăng lại và idempotency của writer modern ở 2c. Chưa có nghĩa mọi nghiệp vụ đã tương đương; không chỉ đổi `/api/create-new-post` thành `/api/jobs`.
2. Hoàn thiện outbox cho publisher legacy và kế hoạch chuyển quyền sở hữu luồng ghi. Schema event đúng không tự bảo đảm gửi không mất; không phát hai event độc lập cho cùng một thao tác để “đồng bộ”.
3. Nối màn hình AI/CV và chuyển luồng tìm kiếm/đăng tin theo từng màn hình khi phía server đủ nghiệp vụ. Hiện màn hình Kanban/báo cáo và gợi ý tìm kiếm đã có gọi microservice; danh sách tìm kiếm chính/đăng tin vẫn còn API legacy. Không coi helper API đã có là giao diện tính năng đã hoàn tất.
4. Nghiệm thu các vai trò trên stack mới, hạn mức và thao tác lặp, token hết hạn, dịch vụ gián đoạn/phục hồi, dữ liệu cập nhật chậm giữa dịch vụ. Các mục kiến trúc/vận hành khác của PDF tiếp tục theo `implementation-progress.md`.
