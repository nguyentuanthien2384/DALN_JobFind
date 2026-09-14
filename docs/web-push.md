# Web Push và đồng bộ thông báo

Phạm vi được xác nhận: website Job Finder, không có ứng dụng Android/iOS native. Web Push hiện áp dụng cho **tin nhắn chat mới chưa đọc**. Thông báo nghiệp vụ như CV/bài đăng tiếp tục dùng danh sách thông báo trong ứng dụng và Socket.IO; không tự gửi các thông báo đó ra thiết bị.

## Sử dụng

1. Đăng nhập và mở **Tin nhắn**. Trong mục **Thông báo khi rời trang**, chọn **Bật thông báo**, rồi cho phép trong trình duyệt.
2. Khi có tin nhắn chưa đọc, thông báo chỉ hiển thị “Bạn có tin nhắn mới. Mở Job Finder để xem.”, không chứa nội dung chat hoặc tên người gửi.
3. Nhấn thông báo để mở đúng cuộc trò chuyện. Nếu cần đăng nhập lại, cơ chế điều hướng của ứng dụng giữ đường dẫn nội bộ.
4. **Tắt thông báo** chỉ tắt thiết bị/trình duyệt hiện tại. Đăng xuất, hết phiên khi đang mở trang và đổi tài khoản cũng xóa chủ sở hữu lưu ở service worker và hủy đăng ký trình duyệt. Các tab dùng Web Locks để phối hợp thay đổi thiết bị; có hàng đợi trong tab khi trình duyệt thiếu API này.
5. Nếu quyền bị chặn, mở lại quyền trong cài đặt trình duyệt. Nếu thiết bị hết hạn hoặc bị dịch vụ push thu hồi, giao diện cho phép bật lại; không báo “đã bật” chỉ dựa vào dữ liệu local cũ.

Website triển khai phải dùng HTTPS. `localhost` được dùng cho phát triển. Trên iPhone/iPad hỗ trợ Web Push, người dùng cần thêm web app vào Màn hình chính và bật quyền từ thao tác trực tiếp. Việc nhận khi đóng hoàn toàn trình duyệt còn phụ thuộc hệ điều hành/cấu hình chạy nền; không bảo đảm nhận tức thời hoặc khi máy tắt. [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).

## Cấu hình máy chủ

Cài dependency theo lockfile và áp dụng migration trước khi bật dịch vụ:

```sh
cd backend
npm ci
npx sequelize-cli db:migrate
```

Migration mới `migrationzzzzzz-web-push.js` tạo `WebPushSubscriptions`, `WebPushDeliveries` và các chỉ mục. Hai migration realtime trước đó bổ sung khóa chống trùng tin và bảng last-seen. Khi dùng một database đã dựng thủ công từ SQL, đối chiếu `SequelizeMeta` trước khi chạy toàn bộ lịch sử migration. Không chạy `down` khi đang gửi tin.

Tạo khóa bằng công cụ local, dùng email liên hệ của đơn vị vận hành:

```sh
node scripts/generate-push-keys.cjs --subject=mailto:contact@example.com --out=../.local/web-push.env
```

Công cụ tạo file mới, không in khóa bí mật và không ghi đè khóa có sẵn. Đưa bốn biến trong file vào cấu hình backend:

- `WEB_PUSH_ENABLED=true`
- `WEB_PUSH_SUBJECT`: email liên hệ dạng `mailto:...` hoặc URL liên hệ HTTPS.
- `WEB_PUSH_PUBLIC_KEY`: chỉ khóa công khai được API cung cấp cho frontend.
- `WEB_PUSH_PRIVATE_KEY`: giữ trong secret/env của backend, không đưa vào frontend hoặc Git.

Mọi node cần chung khóa VAPID và database. Backend kiểm tra khóa và khả năng truy cập hai bảng trước khi mở cổng. Thiếu migration hoặc khóa sai làm khởi động thất bại thay vì nhận tin rồi mất yêu cầu gửi nền. Giữ nguyên khóa qua các lần khởi động; đổi khóa cần người dùng đăng ký lại thiết bị.

Frontend dùng `REACT_APP_BACKEND_URL` sẵn có. Phục vụ `/push-sw.js` tại gốc cùng origin, loại JavaScript, cho phép kiểm tra bản mới (`Cache-Control: no-cache`); không trả HTML dự phòng cho đường dẫn này. Đường dẫn chat `/chat/:partnerId` phải có SPA fallback. Manifest và biểu tượng cài đặt/thông báo đã được bổ sung. Worker chỉ lưu tùy chọn tài khoản, không cache API/chat/token.

