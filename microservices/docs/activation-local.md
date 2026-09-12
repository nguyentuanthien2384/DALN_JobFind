# Kích hoạt trên máy hiện tại — 12-09-2026

**Trạng thái mới nhất:** đã bật lại lần lượt bốn cờ đủ điều kiện, giữ bản sửa đăng nhập và bàn giao cách quay lui. Xem [biên bản bật tính năng và bàn giao](feature-rollout-handoff.md). Nội dung bên dưới ghi lại lần kích hoạt trước.

Đã triển khai runtime cố định và bật bốn tính năng tại **http://localhost:3001**: tìm kiếm qua Core, tiến trình ứng tuyển, danh sách tin riêng của công ty và chọn CV đã chuẩn bị. Đã thử trên bản sao phục hồi trước, sau đó kiểm tra trên dữ liệu thật. Đây là triển khai local, chỉ công bố ứng dụng trên loopback.

AI ứng viên chưa mở; tạo/sửa/đăng lại tin qua Core chưa mở. Máy chưa có khóa Anthropic và model đã được xác nhận. Các luồng tạo/sửa/đăng lại cũ vẫn dùng chế độ legacy. Worker dừng, đường ghi cần AI bị chặn tại đầu vào web (kể cả chữ hoa, dấu gạch chéo cuối và ký tự URL được mã hóa); Gateway không mở cổng trực tiếp ra host. Email ngoài hệ thống tắt, PayPal giữ sandbox.

## Kết quả kiểm tra

- 38 tài khoản hoạt động được đối chiếu vai trò hiện tại; quyền công ty/ứng viên và từ chối truy cập chéo qua.
- Tìm kiếm khớp 25 tin có trạng thái được phép hiển thị trong SQL; từ khóa không khớp trả danh sách rỗng.
- 6 CV đã nộp giữ nguyên nội dung và hàng dữ liệu; tiến trình ứng tuyển liên kết đúng CV lịch sử. Có 1.142 bản ghi audit; chỉ mục `createdAt_1` giữ nguyên, không thêm TTL.
- Tám dịch vụ HTTP sẵn sàng; ứng dụng dùng image ID cố định, user không phải root, filesystem chỉ đọc. Kết nối Socket có xác thực qua web thành công.
- 12 hàng đợi, 0 thông điệp chờ, 0 thông điệp chưa xác nhận, 5 consumer. MySQL outbox hết tồn; không tạo tác vụ AI hoặc lượt gửi thông báo mới trong nghiệm thu.
- Năm container hạ tầng giữ nguyên ID, image, volume và hostname; không tạo lại node RabbitMQ. Schema MySQL giữ nguyên. Sáu tài khoản MySQL giới hạn theo dịch vụ; hai tài khoản PostgreSQL không có quyền superuser/tạo role/tạo database.
- Trình duyệt thật đã kiểm tra tìm kiếm, lịch sử/tiến trình ứng viên, bố cục lịch sử trên điện thoại, danh sách tin riêng và cờ AI tắt. Không giả lập phản hồi API, không gửi hồ sơ thật. Những tin phù hợp với tài khoản kiểm thử đều hết hạn, nên chưa kiểm tra được modal chọn CV trên dữ liệu thật; PDF/nội dung nộp đã có nghiệm thu tách biệt ở bước trước.
- Đã quay lui giao diện thật về tám cờ tắt rồi bật lại từng bước. Không khôi phục ngược database khi quay lui giao diện. 20 kiểm thử runtime/toàn vẹn/cấu hình qua.

## Bản triển khai và checkpoint

Thư mục: `.local/deployments/activation-2026-09-12T00-57-33-951Z` (Git bỏ qua). Biên bản không chứa mật khẩu, token hay nội dung hồ sơ.

Ứng dụng giữ commit `bc9cb1c4e070dac884782706284f07d72dcf0892`. Web đang chạy: `sha256:1535b1e3c97faae115b8a99325d8a97167b8833029b60105135314a7a930a6b6`. Backend và microservices dùng image trong bộ bàn giao trước. Bốn image web theo từng bước có trong `frontend-images.tar`; checksum và image ID ghi tại `frontend-artifacts.json` và manifest mới.

