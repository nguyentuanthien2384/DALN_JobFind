# Chuẩn bị bản triển khai và bản quay lui — 2af

Đóng gói ngày 11-09, nghiệm thu hoàn tất ngày 12-09-2026: **PASS bước chuẩn bị artifact**, giữ **HOLD kích hoạt tính năng**. Ứng dụng lấy từ commit sạch `bc9cb1c4e070dac884782706284f07d72dcf0892`, kế thừa kết quả Worker/Admin và backup/restore trên bản sao. Công thức đóng gói mới được ghi checksum riêng; không gán các file chưa commit cho commit ứng dụng. Không thay đổi source runtime, database, queue, `.env` hoặc cờ thật.

## Bộ bàn giao

Bộ cài nằm dưới `.local/releases/`, được Git bỏ qua. Tên bộ cuối cùng và SHA-256 của manifest ghi ở [biên bản kiểm thử](release-preparation.json). `LATEST` chỉ là con trỏ tiện dụng; trước sử dụng phải đối chiếu ID và checksum trong biên bản.

Bộ đã nghiệm thu: `.local/releases/bc9cb1c4e070-2026-09-11T14-26-04-972Z`. SHA-256 của `manifest.json`: `f2ec068f3f83f9fc36501df84c45bbf220efc7b5200d5ab9b6fd21f3562cd7e1`. Archive image 1.442.188.288 byte (khoảng 1,44 GB).

- `images.tar`: 4 image ứng dụng (microservices dùng chung cho 8 service, Backend/Socket, web dự kiến, web quay lui), cùng 5 image hạ tầng theo đúng ID nguồn. Chỉ nạp, không khởi động khi chạy trình kiểm tra `--load`.
- `source.tar`: snapshot Git của đầu vào ứng dụng; package-lock cố định đồ thị thư viện. Docker base Node/nginx cố định digest. Node build/runtime là 22.23.2; OS Linux/amd64.
- `variants.json`: cùng commit và Gateway `/`, năm mode `core`/`legacy`, ba boolean `true`/`false`. Hai biến thể dùng cùng Backend/Socket và consumer tương thích. Mặc định ứng dụng phục vụ biến thể quay lui.
- `compose.json` và các overlay: 10 ứng dụng chọn bằng image ID; filesystem chỉ đọc, user không phải root, không source bind mount, không npm install lúc chạy. Hạ tầng/network và native MariaDB là dependency hiện có, không tự recreate.
- `compose.web.rollback.json`: cấu hình độc lập chỉ thay web trên cùng project/network, không cần nội suy secret/provider. Không dùng `down` hoặc `--remove-orphans` với file này.
- `runtime.env.example`: binding bên ngoài cho tài khoản kho dữ liệu, JWT/nội bộ/metrics, provider AI, Cloudinary và PayPal sandbox. Không chứa secret thật. Model AI chưa chọn/kiểm chứng nên được yêu cầu rõ thay vì mặc định ngầm.
- `target.json`: snapshot tên volume/node/image nguồn, gồm anonymous volume RabbitMQ. `backup-reference.json` liên kết bằng chứng bước sao lưu; không sao chép dữ liệu thật hoặc checkpoint fixture vào bộ ứng dụng.
- `verify.mjs`, `manifest.json`, `manifest.sha256`: kiểm tra đường dẫn, file thiếu/thừa, kích thước và SHA-256 trước nạp, rồi kiểm tra đúng ID/nền tảng các image. Checksum không thay thế chữ ký; SHA manifest cần đối chiếu với biên bản ngoài bộ cài.

Hướng dẫn vận hành cụ thể ở `README.md` trong bộ cài; bản công thức tại [scripts/release/README.md](../../scripts/release/README.md).

## Kiểm chứng

