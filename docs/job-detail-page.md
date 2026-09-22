# Trang chi tiết tuyển dụng

Trang `/detail-job/:id` dùng bố cục theo ảnh tham chiếu: tiêu đề, logo và hai hành động phía trên; mô tả, yêu cầu, quyền lợi bên trái; công ty, thông tin chung và ứng tuyển bên phải. Dưới 760px, nội dung chuyển thành một cột.

## Dữ liệu và API

- `GET /api/get-detail-post-by-id?id=:id`: dùng lại `postDetailData`, `companyData`, `timeEnd`, `timePost`; bổ sung `data.applicationCount` là số CV trong bảng `Cvs` có `postId` tương ứng. Chỉ trả số lượng, không trả danh tính hay nội dung hồ sơ ứng viên. Truy vấn này chạy sau kiểm tra khả năng hiển thị tin/công ty hiện có.
- `GET /api/check-favorite-post?postId=:id`: lấy trạng thái đã lưu của phiên đăng nhập.
- `POST /api/toggle-favorite-post`: cập nhật trạng thái đã lưu; nút chặn thao tác lặp trong lúc chờ phản hồi. Backend xác định người dùng từ phiên xác thực.
- `POST /api/create-new-cv`: dùng lại hộp thoại gửi PDF và lời giới thiệu. Chỉ khi API xác nhận thành công mới đánh dấu đã nộp, xóa cache chi tiết của tin và lấy lại số lượt ứng tuyển. Đóng hộp thoại không đánh dấu đã nộp. Luồng outbox đồng bộ hồ sơ với application-service được giữ nguyên.

Không thêm bảng, migration, dependency hay biến môi trường. Frontend tiếp tục lấy địa chỉ API từ `REACT_APP_BACKEND_URL` (mặc định Gateway `http://localhost:4000`). Triển khai backend trước frontend để có số lượt ứng tuyển; nếu backend cũ chưa trả trường này, trang hiển thị “Chưa có số liệu”.

## Quy tắc hiển thị

### Xem công khai và tiếp tục ứng tuyển sau đăng nhập

Khách chưa đăng nhập được mở danh sách và chi tiết tin đã duyệt. Khi bấm “Nộp CV ngay”, trang đăng nhập hiển thị tên công việc và yêu cầu tài khoản ứng viên. Sau đăng nhập bằng mật khẩu, tài khoản liên kết hoặc hoàn tất đăng ký, người dùng quay lại đúng tin và mở form chọn CV. Hồ sơ chỉ được gửi khi người dùng bấm “Gửi hồ sơ” trong form.

Ngữ cảnh ứng tuyển được lưu riêng trong tab bằng `sessionStorage`, chỉ gồm mã tin, tiêu đề và thời điểm bắt đầu; hết hiệu lực sau 30 phút và được dùng một lần. Liên kết “Quay lại xem công việc” hủy ngữ cảnh này. Luồng lưu việc làm/nhắn tin không tự mở form CV. Không lưu mật khẩu hay nội dung CV trong ngữ cảnh chuyển trang.

Trang kiểm tra lại quyền và hạn nộp khi quay về. Tài khoản nhà tuyển dụng, công ty hoặc quản trị viên xem được tin nhưng không nộp CV; thông báo hướng dẫn dùng tài khoản ứng viên. Backend cũng kiểm tra quyền `candidate:apply` ngay tại middleware và kiểm tra lại vai trò trong transaction. Tin hết hạn hiển thị thông báo và không mở form.

Tham khảo: [TopCV – bước đăng nhập và ứng tuyển](https://www.topcv.vn/dieu-kien-giao-dich-chung), đối chiếu ngày 22/09/2026. Đây là lựa chọn luồng của JobFind; cách yêu cầu tài khoản có thể khác giữa các website tuyển dụng.

Nội dung HTML/Markdown hiện có được tách theo các tiêu đề mô tả, yêu cầu và quyền lợi. Nội dung chưa chia mục vẫn hiển thị nguyên phần mô tả; không tự thêm quyền lợi hoặc số liệu mẫu. HTML được giới hạn về định dạng và liên kết an toàn trước khi hiển thị.

“Lĩnh vực công việc” lấy từ danh mục công việc vì hồ sơ công ty chưa có trường ngành nghề riêng. Số lượng tuyển lấy từ `amount`, không dùng làm tổng số hồ sơ tối đa. Thanh tiến độ thể hiện thời gian nhận hồ sơ đã qua, chỉ xuất hiện khi có ngày bắt đầu và kết thúc hợp lệ.

Nộp CV bị vô hiệu khi tin hết hạn hoặc không ở trạng thái đã duyệt. Hạn được so sánh theo thời điểm, nên vẫn ứng tuyển được khi hạn còn vài giờ trong cùng ngày. Backend tiếp tục kiểm tra lại trước khi ghi hồ sơ. Trạng thái “Đã nộp CV” trên trang được ghi nhận ngay sau lần gửi thành công; tải lại trang vẫn được backend bảo vệ khỏi hồ sơ trùng.

Cache chi tiết được xóa khi token đăng nhập thay đổi để không dùng lại dữ liệu dành cho phiên có quyền cao hơn sau đăng xuất.

## Kiểm tra

`node backend/scripts/test-application-entry-browser.cjs` kiểm tra giao diện desktop/mobile, đăng nhập rồi tiếp tục ứng tuyển, quay lại từ đăng ký, hủy để tiếp tục xem, sai vai trò và tin hết hạn trong lúc đăng nhập. Script chạy các trang thật trên `JOB_TEST_WEB_URL` (mặc định `http://localhost:3001`), dùng API giả lập, không tạo tài khoản hay gửi CV thật. Ảnh kiểm tra lưu tại `.local/application-entry/`.

Kiểm tra ngày 22/09/2026: các suite liên quan đạt 183 test frontend, 201 test backend và 88 test microservices; 4 kịch bản trình duyệt đạt. Đã xác nhận khách mở tin “Tuyển dụng nhân sự 2” và đi đến đăng nhập bằng dữ liệu backend thật. Luồng đăng nhập/đăng ký tiếp tục ứng tuyển được kiểm tra bằng fixture; không gửi hồ sơ thật và không thực hiện xác thực tại nhà cung cấp SSO trong kiểm thử này.

Chạy các test trang chi tiết, bộ tách nội dung, cache, hộp thoại CV và service/controller tin tuyển dụng. Kiểm tra production build bằng script `build` sẵn có của frontend. Kiểm tra với cơ sở dữ liệu thật cần backend legacy và Gateway đang hoạt động; các unit test dùng API/model giả lập không thay thế bước đó.

Kết quả kiểm tra ngày 10/09/2026: 120 test backend và 66 test frontend liên quan đều đạt. Các test hộp thoại hiện vẫn có cảnh báo React về `act(...)`, không làm thất bại test. Backend/Gateway chưa hoạt động trong môi trường kiểm tra, nên chưa xác nhận luồng đầy đủ với cơ sở dữ liệu thật.