`activation-manifest.json` cố định 28 file: image archive, đầu vào web, công thức vận hành, cấu hình từng biến thể và bản chụp bằng chứng. SHA-256 manifest: **`18ee4fbe4f3703ef63e132417156e7de32242b2e6455a4c3584cbb247b298504`**. `compose.runtime.<biến-thể>.json` là cấu hình cố định; `compose.live.json` và `state.json` là trạng thái vận hành hiện tại. Các file `private.json`, `metrics-token` và `compose.runtime.*.json` chứa thông tin riêng, không đưa lên Git hoặc chia sẻ công khai. Bằng chứng đã niêm phong có tiền tố `evidence-`; các lần kiểm tra tiếp theo ghi vào báo cáo vận hành riêng.

`backup/` là checkpoint dữ liệu nguồn mới ngay trước kích hoạt: MySQL SQL, MongoDB, PostgreSQL, RabbitMQ và Elasticsearch. Đã khôi phục vào môi trường nội bộ tách biệt, tạo các tài khoản dịch vụ mới tại đó, khởi động đúng image và đối chiếu dữ liệu/quyền trước khi làm thật. MySQL bản sao dùng `lower_case_table_names=1` để khớp MariaDB Windows. Tài nguyên bản sao đã dọn, checkpoint được giữ. Sao lưu nằm cùng máy; chưa có bản sao ngoài máy để chống mất toàn bộ ổ đĩa.

## Lỗi cấu hình đã xử lý

Compose có thể xuất `environment` dưới dạng mảng `KEY=value`. Công thức đóng gói cũ gán thuộc tính vào mảng nên JSON bỏ các giá trị ghi đè, gồm kết nối MySQL và địa chỉ Backend. Đã chuẩn hóa thành object trước khi ghi đè, bổ sung kiểm thử hồi quy và kiểm tra các giá trị bắt buộc khi nghiệm thu bộ cài mới.

Bộ cài cũ vẫn nguyên checksum, nhưng **không dùng trực tiếp Compose của bộ cài cũ để kích hoạt**. Cấu hình đã kiểm tra trong thư mục triển khai hiện tại thay thế nó. Các image ứng dụng cũ được tái sử dụng sau khi kiểm tra; không sửa bộ đã niêm phong. Chỉ mục Admin đã chạy thành công trên bản sao và dữ liệu thật.

## Vận hành tiếp

Chạy từ `D:\job_find`:

```powershell
node scripts/manage-activation.mjs status
node scripts/seal-activation.mjs verify
node scripts/activate-local.mjs verify
node scripts/activation-health.mjs
```

Khởi động lại đúng bản triển khai sau khi Docker và MariaDB Windows sẵn sàng:

```powershell
node scripts/manage-activation.mjs resume
node scripts/activate-local.mjs verify
node scripts/activation-health.mjs
```

Quay lui riêng giao diện hoặc bật lại bốn bước đã nghiệm thu:

```powershell
node scripts/manage-activation.mjs rollback
node scripts/manage-activation.mjs activate
```

Các lệnh tương ứng có tên `deploy:status`, `deploy:resume`, `deploy:verify`, `deploy:rollback`, `deploy:activate` trong package scripts. `npm start`/`npm run dev` là trình chạy mã nguồn cũ, không phải lệnh vận hành bản triển khai cố định này. Không dùng `compose down`, xóa volume hoặc `--remove-orphans` với cấu hình chỉ chứa ứng dụng/web.

Quay lui giao diện giữ Backend, consumer và dữ liệu tương thích đang chạy; không xóa hồ sơ phát sinh sau checkpoint. Khôi phục toàn bộ sau sự cố cần dừng writer, kiểm tra checksum và diễn tập trên bản sao theo [hướng dẫn sao lưu/khôi phục](backup-restore-rehearsal.md). Checkpoint trước kích hoạt chưa có các PostgreSQL role mới: cần đối chiếu/tạo lại quyền và binding phù hợp trước khi kết nối runtime mới; không ghi đè trực tiếp volume đang hoạt động.

Để mở AI tiếp: điền `ANTHROPIC_API_KEY` và model vào `microservices/.env` tại máy (không gửi khóa vào chat). Tiếp theo cần xác nhận model hoạt động, chạy Worker trên hàng đợi thử với dữ liệu tổng hợp, rồi lập biến thể mới để mở cờ/gỡ chặn theo từng bước. Việc thêm khóa vào `.env` hiện chưa tự thay đổi container đang chạy.
