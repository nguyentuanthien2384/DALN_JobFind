# Đồng bộ hồ sơ ứng tuyển legacy và tiến trình — đợt 2y

Ngày 09-09-2026, tiếp nối màn hình AI/CV và Search 2x. Đợt này làm bền đường nộp hồ sơ legacy → Application/Kanban và đưa tiến trình tuyển dụng về màn hình ứng viên. Chưa áp dụng lên container/dữ liệu thật.

## Hành vi đã nối

- `POST /api/create-new-cv` vẫn lưu PDF và lời giới thiệu trong MySQL. Danh tính lấy từ phiên đăng nhập; service đọc lại vai trò ứng viên đang hoạt động, người đăng tin, công ty được duyệt và tin công khai dưới khóa giao dịch. Kiểm tra hạn tin sau thời gian chờ khóa.
- CV và event `application.submitted` được ghi vào `outbox_events` trong **cùng transaction**. Lỗi ghi outbox thì CV rollback; broker dừng vẫn nhận hồ sơ nếu MySQL còn hoạt động. Relay đã có của Job Core phát có confirm; không còn gọi publisher trực tiếp từ controller CV.
- Event giữ tên/liên hệ ứng viên, tiêu đề công việc, công ty/người nhận, lời giới thiệu và thời điểm từ nguồn đã khóa khi nộp. Không đưa PDF vào hàng đợi. File vẫn là bản riêng trong bản ghi CV legacy; sửa CV đang lưu hoặc thông tin tài khoản sau đó không thay file đã nộp.
- Ràng buộc unique `(userId, postId)` tiếp tục cho một lần ứng tuyển mỗi tin. Nộp lại hoặc gửi nội dung khác trả 409/`errCode: 5`, không sửa bản đã nộp, không thêm event. Khi tìm thấy bản hiện có dưới khóa, trả thêm `cvId` của chính ứng viên. Đây không phải biên nhận khớp nội dung theo Idempotency-Key; sau mất phản hồi cần xem lại CV đã nộp.
- Modal nộp CV chặn bấm chồng, bỏ kết quả muộn khi đổi tin/đóng modal/đổi phiên, giới hạn lời giới thiệu 255 ký tự theo cột hiện có. Khi gặp trùng hoặc chưa xác nhận được kết quả gửi, giao diện hướng dẫn xem hồ sơ đã nộp. Không tự gửi lại hoặc gọi AI.
- `/candidate/cv-post` giữ danh sách/tệp CV legacy làm nguồn hồ sơ đã nộp. Cột **Tiến trình tuyển dụng** đọc `/api/my-applications` khi bật cờ, ghép bằng `legacy_cv_id` và kiểm tra `job_id`. ID PostgreSQL không được dùng thay ID CV MySQL. Trạng thái đọc CV và tiến trình tuyển dụng hiển thị riêng.
- Thiếu projection hiện “Đang chờ đồng bộ”; lỗi dịch vụ hiện “Chưa tải được tiến trình”, vẫn giữ danh sách đã nộp. Có tải lại, phân trang, bỏ phản hồi muộn/khác người dùng và kết thúc phiên. Dữ liệu lịch sử thiếu tin/danh mục vẫn có liên kết xem CV. Điện thoại hiển thị từng hồ sơ theo thẻ; máy tính dùng bảng.

## Giao dịch, dữ liệu lịch sử và giới hạn

Writer kiểm tra `cvs`, `users`, `accounts`, `companies`, `posts`, `detailposts`, `outbox_events` đều là InnoDB và có unique đầy đủ hai cột người dùng/tin. Thiếu điều kiện thì trả 503, không tự tạo bảng/chỉ mục hoặc quay về publisher trực tiếp. Khóa người dùng theo thứ tự ID, công ty rồi dữ liệu tin, giữ dữ liệu nguồn cho event đến commit. Không thay quota đăng tin hoặc điều kiện kiểm duyệt AI/manual.

Marker `aggregateType=legacy-application` đi cùng event trong outbox. Relay chỉ dùng producer `legacy-backend` cho đúng marker/event; event v1 và 15 payload không đổi. Giữ event ID qua redelivery; Application dedup bằng `legacy_cv_id` và không ghi đè stage/ghi chú sau khi nhà tuyển dụng cập nhật.

`syncFromLegacy` bỏ qua CV đã có marker outbox này, kể cả chưa phát, để việc import lúc startup không giành trước snapshot đã lưu trong event. Điều kiện nằm trong cùng SELECT và so sánh mã dạng binary để không lỗi khi collation của kết nối/bảng khác nhau. **Không xóa/đổi marker hoặc payload khi còn cần đối chiếu hoặc phục hồi projection.**

Hồ sơ lịch sử không có event bền vẫn nhập theo cơ chế cũ; thông tin liên hệ phản ánh thời điểm import, không thể khẳng định là bản tại thời điểm nộp. Import không ghi đè hồ sơ đã có trong PostgreSQL. Chưa sửa cơ chế đọc toàn bộ dữ liệu của import/`my-applications` thành phân trang lớn; cần nghiệm thu thời gian truy vấn và kế hoạch chỉ mục trên bản sao dữ liệu dự kiến trước rollout quy mô lớn.

API modern vẫn **52 thao tác**. `MyApplication.legacy_cv_id` được thêm vào phản hồi và tài liệu, cho phép null với nguồn không có ID legacy; optional trong schema để giữ tương thích client cũ. UI mới yêu cầu trường này khi có dữ liệu. Không trả rating, note nội bộ, timeline hoặc PDF qua GET lịch sử ứng viên. Gateway và Application đặt `private, no-store` cho đường đọc này.

