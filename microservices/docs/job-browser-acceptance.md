# Kiểm thử xuyên màn hình quản lý tin — đợt 2v

Mục tiêu: kiểm tra các phần 2a–2u khi đi cùng nhau, không chỉ kiểm tra từng helper/màn hình độc lập. Bộ mới dùng ba component thật AddPost, ManagePost, NotePost, modal thật, router/RouteGuard, storage và Axios thật trong trình duyệt.

## Chạy trên máy phát triển

Cần Node 22+, Docker, dependencies theo lockfile của cả `backend`, `frontend`, `microservices`. Chạy từ `microservices`:

```powershell
npx --no-install playwright install chromium
docker pull mysql:8.0
docker pull redis:7-alpine
npm run test:job-browser:integration
```

Playwright được ghim phiên bản trong devDependencies; không thêm vào image runtime. Khi máy đã có Chrome/Edge và cần kiểm tra trình duyệt đó, đặt `JOBFIND_TEST_BROWSER_CHANNEL=chrome` hoặc `msedge` cho riêng tiến trình test. Không cần tài khoản/mật khẩu dự án, API key AI hay sửa `.env`. Việc cài browser tải binary phục vụ kiểm thử từ nhà cung cấp, không gửi dữ liệu ứng dụng; xem [Playwright browser installation](https://playwright.dev/docs/browsers).

Lệnh mặc định chạy lại 348 nhóm MySQL hiện có trước, rồi mới chạy các hành trình trình duyệt. Lệnh cũ `test:job-writes:integration` không cần trình duyệt/Redis và vẫn chạy độc lập. CI thêm bước cài Chromium và chạy bộ mới sau khi cài dependencies frontend; không push hay thực thi workflow từ máy phát triển.

## Nối với các bước trước

- 2a–2c, 2l–2m: tạo/đăng lại trừ đúng lượt; lưu ý định trước khi gửi; mất phản hồi sau commit phải giữ mã và không tạo bản trùng khi đối chiếu.
- 2b, 2d–2e: list → private editor dùng snapshot/revision thật; sửa giữ tác giả, hạn và loại tin; bản đăng lại không lấy nháp chưa lưu.
- 2f–2q: sửa thực sự quay về pending; no-op không ghi/request mới; AI cũ không áp dụng vào phiên bản mới; ADMIN quyết định manual và ghi chú trên backend cũ.
- 2r–2t: receipt/writer/key/payload được giữ qua chuyển màn hình và tải lại bundle legacy/Core; GET list/review không thay receipt; PUT chưa rõ không tự gửi lại.
- 2u và đồng bộ phiên đợt 1: workspace riêng tư, quyền công ty hiện tại tại Gateway, chống giả header, candidate/ADMIN/khác công ty, lỗi phiên và dữ liệu cũ.

## Những phần thật và phần mô phỏng

Gateway chạy **nguyên app production** ở tiến trình con, JWT HS256 đúng issuer/audience/TTL, đọc quyền hiện tại từ MySQL thật, Redis rate limiter và HTTP proxy thật. Job Core dùng HTTP controller/contract/permission/transaction thật trong fixture hiện có. Các lệnh legacy dùng controller/service/Sequelize thật; các route cần cho fixture được đăng ký riêng, dùng middleware xác thực Gateway để gắn identity tương thích, **không phải toàn bộ middleware đăng nhập legacy**.

Frontend test entry nằm ngoài `src`, không nhập vào bản phục vụ người dùng. Có hai bundle test với bốn cờ Core hoặc bốn cờ legacy; cookie test chọn bundle trên cùng origin nhằm giữ sessionStorage khi kiểm tra rollback. Không có công tắc runtime này trong sản phẩm. Shell điều hướng/style tối thiểu chỉ phục vụ test; không thay App/HomeAdmin/navigation thật.

Tài khoản/phiên được chuẩn bị bằng token thử, không đi qua form login. Danh mục và hạn mức hiển thị đọc từ DB thử qua adapter HTTP nhỏ. Kết quả AI được đưa vào handler bằng dữ liệu tổng hợp; thời gian trôi qua/hết hạn được chuẩn bị trực tiếp trong DB thử. Kịch bản mất phản hồi gửi request đến server thật rồi hủy phản hồi ở trình duyệt sau khi server đã commit; không dựng receipt thành công giả.

## Cách ly và dọn dẹp

- Không nhận URL/database tùy ý từ command line, không đọc `.env` thật; kiểm tra tên database/password của fixture sở hữu trước bổ sung schema tổng hợp.
- MySQL và Redis dùng container mới, port loopback ngẫu nhiên và nhãn sở hữu theo từng lần chạy. Không dùng project/volume Compose đang phục vụ người dùng. Chỉ dọn container khi ID và nhãn đúng; không `down -v` hoặc purge hàng đợi thật.
- Gateway con nhận environment theo allowlist; mọi URL dịch vụ trỏ vào fixture loopback. Không kế thừa provider key, DB/Redis URL hay proxy từ shell. Không khởi chạy relay, worker, Notification/SMTP, Search hoặc PayPal. Intent/outbox vẫn lưu thật nhưng không được gửi đến bên ngoài.
- Browser dùng context tạm, không dùng hồ sơ cá nhân; request ngoài origin fixture bị chặn. Bundle test tạo trong thư mục tạm có tên riêng, kiểm tra đường dẫn trước khi dọn; không ghi đè `frontend/build`.
- Khi kết thúc/lỗi thông thường: đóng browser, dừng Gateway, đóng HTTP/DB và dọn dữ liệu dùng một lần. Nếu tiến trình bị cưỡng bức tắt/mất điện, không bảo đảm finally đã chạy; cần kiểm tra đúng container/nhãn trước khi dọn thủ công.

## Giới hạn nghiệm thu

Ngày 08-09-2026: 12 nhóm browser integration Chromium cùng 348 nhóm MySQL trước đó qua (360 tổng cộng). 3.223 test hồi quy backend/frontend/microservices qua; contracts, syntax, lint test entry, parse YAML CI và production build legacy qua. Không có lỗi JavaScript chưa xử lý hoặc request ngoài origin fixture trong lần nghiệm thu thành công. Các lỗi chuẩn bị fixture đã được sửa trước mốc này, không dùng lần chạy lỗi để đánh dấu pass.

Đây là browser integration của luồng quản lý tin, **không phải E2E toàn bộ Docker Compose**. Chưa chứng minh form login/App shell/CORS triển khai thật, queue → AI provider → Search/Notification, ứng tuyển/CV, thanh toán, phục hồi dữ liệu hoặc hiệu năng tải lớn. API auth của Gateway được thử thật không có nghĩa login/refresh/revocation đầy đủ đã xong.

Kết quả pass không tự bật cờ Core, không cho phép bỏ kiểm tra backup/schema tương thích, không giải quyết mọi mục PDF. Bước tiếp theo là ráp và nghiệm thu cấu hình Compose local cách ly với chuỗi xử lý nền, dùng provider giả; chỉ sau đó mới xét bật từng cờ trên môi trường đang dùng. Thứ tự/rollback writer và dữ liệu của 2q–2u trong `client-sync.md` vẫn giữ nguyên.
