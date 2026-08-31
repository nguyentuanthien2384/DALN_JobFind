# Phân quyền và kiểm soát truy cập

Tài liệu này mô tả chính sách phân quyền đang được áp dụng thống nhất tại backend legacy, API Gateway, microservices và giao diện React.

## Nguyên tắc bắt buộc

- Backend là nguồn quyết định cuối cùng. Việc ẩn menu hoặc chặn route ở frontend chỉ phục vụ trải nghiệm người dùng, không thay thế kiểm tra ở API.
- Mỗi request có JWT đều được nạp lại tài khoản và công ty từ MySQL. Việc đổi vai trò, khóa tài khoản hoặc duyệt/khóa công ty có hiệu lực ở request kế tiếp, không phụ thuộc vai trò cũ trong token.
- Một quyền không được khai báo phải bị từ chối theo nguyên tắc fail-closed.
- Dữ liệu công ty luôn được giới hạn bằng `companyId` lấy từ tài khoản đã xác thực; không tin `companyId`, `userId` hoặc `roleCode` do client gửi lên.
- Các thao tác trên tài nguyên còn kiểm tra chủ sở hữu: hồ sơ cá nhân, CV, tin đăng, hồ sơ ứng tuyển, thành viên công ty, giao dịch và cuộc trò chuyện.
- `401` dùng cho request chưa đăng nhập hoặc phiên không còn hợp lệ. `403` dùng cho tài khoản hợp lệ nhưng không có quyền.
- Endpoint public chỉ trả trường dữ liệu public và chỉ hiển thị công ty/tin đăng đã hoạt động, đã duyệt.
- Các tác vụ AI phía ứng viên chỉ nhận tin tuyển dụng đang công khai; ID của tin chờ duyệt/từ chối không thể dùng để đọc nội dung gián tiếp.

## Trạng thái công ty

Quyền tuyển dụng chỉ được kích hoạt khi công ty đồng thời có:

- `statusCode = S1` — đang hoạt động.
- `censorCode = CS1` — đã được quản trị viên duyệt.

Công ty chờ duyệt, bị từ chối hoặc bị khóa không được đăng tin, tìm/xem dữ liệu ứng viên, mua gói, xem giao dịch hoặc dùng chat tuyển dụng. Chủ công ty vẫn có thể cập nhật thông tin xác minh; thành viên vẫn có thể rời công ty.

## Vai trò

### `ADMIN`

- Quản lý tài khoản, danh mục dùng chung và gói dịch vụ.
- Duyệt/khóa công ty và tin tuyển dụng.
- Xem dashboard, báo cáo hệ thống và dữ liệu phục vụ quản trị.
- Không được dùng chat tuyển dụng và không mặc nhiên thao tác thay một tenant công ty.
- Chỉ `ADMIN` được gán mọi vai trò; khi gán công ty cho tài khoản chỉ chấp nhận vai trò `COMPANY` hoặc `EMPLOYER`.

### `COMPANY`

Đây là chủ/quản lý công ty.

- Khi công ty chưa được duyệt: quản lý hồ sơ cá nhân và cập nhật hồ sơ công ty.
- Khi công ty đã được duyệt: quản lý công ty, đội ngũ tuyển dụng, tin đăng, ứng viên thuộc công ty, gói dịch vụ, lịch sử giao dịch và chat.
- Chỉ được quản lý thành viên cùng `companyId`.
- Chỉ được đổi vai trò thành viên cùng công ty giữa `COMPANY` và `EMPLOYER`; không thể tự đổi vai trò của chính mình.

### `EMPLOYER`

Đây là nhân viên tuyển dụng.

- Khi chưa thuộc công ty: được tạo một công ty và quản lý hồ sơ cá nhân.
- Sau khi tạo công ty: tài khoản được chuyển thành `COMPANY`; quyền tuyển dụng chỉ mở sau khi công ty được duyệt.
- Khi thuộc công ty đã duyệt: quản lý tin đăng, pipeline/ứng viên của đúng công ty và chat.
- Không được quản lý thông tin công ty, đội ngũ, gói dịch vụ hoặc lịch sử giao dịch.

### `CANDIDATE`

- Quản lý hồ sơ và CV của chính mình.
- Ứng tuyển, lưu tin, theo dõi/đánh giá công ty và nhận gợi ý việc làm.
- Chỉ có thể ứng tuyển/lưu tin đang công khai thuộc công ty hoạt động, đã duyệt; tin hết hạn và lần ứng tuyển trùng bị chặn ở cả service lẫn ràng buộc cơ sở dữ liệu.
- Chỉ có thể theo dõi/đánh giá công ty đang hoạt động, đã duyệt; danh sách cá nhân tự loại tài nguyên đã bị ẩn và chỉ trả trường recruiter công khai.
- Theo dõi lịch sử ứng tuyển, thông báo và chat với nhà tuyển dụng.
- Chat chỉ cho phép cặp ứng viên ↔ `COMPANY`/`EMPLOYER` thuộc công ty đang hoạt động và đã duyệt; không cho nhắn cùng vai trò, tài khoản bị khóa hoặc recruiter của công ty không hợp lệ.
- Không truy cập khu quản trị hoặc dữ liệu ứng viên khác.

## Quyền backend legacy

Chính sách tập trung nằm tại `backend/src/middlewares/authorize.js` với các mã quyền:

- Tài khoản: `account:self`, `administration:manage`.
- Công ty: `company:create`, `company:private:read`, `company:manage`, `company:team:manage`, `company:team:exit`.
- Tuyển dụng: `job:manage`, `recruitment:read`, `recruitment:report:read`, `candidate:profile:read`, `candidate:search`.
- Ứng viên: `candidate:apply`, `recommendation:read`, `social:interact`.
- Gói dịch vụ: `package:catalog:read`, `package:purchase`, `package:history:read`.
- Dùng chung: `notification:read`, `chat:use`.

