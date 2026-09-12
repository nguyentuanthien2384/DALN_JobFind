# Bộ triển khai / quay lui local

Đây là bộ ứng dụng cho máy Windows/Docker Desktop hiện có, chưa phải lệnh cho phép bật tính năng. Xem `manifest.json`, `variants.json`, `target.json`. Mã ứng dụng nằm tại commit ghi trong manifest; công thức đóng gói được cố định bằng checksum riêng. `source.tar` là đầu vào Git, không lấy source đang chỉnh sửa hoặc `.env` trên máy. Image ID SHA-256 là định danh chạy; tag không dùng để chọn bản.

## Kiểm tra và nạp bộ cài

Yêu cầu Node 22+, Docker Engine Linux/amd64, Compose >= 2.24.4. Đối chiếu SHA-256 của `manifest.json` với biên bản bàn giao ở ngoài bộ cài, sau đó chạy từ thư mục bộ cài:

```powershell
node verify.mjs
node verify.mjs --load
```

Kiểm tra cả file thừa, file thiếu, kích thước, checksum và đường dẫn trước khi nạp. `--load` nạp 9 image rồi đối chiếu ID/nền tảng; không khởi động container. Checksum bảo vệ tính toàn vẹn, không thay thế chữ ký hoặc nguồn phân phối tin cậy. Giữ nguyên thư mục đã niêm phong; đặt cấu hình và biên bản chạy ở ngoài thư mục này.

## Cấu hình đã cố định

- `compose.json` chỉ có 10 ứng dụng, không có DB/broker, volume dữ liệu hoặc source bind mount. Dùng external network `ai-job-portal_default`; các dependency phải sẵn sàng trước. Các image được chọn bằng ID và `pull_policy: never`.
- Mặc định giao diện quay lui: năm mode `legacy`, ba cờ `false`. `compose.deployment.json` chọn bản dự kiến có năm mode `core`, ba cờ `true`. Bản toàn bộ bật chỉ để nghiệm thu; triển khai từng cờ cần build một biến thể khác bằng công thức đã lưu và tạo manifest mới. Không đổi biến ở container để thay bundle.
- Giao diện: `http://localhost:3001` hoặc `http://127.0.0.1:3001`, Gateway `/api`, Socket `/socket.io` trên cùng origin. API Gateway còn cổng loopback 4000. Giữ nguyên origin khi quay lui để giữ sessionStorage. Reload tab để nhận bản mới; tab đang mở vẫn có thể gửi theo bundle cũ.
- Backend/Socket và cả tám microservices giữ nguyên image ở cả hai biến thể. Backend dùng profile Sequelize `development` hiện có để giữ `query.raw` và timezone `+07:00`; đây là cấu hình tương thích local, không phải bộ Internet production. Thư viện runtime cài bằng lockfile, không chứa devDependencies. Scheduled jobs và email ngoài bị tắt như runtime local.
- Copy `runtime.env.example` ra nơi riêng và điền các binding bắt buộc. Dùng cùng JWT secret/policy cho Gateway và Backend; secret nội bộ khác JWT. Token metrics là file bên ngoài. Mật khẩu DB/broker phải khớp kho hiện có; credential chèn trong URI cần percent-encoding hợp lệ. Không đổi mật khẩu server chỉ bằng đổi file env.
- Provider key và model là binding bắt buộc chưa được chứng nhận. Không có secret thật trong bộ cài. Khóa/model được chọn phải được nghiệm thu và ghi phiên bản cấu hình ở bước triển khai. Mật khẩu MySQL trống bị từ chối; cần tài khoản dịch vụ đã đối chiếu quyền.
- Backend có binding RabbitMQ và secret nội bộ chung để phát event/đẩy Socket. Cloudinary và PayPal dùng binding bí mật riêng; PayPal cố định sandbox như cấu hình nguồn, không chuyển sang thanh toán thật. Khi điền mẫu, chuyển tên cũ `CLIENT_ID/CLIENT_SECRET` sang `PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET` nếu cần. Các provider này chưa được gọi trong diễn tập.
- Build giao diện dùng `npm ci --legacy-peer-deps` theo graph đã khóa vì thư viện lightbox cũ khai báo peer React 16/17 trong ứng dụng React 18. Không thay lockfile; các ca browser và hồi quy kiểm tra bản đã build.
- 5 image hạ tầng được lưu theo đúng ID nguồn để phục hồi sau sự cố, không tự recreate hạ tầng. MariaDB 10.4.32 chạy trên Windows là dependency ngoài; bộ này không cài hay di chuyển MySQL. `target.json` giữ volume/node RabbitMQ và các volume nguồn. Không dùng các volume checkpoint chứa fixture từ restore drill để phục hồi hệ thống thật.

## Chạy ở bước triển khai tiếp theo

Chỉ sau khi đã nghiệm thu tài khoản/quyền/schema, cấu hình provider, recovery point và thứ tự chuyển writer, dùng file env bên ngoài để kiểm tra cấu hình. Không lưu kết quả config đã nội suy vì chứa secret:

```powershell
docker compose --env-file C:\secure\jobfind-release.env -f compose.json config --quiet
```

Giữ các writer được kiểm soát/drain theo `rollout-plan.md`. Khởi động dependency hiện có bằng quy trình đã đối chiếu volume/node, rồi đưa reader/consumer tương thích lên trước writer: Application, Notification, Admin; tiếp theo Core/Identity/Search/Worker theo điều kiện sẵn sàng; đồng bộ Backend/Gateway JWT trước mở giao diện mặc định. Không chạy `up` toàn bộ để thay quy trình chuyển writer. Mỗi lệnh nâng ứng dụng dùng `--no-deps --no-build --pull never` và chỉ tên service trong giai đoạn đã được phép. Kiểm tra health/ready, auth/Socket và backlog trước phục vụ frontend.

Để chọn giao diện dự kiến trong bản sao đã nghiệm thu:

```powershell
docker compose --env-file C:\secure\jobfind-release.env -f compose.json -f compose.deployment.json up -d --no-deps --no-build --pull never web
```

Quay lui giao diện trên cùng origin, giữ các backend/consumer đang hoàn tất yêu cầu:

```powershell
docker compose -f compose.web.rollback.json up -d --no-deps --no-build --pull never web
```

File quay lui độc lập chỉ chứa service `web` trong cùng project/network; dùng được ngay cả khi không đọc được file secret/provider. Không thêm `--remove-orphans` hoặc chạy `down`: các ứng dụng khác vẫn cần tiếp tục hoạt động.

Đối chiếu `/release-info.json` và bundle thực tế, tải lại tab, xem pending/task/CV và đối chiếu đúng key/payload/writer. Không xóa storage/receipt/ledger, restore đè DB, purge queue, hạ schema hoặc dừng Worker chỉ vì cờ giao diện đã tắt. Bộ này chưa có một phiên bản backend cũ được chứng nhận quay lui với dữ liệu mới; rollback được chuẩn bị là rollback cờ bằng frontend tương thích.

Biên bản nghiệm thu bộ image được lưu ngoài bộ cài tại `microservices/docs/release-preparation.json`; kiểm tra release ID và manifest checksum khớp trước dùng. Trạng thái HOLD chỉ được gỡ theo các điều kiện trong `rollout-plan.md`.
