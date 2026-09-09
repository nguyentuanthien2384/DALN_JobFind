# Nghiệm thu giao diện với API Compose thật — 2ab

Chạy từ thư mục `microservices`, sau khi cài dependencies frontend và microservices, chuẩn bị các image hạ tầng trong [hướng dẫn Compose](compose-background-acceptance.md):

```powershell
# Windows có Edge; bỏ biến này nếu dùng Chromium do Playwright cài.
$env:JOBFIND_TEST_BROWSER_CHANNEL='msedge'
npm run test:compose-browser:integration
```

CI cài Chromium bằng `npx --no-install playwright install --with-deps chromium` và chạy cùng lệnh nghiệm thu. Lệnh này bao gồm các phase HTTP/nền 2aa; không cần chạy lại lệnh background riêng trước nó.

## Cách chạy

Runner tạo production build frontend vào thư mục tạm sở hữu, bật ba cờ AI/tiến trình/CV đã chuẩn bị và chọn Core Search chỉ trong tiến trình build thử. Không ghi `.env`, không thay `frontend/build` đang có và không bật tính năng trên stack phục vụ người dùng.

Trình duyệt dùng frontend/App/router/RouteGuard/Axios thật, đăng nhập qua biểu mẫu bằng mật khẩu của tài khoản tổng hợp. Không chèn token hay localStorage, không giả phản hồi API. Máy chủ static chỉ chuyển `/api` tới ingress thử trên cổng ngẫu nhiên `127.0.0.1`, rồi ingress chuyển tới Gateway thật. Playwright chỉ chặn request ra ngoài origin thử.

Docker không công bố cổng trực tiếp từ mạng internal trong môi trường thử này. Vì vậy chỉ ingress có thêm mạng browser, chỉ chuyển tới một đích Gateway cố định. Tám dịch vụ (gồm Gateway), backend legacy, DB/broker và AI HTTP mô phỏng vẫn chỉ gắn mạng internal; không container nào khác mở cổng host. Không dùng cấu hình/volume/secret/Docker socket của stack thật.

Fixture legacy bổ sung bảng/cột theo Sequelize models, bỏ foreign key khi dựng dữ liệu thử để giữ được các hồ sơ lịch sử thiếu liên kết. Đây là DDL trên DB `acceptance` mới, không phải migration hoặc sửa dữ liệu thật. Entrypoint legacy dùng router, xác thực, phân quyền, controller và ORM thật; Socket.IO/SMTP/lịch nền legacy không khởi động. AI Worker dùng SDK thật tới provider HTTP tổng hợp trong mạng internal.

## Phạm vi kiểm tra

- Đăng nhập ứng viên → gửi tác vụ parse PDF → chờ kết quả worker → sửa họ tên/nội dung tiếng Việt → lưu CV Identity/MongoDB.
- Mở lại kết quả tác vụ sau khi rời trang mà không gửi parse lần nữa; dùng CV đã lưu để đánh giá độ phù hợp, tạo thư ứng tuyển và sửa nội dung thư.
- Tìm từ khóa không có kết quả, xóa từ khóa và lọc hình thức làm việc bằng giao diện với Elasticsearch thật.
- Tìm việc qua Core Search → mở chi tiết tin legacy → chọn CV đã lưu → tạo/xem PDF → xác nhận và nộp bằng giao diện điện thoại. Chỉ xem PDF không được gửi ứng tuyển.
- Đối chiếu đúng bytes trong POST với PDF đã xem, ID hồ sơ legacy trong lịch sử và tiến trình từ Application qua outbox/relay/RabbitMQ thật.
- Nhân viên cùng công ty đăng nhập, lọc tin, kéo thả Kanban sang “Phỏng vấn”, tải lại trang, ghi chú nội bộ và mở tệp CV. PDF đọc lại phải bằng tệp đã xem trước khi nộp.
- Ứng viên tải lại lịch sử, thấy tiến trình và trạng thái đọc độc lập, mở CV của mình và không thấy ghi chú nhà tuyển dụng. Trên viewport điện thoại, các nút mở/tải PDF hiện rõ, không tràn ngang; file tải xuống phải bằng PDF đã xem và đã nộp.
- Sửa/xóa CV nguồn, khởi động lại Application/Identity/legacy rồi kiểm tra lại tệp đã nộp và tiến trình.
- Công ty khác không thấy hồ sơ/Kanban và nhận lỗi quyền khi đọc PDF, không hiện iframe/link tệp; ứng viên bị chặn khi mở trang quản lý tuyển dụng. Hồ sơ lịch sử thiếu ứng viên/tệp có thông báo rõ ràng.