Middleware quyền chỉ xác nhận vai trò và điều kiện công ty. Các hàm tại `backend/src/utils/authorization.js` tiếp tục xác nhận quyền sở hữu tài nguyên và tenant trước khi controller/service thực thi.

`GET /api/auth/me` trả danh tính hiện tại, trạng thái duyệt/hoạt động của công ty và danh sách mã quyền backend đã được cấp. Endpoint này hữu ích khi kiểm tra phiên đăng nhập và chẩn đoán lỗi `403`.

## Gateway và microservices

- Gateway xác minh JWT rồi nạp lại tài khoản/công ty từ MySQL.
- Mọi header định danh do trình duyệt gửi như `x-user-id`, `x-user-role`, `x-company-id` và các header trạng thái công ty đều bị xóa trước khi gateway gắn danh tính tin cậy.
- Gateway chặn path mã hóa bất thường, dot-segment, encoded slash/backslash và các biến thể có thể làm request bị chuẩn hóa sang endpoint nội bộ.
- Mọi URL public chứa segment `internal` đều bị chặn, kể cả khi segment nằm sau prefix service hoặc được mã hóa nhiều lớp.
- Chỉ gateway gửi `x-internal-secret` tới microservice cần thiết. Backend legacy không nhận secret nội bộ từ proxy.
- Mỗi microservice vẫn tự kiểm tra vai trò, quyền và tenant; không chỉ dựa vào việc route đã đi qua gateway.
- Khi trạng thái duyệt/hoạt động của công ty đổi, backend phát `company.updated`; Search Service cập nhật toàn bộ tin của tenant và luôn lọc đồng thời trạng thái tin lẫn trạng thái công ty.
- `JWT_SECRET` phải có tối thiểu 32 ký tự, đủ độ ngẫu nhiên và không được là khóa mẫu; backend/Gateway từ chối khởi động nếu cấu hình yếu. File Compose không còn khóa mặc định.
- Các cổng cơ sở dữ liệu/cache/message broker dùng cho phát triển chỉ bind vào `127.0.0.1`; không công khai trực tiếp ra LAN. RabbitMQ và PostgreSQL lấy mật khẩu từ file `.env` bị Git bỏ qua.

## Giao diện

Ma trận quyền giao diện nằm tại `frontend/src/auth/accessControl.js`.

- `RouteGuard` bảo vệ khu candidate, khu quản trị, chat và từng trang chức năng.
- Khi ứng dụng khởi động, frontend đồng bộ lại phiên qua `GET /api/auth/me`. Phiên cũ chưa lưu trạng thái công ty sẽ được nâng cấp an toàn; nếu không xác minh được thì giao diện giữ trạng thái fail-closed thay vì dùng quyền đã lưu cũ.
- Menu, liên kết nhanh và API nền như số tin nhắn chưa đọc chỉ hoạt động khi người dùng có quyền tương ứng.
- Truy cập sai quyền chuyển tới `/forbidden`; trang này điều hướng người dùng về đúng khu vực theo vai trò.
- Frontend không được dùng để cấp quyền. Mọi request vẫn phải vượt qua kiểm tra backend/gateway.
- CTA ứng tuyển/lưu tin/theo dõi/đánh giá chỉ hiện cho `CANDIDATE` sau đăng nhập; menu của công ty chờ duyệt chỉ còn thông tin công ty, không lộ liên kết quản lý nhân sự.

## Đăng ký và thay đổi vai trò

- Khách chỉ tự đăng ký `CANDIDATE` hoặc `EMPLOYER`; mọi `companyId` tự gửi trong request đăng ký đều bị bỏ qua.
- Chủ công ty đã xác thực chỉ tạo thành viên cho chính công ty và chỉ với vai trò `COMPANY`/`EMPLOYER`.
- Chủ công ty chỉ được tạo thành viên sau khi công ty đang hoạt động và đã được duyệt; route đăng ký dùng chung cũng áp dụng điều kiện này.
- `ADMIN` có thể tạo tài khoản với bốn vai trò hợp lệ.
- Người dùng không thể thay đổi `roleCode` của chính mình qua API cập nhật hồ sơ.
- Việc kiểm tra vai trò diễn ra trước khi lưu hồ sơ để request sai quyền không gây cập nhật một phần.

## Quy trình thêm chức năng mới

1. Xác định rõ vai trò, trạng thái công ty và tenant/chủ sở hữu được phép thao tác.
2. Khai báo mã quyền trong ma trận backend hoặc shared microservice; không viết điều kiện vai trò rải rác nếu có thể dùng chính sách tập trung.
3. Gắn middleware xác thực và quyền vào route.
4. Lấy danh tính/tenant từ request đã xác thực, không lấy từ payload client.
5. Thêm kiểm tra sở hữu tài nguyên tại controller/service trước khi đọc hoặc ghi.
6. Bổ sung quyền frontend, `RouteGuard` và điều kiện menu nếu có giao diện.
7. Viết test cho tối thiểu: chưa đăng nhập (`401`), sai vai trò (`403`), đúng vai trò, sai tenant, đúng tenant, công ty chờ duyệt/bị khóa và payload giả mạo danh tính.
8. Chạy unit test, coverage, build và smoke test qua gateway trước khi bàn giao.

## Lệnh kiểm tra

Từ thư mục gốc:

```powershell
npm test
npm run test:coverage
```

Kiểm tra riêng từng lớp:

```powershell
cd backend; npm test
cd ..\frontend; npm run test:unit
cd ..\microservices; npm test
```
