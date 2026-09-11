# Chạy JobFind với dữ liệu trong cơ sở dữ liệu

## Khởi chạy

Trên máy hiện tại, bật Docker Desktop và MySQL/XAMPP (cổng `3333`, database `jobfindtest`). Từ thư mục gốc dự án:

```powershell
npm start
npm run dev:status
```

Lần đầu dựng image có thể mất vài phút. Khi trạng thái là `running`, mở:

- Ứng dụng: http://localhost:3001
- Gateway: http://localhost:4000
- Backend: http://localhost:5000

`npm start` chạy nền và không mở cửa sổ terminal mới. Chạy lại khi phiên đang hoạt động chỉ trả về trạng thái hiện tại. `npm run dev:stop` dừng backend/frontend và các dịch vụ ứng dụng thuộc JobFind; các kho dữ liệu và volume vẫn còn.

Có thể chọn cổng frontend/backend trước khi chạy bằng `JOBFIND_WEB_PORT` và `JOBFIND_BACKEND_PORT`. Gateway vẫn dùng cổng 4000. Cấu hình CORS và địa chỉ API được truyền đồng bộ theo cổng đã chọn. Không thay đổi hay dừng project Docker `job-portal` đang dùng cổng 3000.

## Điều kiện và cấu hình

Node.js 22 trở lên, Docker Compose hỗ trợ `!override`/`!reset`, và thư viện của frontend/backend/microservices cần có sẵn. Khi vừa tải source về máy khác, cài theo lockfile ở cả ba thư mục bằng `npm ci` (frontend có thể cần `npm ci --legacy-peer-deps` theo phiên bản npm).

Giữ cấu hình kết nối MySQL trong `backend/.env`, cấu hình cùng database trong `microservices/.env`; JWT_SECRET và INTERNAL_SECRET phải khớp giữa hai file. Không đưa các khóa này vào Git. Nếu database chưa tồn tại, trình khởi chạy báo lỗi để cấu hình/import có chủ đích; nó không ghi đè database bằng dữ liệu mẫu.

Trình khởi chạy dùng các container hạ tầng `ai-job-portal` hiện có. Khi hạ tầng chưa được tạo, chỉ các dịch vụ còn thiếu được tạo mới. Các ứng dụng dùng image vừa dựng từ source, không dùng thư mục node_modules Windows trong container Linux.

Sau khi tắt máy, mở lại Docker Desktop và MySQL rồi chạy lại `npm start`. Trình khởi chạy không đăng ký tự động chạy cùng Windows.

## Dữ liệu và đồng bộ

Trang tìm việc, công ty, đăng nhập, lưu tin và nộp CV gọi Gateway rồi đến các API và cơ sở dữ liệu của dự án. Không có API giả trong luồng này.

CV được lưu trong MySQL cùng yêu cầu phát sự kiện trong một giao dịch. Job Core chuyển sự kiện qua RabbitMQ; Application Service nhập và đối chiếu hồ sơ sang PostgreSQL để dùng cho Kanban. Search đối chiếu tin sang Elasticsearch. Notification lưu thông báo và đẩy cập nhật trong ứng dụng; Admin đọc dữ liệu và nhật ký thật.

Ở lần kiểm tra đầu ngày 10/09/2026, MySQL có **38 tài khoản, 17 công ty, 41 tin tuyển dụng, 6 hồ sơ ứng tuyển**. Các bản ghi này là dữ liệu đã có trong môi trường dự án; nhiều bản ghi có nguồn gốc bộ dữ liệu mẫu trước đây, không phải tin đang được xác minh từ thị trường tuyển dụng. Tất cả 41 tin đã hết hạn. Hệ thống giữ đúng ngày cũ; muốn nhận hồ sơ mới, nhà tuyển dụng đăng mới/đăng lại và quản trị viên duyệt theo quy trình hiện có.

Ba tài khoản thử được ghi trong `database/README_DATA.md` là `0900000001` (quản trị), `0900000002` (công ty) và `0900000003` (ứng viên), mật khẩu của bộ dữ liệu mẫu là `123456`. Trình khởi chạy không đặt lại mật khẩu hoặc tạo lại những tài khoản này.

Các cờ tạo/sửa/đăng lại/tìm kiếm/CV tiếp tục dùng cấu hình frontend hiện có. Các tính năng AI cần khóa provider riêng, không được bật chỉ vì ứng dụng đã chạy. Thanh toán cần cấu hình PayPal riêng.

