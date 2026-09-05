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

## Thứ tự các đợt còn lại

1. Tiếp tục nghiệp vụ Job Core trước khi đổi API đăng tin: trường cập nhật/ngày hết hạn/giới tính, sửa tin dùng chung chi tiết sau đăng lại, phản hồi tương thích, luồng đăng lại/kiểm duyệt và chống gửi POST lặp theo ý định. Hạn mức/cạnh tranh đã xử lý ở đợt 2a, nhưng không có nghĩa mọi nghiệp vụ đã tương đương. Không chỉ đổi `/api/create-new-post` thành `/api/jobs` hoặc xóa trường mà UI đang cho người dùng chỉnh.
2. Hoàn thiện outbox cho publisher legacy và kế hoạch chuyển quyền sở hữu luồng ghi. Schema event đúng không tự bảo đảm gửi không mất; không phát hai event độc lập cho cùng một thao tác để “đồng bộ”.
3. Nối màn hình AI/CV và chuyển luồng tìm kiếm/đăng tin theo từng màn hình khi phía server đủ nghiệp vụ. Hiện màn hình Kanban/báo cáo và gợi ý tìm kiếm đã có gọi microservice; danh sách tìm kiếm chính/đăng tin vẫn còn API legacy. Không coi helper API đã có là giao diện tính năng đã hoàn tất.
4. Nghiệm thu các vai trò trên stack mới, hạn mức và thao tác lặp, token hết hạn, dịch vụ gián đoạn/phục hồi, dữ liệu cập nhật chậm giữa dịch vụ. Các mục kiến trúc/vận hành khác của PDF tiếp tục theo `implementation-progress.md`.
