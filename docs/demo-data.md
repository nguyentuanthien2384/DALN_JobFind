# Bộ dữ liệu demo đầy đủ

Chạy ứng dụng bằng `npm start`, rồi từ thư mục gốc:

```powershell
npm run seed:demo-data -- --dry-run
npm run seed:demo-data
```

Lệnh mới bổ sung dữ liệu vào hệ thống local đang chạy, không import lại dump hay xóa dữ liệu hiện có. Cần cài dependencies của backend và microservices theo README. Cấu hình MySQL lấy từ `backend/.env`; PostgreSQL lấy tài khoản trong `microservices/.env`. Các kho dữ liệu và search-service phải sẵn sàng trước khi nạp.

## Có thể demo những gì

- **Tìm việc:** 8 công ty giả lập thuộc công nghệ, truyền thông, kinh tế, nhân sự, giáo dục, bất động sản, luật và logistics; mỗi công ty có 6 tin chi tiết. Tin gồm mô tả, nhiệm vụ, kỹ năng, kinh nghiệm, lương, địa điểm, quyền lợi, hạn nhận hồ sơ, tin nổi bật và hình thức làm việc.
- **Công ty đang dùng:** thêm 6 tin mang nhãn `[Demo]` cho mỗi công ty đã duyệt có tài khoản tuyển dụng hoạt động. Vì danh sách đối chiếu lọc theo công ty đăng nhập, bước này giúp các tài khoản cũ cũng có dữ liệu để chọn.
- **Tìm ứng viên và đối chiếu CV:** 72 ứng viên giả lập, đa dạng trình độ/kỹ năng/địa điểm/kỳ vọng lương, mỗi người có PDF đọc được và bật tìm việc. Có cả hồ sơ khớp tiêu chí và hồ sơ khớp một phần. PDF dùng tiếng Việt không dấu để không phụ thuộc font; giao diện và CV Builder giữ đầy đủ dấu tiếng Việt.
- **Quy trình tuyển dụng:** 18 hồ sơ mỗi công ty, chia đều 6 bước. Có lịch sử chuyển bước, đánh giá sao, ghi chú nội bộ, kho ứng viên tiềm năng, mẫu nội dung thư mời/từ chối. Bảng quy trình được lọc theo công ty đang đăng nhập.
- **Tài khoản ứng viên:** 2 bản CV Builder mỗi người, kinh nghiệm, học vấn, dự án, ngoại ngữ; việc làm đã lưu, theo dõi công ty và lịch sử ứng tuyển. Tài khoản demo cũ `0900000003` được bổ sung hồ sơ khi còn trống và 6 đơn ứng tuyển.
- **Tương tác:** 4 cuộc trao đổi mỗi công ty, mỗi cuộc có 3 tin nhắn và thẻ tin tuyển dụng; thông báo đã đọc/chưa đọc, 3 đánh giá công ty.
- **Giao dịch:** mỗi công ty có 2 đơn gói đăng tin và 2 đơn gói xem CV, với payment intent `provider=DEMO`. Đây là lịch sử mô phỏng; không gọi PayPal và không cộng/trừ hạn mức tài khoản cũ. Không dùng số liệu này làm doanh thu thật.

Trên bộ dữ liệu local ngày 27/09/2026: **23 công ty có dữ liệu, 138 tin mới, 72 ứng viên mới, 420 hồ sơ ứng tuyển, 1.330 sự kiện xử lý, 560 ghi chú, 146 CV Builder, 276 tin nhắn và 92 giao dịch mẫu**. Số lượng phụ thuộc các công ty/tài khoản đã có trước khi nạp.

## Tài khoản

Các tài khoản tạo mới dùng mật khẩu **`Demo@123456`**:

- Nhà tuyển dụng: `0918800001` đến `0918800008`.
- Nhân viên tuyển dụng cùng công ty: `0938800001` đến `0938800008`.
- Ứng viên: `0928800001` đến `0928800072`.

Đề xuất bắt đầu bằng nhà tuyển dụng `0918800001` (Sao Khuê Digital) và ứng viên `0928800001` (Nguyễn Minh An). Tài khoản cũ vẫn dùng mật khẩu hiện có; bộ tài khoản mặc định `0900000001/2/3` vốn dùng `123456`.

## Kịch bản trình diễn