## Email và tác vụ định kỳ

Phiên local này không gửi email ra ngoài: thông tin SMTP được bỏ khỏi môi trường chạy; email của Notification được giữ chờ khi thiếu cấu hình. Các thông báo trong ứng dụng và đồng bộ dữ liệu vẫn hoạt động. Hai lịch gửi gợi ý việc làm/reset lượt xem CV được tắt bằng `SCHEDULED_JOBS_ENABLED=false`.

Để triển khai gửi email thật, cấu hình và chạy bằng quy trình dịch vụ thủ công, xem xét các email đang chờ trước khi bật. Những thông tin đăng nhập SMTP đã lưu trong `.env` không bị sửa bởi trình khởi chạy.

## Kiểm tra và nhật ký

```powershell
npm run dev:check
npm run dev:status
```

`dev:check` đối chiếu danh sách/chi tiết/số lượt ứng tuyển từ API với MySQL và kiểm tra điều kiện giao dịch CV. Không tự tạo ứng tuyển vào tin của nhà tuyển dụng. Thiếu tin còn hạn là trạng thái dữ liệu, không phải lỗi kết nối API.

Danh sách công khai chỉ tính tin đã duyệt có người đăng đang hoạt động và công ty đang hoạt động/đã duyệt; tin không đáp ứng điều kiện không làm tăng tổng số trang. Tin hết hạn vẫn xem được để tra cứu, nhưng không được nhận CV mới.

Nhật ký nằm trong `.local/runtime.log`, `.local/backend.log`, `.local/frontend.log`, `.local/docker.log`; toàn bộ `.local` được bỏ qua trong Git. Khi khởi động thất bại, trạng thái nêu thành phần cần kiểm tra.

### Kết quả kiểm tra trên máy ngày 11/09/2026

- Giao diện trang chủ/chi tiết trả HTTP 200, biên dịch thành công và dùng Gateway cổng 4000; CORS chấp nhận giao diện cổng 3001.
- Cả 7 dịch vụ ứng dụng đều sẵn sàng. Danh sách API khớp MySQL: 25 tin công khai, 15 công ty công khai; chi tiết tin khớp số CV thực tế.
- Đăng nhập tài khoản thử của cả 3 vai trò thành công; đọc được báo cáo quản trị, bảng hồ sơ của công ty và lịch sử ứng tuyển của ứng viên.
- Đã thử lưu việc làm qua API, đối chiếu bản ghi trong MySQL rồi trả trạng thái lưu về như trước khi thử.
- PostgreSQL có 6 hồ sơ, tương ứng 6 mã CV MySQL riêng biệt. Chưa gửi hồ sơ mới vì không có tin còn hạn; kết quả này không thay thế kiểm thử nộp CV mới vào một tin đang mở.
- Ba tệp sao lưu đều khớp SHA-256 trong manifest. Chưa thực hiện diễn tập khôi phục dữ liệu.
- Đã thử chạy lại lệnh khởi động khi hệ thống đang chạy, dừng ứng dụng rồi khởi động lại thành công. Kho dữ liệu được giữ nguyên; các kiểm tra API, đăng nhập và lưu việc làm tiếp tục đạt sau khi chạy lại. Bộ kiểm tra trình khởi chạy/đối chiếu dữ liệu đạt 15/15.

## Sao lưu

Mỗi lần khởi chạy mới tạo một thư mục thời gian trong `.local/backups`: `mysql.sql` là snapshot InnoDB UTF-8 có dữ liệu BLOB, `postgres.dump` là bản xuất PostgreSQL, `mongo.archive.gz` là bản xuất MongoDB; `manifest.json` có số bản ghi và SHA-256 của từng tệp.

Các bản sao chứa dữ liệu cá nhân của dự án: giữ tại máy hoặc nơi lưu trữ riêng. Chúng phục vụ khôi phục có chủ đích sang database trống; trình khởi chạy không tự nhập lại, không xóa volume và không tự đổi dữ liệu lịch sử. Đây là bản sao dữ liệu các DB, không phải snapshot nguyên tử toàn bộ hệ thống/hàng đợi; khi khôi phục hệ thống đang có giao dịch cần dừng writer và đối chiếu outbox/broker.