API `GET /api/push/config`, `POST /api/push/subscription`, `DELETE /api/push/subscription` dùng JWT, trạng thái tài khoản hiện tại trong SQL, quyền `ACCOUNT_SELF`, `no-store` và giới hạn 30 yêu cầu/phút/tài khoản. API không nhận `userId` từ client để quyết định chủ thiết bị. Mỗi tài khoản tối đa 10 thiết bị; đăng ký có thời hạn tối đa 30 ngày.

Endpoint gửi chỉ chấp nhận HTTPS của Google, Mozilla, Apple và subdomain WNS `*.notify.windows.com` của Microsoft; từ chối localhost, IP nội bộ, userinfo, cổng tùy ý và tên miền giả mạo. Không mở allowlist theo dữ liệu client. [Microsoft Edge Web Push](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push), [Microsoft WNS endpoints](https://learn.microsoft.com/en-us/windows-365/link/connection-endpoints).

## Gửi nền và khôi phục lỗi

- Tin chat và yêu cầu gửi push được lưu **cùng giao dịch SQL**. Gửi lại cùng `clientMessageId` không tạo thêm tin hoặc yêu cầu push.
- Chờ tối thiểu 5 giây trước khi gửi; worker chạy mỗi 5 giây, tối đa 20 tác vụ/lượt. Tin đã đọc, quá một giờ hoặc không còn được phép trao đổi bị bỏ qua trước khi gửi.
- Mỗi tác vụ có lease 30 giây và cập nhật có điều kiện. Hai node không nhận cùng lease; sau khi tiến trình lỗi, tác vụ có thể được nhận lại khi lease hết hạn.
- Gửi mã hóa Web Push với VAPID, timeout 5 giây và TTL một giờ. Lỗi mạng/5xx thử lại với thời gian tăng dần và jitter, tối đa 6 lần. 400/401/403/413 kết thúc ngay. 404/410 xóa đăng ký hết hiệu lực. Lỗi cấp quyền/tài khoản thay đổi không gửi nội dung ra thiết bị.
- Mỗi lần đăng ký/chuyển chủ có `generation`, ngăn tác vụ của tài khoản cũ gửi tới đăng ký mới. Worker trình duyệt kiểm tra chủ tài khoản trước khi hiện và trước khi mở thông báo. Thay chủ/đăng xuất đóng thông báo cũ.
- Giữ trạng thái tác vụ đã kết thúc 7 ngày; dọn đăng ký hết hạn khi worker hoạt động. Endpoint/khóa đăng ký là dữ liệu nhạy cảm, không ghi vào metric/log lỗi.
- Trường hợp tiến trình chết **sau khi nhà cung cấp nhận nhưng trước khi ghi `sent`** vẫn có thể gửi lại. Đây là at-least-once; `tag` theo ID tin thay thế thông báo trùng đang hiển thị. Không tuyên bố exactly-once hoặc coi nhà cung cấp nhận là người dùng đã đọc.

Metric bổ sung: `web_push_delivery_total`, `web_push_worker_errors_total`, `notification_read_publish_errors_total`, cùng cơ chế bảo vệ endpoint metrics có sẵn. Bảng delivery cung cấp trạng thái `pending/sending/sent/skipped/dead`, số lần thử và mã lỗi hữu hạn để vận hành kiểm tra.

## Đồng bộ số chưa đọc

Sau khi cập nhật đã đọc thành công trong SQL, `notification:read` chỉ được gửi tới room tài khoản sở hữu. Lỗi phát sự kiện không đổi một thao tác SQL thành thất bại. Header công khai/quản trị và menu chat tải lại khi nhận sự kiện đọc, có tin mới, reconnect, có mạng và quay về tab. Khi ẩn/offline không tải định kỳ. Phản hồi cũ hoặc phản hồi của component đã rời trang không ghi đè số mới. Bộ đếm chỉ giảm sau khi API đánh dấu đọc thành công.

## Kiểm thử và giới hạn nghiệm thu

Ngày 14/09/2026 đã chạy trên máy hiện tại:

Backend: **855 test / 47 suite** qua, có kiểm tra tài nguyên còn mở sau test. Frontend: **1.452 test / 75 suite** qua; sau chỉnh cleanup của header chạy lại 30 test điều hướng đều qua. Bản dựng production biên dịch thành công, không còn cảnh báo ESLint từ thay đổi mới.

- Unit/UI: quyền chủ động bật, hủy/chặn quyền, lỗi mạng/lưu thiết bị, đổi phiên khi đang đăng ký, đăng xuất khi API offline, fallback xóa cache worker, thiết bị hết hạn, khóa phối hợp nhiều tab, giao diện bật lại và chống phản hồi cũ.
- API/SQL thật: JWT thiếu/sai, tài khoản bị khóa, không cho giả chủ thiết bị; đăng ký/hủy/cấu hình; migration chạy lại; giao dịch rollback; 5 gửi đồng thời chỉ một tin/một tác vụ; hai worker cùng tranh lease; hết lease sau restart; retry/giới hạn lần thử/403/410; đã đọc; đổi chủ; giới hạn 10 thiết bị và đăng ký lại khi hết hạn.
- HTTPS thật tới **provider thử trên loopback**: thư viện `web-push` tạo VAPID và mã hóa `aes128gcm`; máy nhận giải mã bằng khóa ECDH để kiểm tra payload không chứa nội dung chat. Không gửi tới thiết bị người dùng hoặc provider công khai trong bài thử này.
- Chromium đầy đủ: cài worker thật, cấp quyền trong profile thử riêng, DevTools bơm push, API thông báo trình duyệt ghi nhận thông báo hiển thị, tag không trùng, chặn sai tài khoản và đóng khi đăng xuất. Không giả lập `showNotification`. Chromium headless shell thiếu quyền nền nên harness dùng `channel: chromium`.
- SQL + Redis hai node: đánh dấu đọc qua HTTP thật, cả hai tab cùng tài khoản nhận sự kiện, tài khoản khác không nhận. Luồng chat chạy lại trên Chromium/Firefox/WebKit với gửi/nhận/typing/read, lấy bù 260 tin sau mất mạng và màn hình 390 px.

Chạy kiểm thử chung:

```sh
npm --prefix backend test
npm --prefix frontend run test:unit
npm --prefix frontend run build
npm --prefix backend run test:push:browser
```

Kiểm thử tích hợp dùng **database/Redis local thử riêng**, không dùng database đang phục vụ:

```powershell
$env:CHAT_TEST_MYSQL_URL='mysql://root:TEST_PASSWORD@127.0.0.1:TEST_PORT/mysql'
$env:CHAT_TEST_REDIS_URL='redis://127.0.0.1:TEST_REDIS_PORT'
$env:CHAT_TEST_PUSH='true'
$env:CHAT_TEST_PUSH_TLS_DIR='D:/path/to/test-certificate-directory'
# Thư mục chứng chỉ chứa local.crt/local.key, SAN=IP:127.0.0.1,DNS:localhost.
# Có thể bật thêm CHAT_TEST_BROWSERS=true để chạy cả ba browser engine.
npm --prefix backend run test:chat:infrastructure
```

Workflow `.github/workflows/realtime.yml` tạo chứng chỉ thử, chạy unit liên quan, push Chromium và tích hợp SQL/Redis/push. Chưa chạy workflow GitHub trong tác vụ local này.

**Giới hạn:** chưa nghiệm thu đăng ký và giao nhận xuyên suốt qua Google/Mozilla/Apple/Microsoft trên thiết bị cá nhân thật, chưa kiểm tra CDN/HTTPS production, Safari iOS vật lý hoặc chạy tải dài 2–8 giờ. Unit, provider loopback và DevTools là các lớp bằng chứng riêng; không thay thế nghiệm thu provider công khai. Sau khi có tên miền HTTPS, thử đóng trang, gửi từ tài khoản thứ hai, mở thông báo, đăng xuất/đổi tài khoản trên từng trình duyệt mục tiêu.

## Trạng thái local sau đợt phát triển

Đã tạo cấu hình VAPID với email liên hệ người dùng cung cấp; khóa nằm trong `backend/.env` và `.local/web-push.env`, đều bị Git bỏ qua. Đã áp dụng và ghi nhận ba migration realtime mới trên database local cấu hình `jobfindtest`, cổng 3333; xác nhận số hàng chat không đổi. Không áp dụng vào production.

Backend dùng thử chạy tại `http://localhost:4000`, website bản dựng tại `http://localhost:3000/chat`. Phiên backend này tắt tác vụ gửi email định kỳ. Script khởi động local ở `.local/start-web-push-backend.cjs` và `.local/start-web-push-frontend.cjs`; PID/log nằm trong `.local/websocket-checks`. Hai tiến trình được giữ lại để người dùng dùng thử. Tên miền HTTPS production chưa được cung cấp.

Log nghiệm thu nằm trong `.local/websocket-checks/`: `push-backend-verified.txt`, `push-frontend-final.txt`, `push-navigation-verified.txt`, `push-build-verified.txt`, `push-final-acceptance.txt`, `push-infrastructure-browser.txt`.