1. Vào `/admin/list-candiate/`, chọn tin `[Demo] Frontend Developer React / TypeScript`, xem tiêu chí tự điền, thay đổi cách khớp kỹ năng và mở hồ sơ.
2. Trong `/admin/candiate/<id>`, mở PDF, xem lịch sử ứng tuyển, chọn tin trong **Tin tuyển dụng để đối chiếu**. Có thể dùng AI khi dịch vụ AI đã được cấu hình; lệnh seed không gọi AI hoặc tạo kết quả AI giả.
3. Mở `/admin/pipeline/`: xem đủ 6 cột, mở thẻ để đọc ghi chú/lịch sử; thao tác kéo thả và chấm sao như ứng dụng thông thường.
4. Đăng nhập ứng viên, xem CV Builder, việc làm đã lưu, công ty đang theo dõi, tin nhắn và `/candidate/cv-post`.
5. Mở trang lịch sử giao dịch, danh sách nhân sự công ty và dashboard quản trị để xem số liệu bổ sung.

CV demo đã được cấp quyền xem cho công ty nhận đơn, nên mở các hồ sơ này không tiêu hao thêm lượt của tài khoản cũ. Quy tắc cấp quyền với các hồ sơ khác vẫn do ứng dụng xử lý.

## Nạp lại và làm mới

Khóa ổn định trong bảng `jobfind_demo_records` liên kết bản mẫu với ID được cơ sở dữ liệu cấp. Chạy lại giữ nguyên mật khẩu, hồ sơ, nội dung tin và tiến trình tuyển dụng đã sửa; không tạo trùng tài khoản, đơn ứng tuyển, lịch sử, ghi chú hay giao dịch. Nếu một bản ghi chính thuộc bộ seed đã bị xóa, lệnh dừng để kiểm tra thay vì tự tái tạo sai liên kết.

Các bảng có quan hệ tự nhiên như kỹ năng, việc đã lưu, theo dõi công ty, đánh giá và quyền xem CV sẽ được bổ sung lại nếu thiếu. Bộ mẫu không reset các bảng này hoặc giảm hạn mức. Riêng tài khoản ứng viên demo cũ chỉ được thêm CV Builder nếu danh sách CV còn trống.

Tin mới được tạo với hạn nhận hồ sơ 60–85 ngày tính từ lần nạp đầu. Khi cần gia hạn chỉ các tin demo vẫn ở trạng thái hiển thị:

```powershell
npm run seed:demo-data -- --refresh-dates
```

Lệnh mặc định không gia hạn hoặc mở lại tin đã đóng. `--refresh-dates` đặt hạn mới 90 ngày; có thể kết hợp `--dry-run` để chỉ kiểm tra.

MySQL dùng một transaction. PostgreSQL dùng transaction riêng; MongoDB dùng cập nhật nguyên tử từng hồ sơ. Không có transaction chung giữa ba kho dữ liệu: nếu một bước sau MySQL thất bại, chạy lại cùng lệnh sẽ tiếp tục đồng bộ. Lệnh kiểm tra các kho trước khi ghi, đối chiếu lại quan hệ sau khi ghi và cập nhật Elasticsearch bằng cơ chế của search-service.

Mặc định dùng PostgreSQL `127.0.0.1:5435/application_db`, MongoDB `mongodb://127.0.0.1:27019`, container `ai-job-portal-search-service-1`. Có thể cấu hình `DEMO_PG_HOST`, `DEMO_PG_PORT`, `DEMO_PG_DATABASE`, `DEMO_MONGO_URL`, `DEMO_COMPOSE_PROJECT` cho stack local khác. Lệnh từ chối production và địa chỉ cơ sở dữ liệu ngoài máy local.

## Kiểm tra

```powershell
node --test backend/scripts/demo-data/*.test.cjs
npm --prefix backend test -- --runTestsByPath tests/utils/demoIdentity.test.cjs
npm --prefix backend run test:candidate-search
npm run test:demo-data
```

Kiểm tra cuối đăng nhập trên ứng dụng thật, mở các màn hình, kiểm tra PDF và các API; không gửi thư, thanh toán hay yêu cầu AI. Nó cần các tài khoản demo chưa đổi mật khẩu và bộ dữ liệu chưa thay đổi số thẻ chuẩn. API mở hồ sơ có thể cập nhật trạng thái đã đọc như thao tác thông thường. Trình duyệt kiểm tra dùng phiên riêng và đăng xuất khi xong.

Kết quả nạp nằm trong `.local/demo-data/report.json`, quan hệ ID trong `manifest.json`; ảnh kiểm tra trong cùng thư mục. Những file này không được đưa vào Git. Các SVG minh họa được sinh tại `frontend/public/demo/` và không cần dịch vụ hình ảnh bên ngoài.

Lệnh cũ `setup-demo-data.js` được giữ cho luồng phục hồi dump. Lệnh `npm run seed:demo-data` hiện trỏ đến bộ bổ sung mới và **không đặt lại mật khẩu toàn bộ tài khoản**.