## Thứ tự áp dụng và rollback

1. Kiểm tra/sao lưu trên môi trường dự kiến theo các đợt trước; chuẩn bị bảng outbox và unique CV bằng migration đã có. Không tự sửa hoặc xóa dữ liệu trùng để vượt kiểm tra. Đợt này không chạy DDL/migration trên dữ liệu thật.
2. Nâng **toàn bộ Application reader/importer trước writer mới**, để mọi importer hiểu marker và không ghi snapshot liên hệ hiện tại thay snapshot nộp. Nâng Core relay hiểu `legacy-application` và giữ consumer/queue hiện có.
3. Nâng backend writer/controller CV đồng bộ. Từ đây ứng tuyển cần hạ tầng transaction/outbox sẵn sàng; đây là thay đổi vận hành so với backend chạy riêng. Tài khoản ADMIN không nộp thay ứng viên qua service này. Lỗi dữ liệu/điều kiện có HTTP 400/403/404/409/503, lỗi bất ngờ 500; envelope `errCode` giữ cho client cũ.
4. Nâng Gateway và frontend. Cờ build mới `REACT_APP_APPLICATION_PROGRESS_ENABLED=false` mặc định; bật `true` sau khi `/api/my-applications` có `legacy_cv_id`. Cờ này chỉ điều khiển đọc tiến trình, độc lập AI/CV, Search và các cờ quản lý tin.
5. Rollback giao diện bằng frontend 2y+ với cờ `false`; danh sách/tệp CV legacy vẫn dùng được. Không hạ reader/importer hoặc relay xuống bản không hiểu marker khi còn dữ liệu 2y. Giữ outbox, unique, consumer và PostgreSQL; không replay hàng loạt bằng event ID mới hoặc sửa stage để ép đồng bộ.

Chưa đổi `.env`, container, schema/dữ liệu dự án thật hoặc cờ đang chạy; chưa push/deploy/GitHub CI. Tính năng mới được build và thử trong môi trường tạm, bản build cuối local giữ các cờ mới tắt và các lựa chọn legacy.

## Kiểm chứng

- **789 test backend / 37 suite**, **1.133 test microservices / 59 file**, **1.366 test frontend / 66 suite** qua; tổng 3.288 bài hồi quy. Không cộng các bài chạy lại vào tổng.
- **10 nhóm tình huống tích hợp mới** dùng backend controller/Sequelize thật, MySQL riêng, Core relay thật, RabbitMQ riêng và Application consumer/PostgreSQL thật: import lịch sử, snapshot nguồn, scoped GET/ID khác hệ, nộp trùng, redelivery giữ stage, rollback outbox, thiếu unique hoặc unique ba cột có phần tiền tố, mất phản hồi sau commit, nộp đồng thời, broker phục hồi, quyền/hạn tin/đầu vào và chờ khóa vượt hạn.
- Browser production build mở rộng bài 2x: lịch sử, stage, nguồn cũ thiếu liên kết, CV ID đúng, lỗi/khôi phục tiến trình; cả desktop/mobile. API trong bài browser là fixture và mọi request ngoài fixture bị chặn. Đã xem ảnh thực tế và sửa bố cục điện thoại. Không phải browser nối trực tiếp backend/broker của bài tích hợp trên.
- Build bật/tắt cờ, HTTP/event contracts, syntax script, YAML CI và diff được kiểm tra. CI có bài `test:application-sync:integration` cùng bộ browser mở rộng; workflow chưa chạy trên GitHub.

Chạy tại `microservices`, sau khi cài dependencies của `backend` và `microservices`:

```powershell
# Image thử phải có sẵn; runner dùng --pull=never và không đọc .env thật.
docker pull mysql:8.0
docker pull postgres:16-alpine
docker pull rabbitmq:4-management-alpine
npm run test:application-sync:integration
```

Runner tạo tên/người dùng/mật khẩu thử riêng, publish trên loopback, không import app/server production hoặc khởi tạo AI/SMTP. Identity HTTP là fixture; không chứng nhận login thật. Đóng kết nối và chỉ dọn container có label/token sở hữu, gồm cả volume của chúng. Không dọn toàn Docker. Dùng cổng cố định đã chọn riêng cho từng lần chạy để client reconnect đúng cổng sau restart. Nếu tiến trình bị cưỡng chế tắt, kiểm tra label `jobfind.application-sync-test` trước dọn thủ công.

Browser cần build thêm `REACT_APP_APPLICATION_PROGRESS_ENABLED=true` cùng hai cờ thử 2x, rồi chạy `npm run test:candidate-browser:integration`. Windows có thể dùng `JOBFIND_TEST_BROWSER_CHANNEL=msedge`; CI cài Chromium. Không chạy lại bộ Compose 22 checkpoint hoặc bộ quản lý tin 360 nhóm trong đợt này, không cộng kết quả cũ.

## Phần tiếp tục

CV có cấu trúc ở Identity vẫn chưa tự đổi thành PDF hoặc đồng bộ hai chiều với file/hồ sơ ứng tuyển legacy. Tiếp theo là nối việc dùng CV đã chuẩn bị cho ứng tuyển bằng thao tác có chủ đích, giữ bản đã nộp và quyền sở hữu; sau đó nghiệm thu vai trò/dữ liệu lịch sử trên môi trường dự kiến. Email/Socket.IO thực, chất lượng AI, migration lớn, tải/SLO và phục hồi toàn hệ thống chưa được chứng nhận bởi đợt này.