Ảnh màn hình và PDF tổng hợp được giữ trong thư mục `jobfind-compose-ui-*` được in ở cuối bài chạy để nghiệm thu trực quan. Không lưu mật khẩu/token vào báo cáo. Container, mạng, volume, image và bản dựng tạm thuộc project được dọn trong `finally`, kể cả khi assertion lỗi. Nếu tiến trình bị tắt cưỡng chế, cần kiểm tra project label trước khi dọn tài nguyên còn sót.

## Sửa giao diện phát hiện qua nghiệm thu

Trang xem CV legacy trước đây nhúng trực tiếp data URI vào iframe và hiển thị khung trống trên viewport điện thoại. `UserCv` nay tạo URL Blob cho PDF đã nộp, có nút mở/tải riêng; desktop vẫn có khung xem, mobile dùng các thao tác mở/tải trong bố cục đủ chiều rộng. URL được thu hồi khi đổi tệp, rời trang hoặc kết thúc phiên.

Màn hình cũng hiển thị lỗi/tải lại khi API từ chối, bỏ phản hồi muộn của hồ sơ/phiên cũ và xử lý ứng viên hoặc tệp lịch sử không còn tồn tại. Dữ liệu đính kèm sai định dạng không được đưa vào iframe. Đây là kiểm tra hiển thị phía client, không thay thế kiểm tra nội dung tệp phía server. Không đổi endpoint, schema hoặc cờ mặc định.

## Giới hạn

Bài này kiểm tra luồng CV–ứng tuyển–tiến trình được nêu trên với dữ liệu tổng hợp. Không chứng nhận SMTP/Socket.IO, chất lượng AI, thanh toán, tải/SLO, backup/restore hoặc migration dữ liệu thật. Kích thước mobile là viewport Chromium, không thay thế thử trên thiết bị iOS/Android thực. Việc pass không tự bật cờ hoặc triển khai lên môi trường đang phục vụ.

## Kết quả ngày 09-09-2026

- Project `jobfind-accept-24d843b9`: **PASS 7 nhóm browser + 32 checkpoint HTTP/nền hiện có + 1 bước chuẩn bị fixture browser** (40 dòng PASS). Toàn bộ bài gồm consumer/broker outage, phục hồi, phân quyền sau restart, kiểm tra mạng và shutdown đã hoàn tất; container/network/volume/image thuộc project không còn sau cleanup.
- **1.388 frontend test / 69 suite**, gồm 5 ca mới cho trang xem CV; **1.133 microservices test / 59 file** qua. HTTP/event contracts, syntax các script, YAML và diff check qua. Production frontend bật cờ đã được build vào thư mục tạm trong bài Compose. Không cộng lại 789 backend test lịch sử chưa chạy trong đợt này.
- Browser chạy Edge headless trên Windows, desktop 1365×1000 và mobile 390×844; không có page error hoặc API 5xx ngoài các lỗi nền chủ động của phase HTTP. Công ty ngoài nhận 403 là kết quả mong đợi. Đã mở PDF ở tab mới, tải file qua nút giao diện, đọc lại sau sửa/xóa CV nguồn và restart.
- PDF **15.760 byte / 2 trang**, SHA-256 `435ab7ae40844d2fca1f1e05b6040791ddab3a62860e559f5e3d00f5818fa7c1`. Tệp gửi, đọc lại và tải xuống bằng nhau. Đã render cả hai trang và kiểm tra trực quan: tên Nguyễn Thị Ánh, dấu tiếng Việt, đủ 28 đoạn giới thiệu thử, không cắt nội dung. Ảnh mobile review/viewer và desktop PDF/Kanban đã xem lại; ghi chú nội bộ đã lưu thật.
- Bằng chứng cục bộ: `C:\Users\Admin\AppData\Local\Temp\jobfind-compose-ui-LZAPj9` gồm ảnh, PDF xem/tải và `evidence.json` chỉ chứa metadata request, ID tổng hợp, checksum và kết quả. Thư mục này có thể bị hệ điều hành dọn; chạy lại lệnh ở đầu tài liệu để tái tạo.

CI đã cấu hình cài Chromium và chạy bài này, chưa push/chạy workflow trên GitHub. Không đổi `.env`, schema/dữ liệu/container phục vụ hoặc cờ mặc định. Bước tiếp theo là đối chiếu điều kiện schema, reader/relay/writer và phương án rollback theo [local-compose.md](local-compose.md) trên môi trường dự kiến áp dụng, rồi nghiệm thu trước khi bật từng cờ. Đây chưa phải xác nhận mọi trang của toàn bộ sản phẩm hoặc mọi biến thể giao diện legacy đã qua E2E.