Đã nạp lại cả 9 image từ archive và đối chiếu đúng ID/nền tảng lúc 07:39:58 ngày 12-09 (UTC+7). Không khởi động container trong bước nạp. Sau đó 11 nhóm kiểm tra bộ image/Compose/browser qua, kết thúc lúc 07:43:15; `status=passed`, `sourceUnchanged=true`, `cleaned=true`, checksum trong biên bản khớp bộ bàn giao. Các container/network thử đã dọn.

Đã phục vụ hai bundle thật: dự kiến `main.b0529d35.js`, quay lui `main.70b97a11.js`; checksum từng bundle trong biên bản. Đổi image trên cùng origin giữ nguyên pending, không tự POST, chặn payload khác, replay đúng key/payload và nhận lại kết quả; phiên mới ở bản quay lui không gửi AI mới. Đường API và Socket polling/WebSocket được kiểm tra với Gateway/Backend thật trong bản sao. Chỉ web dùng thêm mạng bridge để công bố loopback trên Docker Desktop; Backend và MariaDB fixture vẫn chỉ ở mạng internal.

Đã chạy 19 kiểm thử runtime/toàn vẹn và 160 kiểm thử giao diện qua 8 suite: tìm kiếm, AI/CV, lịch sử ứng tuyển, prepared CV, workspace, create/edit/repost. Có cảnh báo `act` hiện có ở suite tạo tin, không có ca thất bại. Build giao diện cần `--legacy-peer-deps` để giữ graph lockfile do lightbox cũ khai báo React 16/17 trong ứng dụng React 18; không nâng/hạ thư viện để vượt kiểm tra.

Diễn tập image có phạm vi: Gateway offline/auth/contracts; Worker thiếu key dừng trước nhận việc; Backend thật kết nối MariaDB trống cách ly, health/auth và dừng sạch; proxy API, Socket polling/WebSocket thật; đổi hai image frontend ở cùng origin và giữ pending AI qua mất phản hồi. API nghiệp vụ trong bài browser được mô phỏng, không gọi AI/SMTP/PayPal/Cloudinary và không nghiệm thu toàn bộ schema/quyền/nghiệp vụ trên target.

## Giới hạn triển khai

Trạng thái kích hoạt vẫn **HOLD**. Bản dự kiến toàn bộ cờ bật dùng để nghiệm thu; mỗi đợt bật riêng cần tạo biến thể/manifest đúng các cờ của đợt đó. Backend dùng cấu hình Sequelize local hiện có (`development`, timezone `+07:00`, `query.raw`), lịch nền/email tắt, PayPal sandbox; không phải gói phục vụ Internet production.

Tiếp theo: hoàn thiện binding provider và quyền DB theo từng service; đối chiếu schema/startup DDL, recovery point và thứ tự drain/chuyển writer trong [rollout-plan.md](rollout-plan.md). Đưa runtime mới lên với giao diện mặc định `legacy/false`, nghiệm thu auth/Socket, dữ liệu lịch sử và backlog trước bật từng cờ.

Quay lui đã chuẩn bị là quay lui cờ bằng frontend tương thích. Không hạ backend/schema, restore đè dữ liệu mới, xóa ledger/storage/receipt, purge queue hoặc dừng consumer chỉ vì menu bị ẩn. Chưa có một bộ backend cũ được chứng nhận quay lui với dữ liệu mới. MariaDB Windows và sao lưu offsite vẫn là dependency/công việc bên ngoài bộ này.

## Chạy lại

```powershell
npm run release:prepare
npm run test:release
# Hoặc kiểm tra một bộ cụ thể:
node scripts/test-release.mjs D:\job_find\.local\releases\<release-id>
```

Lệnh đóng gói lấy mã từ HEAD và từ chối đầu vào ứng dụng đang sửa. Không tự commit; công thức mới có thể được review/commit riêng. Bộ trước không bị ghi đè. Test tạo container/network riêng, MariaDB fixture dùng tmpfs, chỉ công bố web ở cổng loopback tạm thời rồi dọn bằng tên/nhãn sở hữu.
