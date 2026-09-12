# Bật tính năng và bàn giao — 12-09-2026

Ứng dụng local: **http://localhost:3001**. Bốn cờ đã được bật lần lượt, theo thứ tự tìm kiếm → tiến trình ứng tuyển → danh sách tin của công ty → chọn CV đã chuẩn bị. Bản sửa đường đăng nhập được giữ ở mọi bước. Đây là trạng thái kế tiếp của [nghiệm thu khi cờ tắt](flags-off-acceptance.md).

## Các cờ đang dùng

- `REACT_APP_JOB_SEARCH_MODE=core`: trang tìm việc dùng API tìm kiếm mới; kiểm tra bằng trình duyệt và dữ liệu thật.
- `REACT_APP_APPLICATION_PROGRESS_ENABLED=true`: lịch sử CV và cột tiến trình hiển thị từ dữ liệu thật; bố cục điện thoại qua.
- `REACT_APP_JOB_WORKSPACE_MODE=core`: công ty đọc được danh sách tin riêng qua Core, không có cảnh báo tải dữ liệu trong ca kiểm thử.
- `REACT_APP_PREPARED_CV_APPLICATION_ENABLED=true`: bật lựa chọn CV đã lưu. Đã kiểm tra bật/tắt trên chính bundle đang phục vụ, với API giả chỉ trong trình duyệt: cờ tắt không hiện lựa chọn và không tải danh sách CV; cờ bật tạo PDF tiếng Việt, phù hợp giới hạn dung lượng, phải xác nhận đã xem trước khi nút gửi được mở, bố cục điện thoại qua. Không gửi hồ sơ thật. Tin phù hợp với tài khoản kiểm thử đã hết hạn nên ca modal/PDF này không được ghi nhận là thử nộp CV bằng dữ liệu thật.
- `REACT_APP_CANDIDATE_AI_ENABLED=false`: vẫn thiếu khóa Anthropic. Không bật Worker hay nhận yêu cầu AI mới.
- `REACT_APP_JOB_CREATE_MODE=legacy`, `REACT_APP_JOB_EDIT_MODE=legacy`, `REACT_APP_JOB_REPOST_MODE=legacy`: các đường ghi mới qua Core cần Worker, nên tiếp tục chờ. Luồng cũ giữ chế độ legacy.

Trong ba bước đầu, lựa chọn CV đã chuẩn bị vẫn tắt; chỉ bước cuối mới mở. Từng biến thể được đối chiếu toàn bộ tám giá trị trong `release-info.json` với artifact đã cố định. Các đường ghi cần provider tiếp tục bị chặn, Gateway không công bố cổng trực tiếp ra host.

## Theo dõi và giới hạn nghiệm thu

Sau mỗi bước có cửa sổ theo dõi tối thiểu 25 giây, ba lần lấy mẫu: readiness, số HTTP 5xx của bảy microservice, sức khỏe Backend, số lần khởi động lại, hàng đợi và log JSON. Bốn cửa sổ không ghi nhận HTTP 5xx mới, error/warning dịch vụ mới, khởi động lại bất ngờ hoặc thông điệp tồn. Kiểm tra trình duyệt không gặp lỗi JavaScript. HTTP 503 cố ý trả tại cổng web cho chức năng chưa mở không được tính là lỗi microservice.

Đây là theo dõi có thời hạn trong ca nghiệm thu, không phải kiểm thử tải hoặc giám sát 24/7. Chưa thiết lập thông báo tự động ngoài phiên làm việc. Email ngoài hệ thống vẫn tắt, PayPal giữ sandbox; chưa nghiệm thu hai kênh này như dịch vụ thật.

## Cách quay lui đã thử

Từ `D:\job_find`, chạy:

```powershell
node scripts/manage-activation.mjs rollback
node scripts/manage-activation.mjs status
node scripts/activation-health.mjs
```

Lệnh chỉ đổi giao diện về tám cờ tắt, giữ nguyên Backend, consumer, database, volume và bản sửa đăng nhập. Không nạp lại backup để quay lui giao diện. Bản đã sửa đăng nhập dùng image `sha256:008c67873b55a81194d3a2ce9ffa0add0dd52a9b75fe89cdfe84d7fc0facfe2e`.

Sau khi xử lý nguyên nhân, đưa lại đúng bản bốn cờ đã nghiệm thu:

```powershell
node scripts/manage-activation.mjs reactivate
```

Lệnh này yêu cầu có biên bản nghiệm thu biến thể cuối, kiểm tra trình duyệt/PDF và theo dõi thêm 25 giây. Nếu nghiệm thu không qua, nó đưa giao diện về bản cờ tắt. Muốn chạy lại toàn bộ bốn bước thì dùng `node scripts/manage-activation.mjs activate`.

Đã thực hiện vòng quay lui thật rồi khôi phục bản đã nghiệm thu. So checksum cả 31 bảng MySQL trước/sau để xác nhận hàng dữ liệu không đổi; kiểm tra sức khỏe sau quay lui và sau khôi phục. Có một lượt kiểm tra sức khỏe không qua trong lần thử bàn giao đầu; kiểm tra trực tiếp tiếp theo đạt và vòng đầy đủ đã được thực hiện lại. Giữ biên bản lần đầu, không gộp nó thành lần đạt. Số đo thời gian và kết quả cuối nằm trong `feature-rollout-handoff.json`.

## Vận hành sau bàn giao

```powershell
# Trạng thái cờ và phiên bản đang phục vụ
node scripts/manage-activation.mjs status

# Theo dõi thêm một cửa sổ 30 giây, chỉ đọc
node scripts/manage-activation.mjs observe

# Đối chiếu quyền, dữ liệu cũ, CV và tìm kiếm
node scripts/activate-local.mjs verify
node scripts/activation-health.mjs

# Khởi động lại đúng runtime sau khi Docker và MariaDB Windows sẵn sàng
node scripts/manage-activation.mjs resume
```

Lệnh tương ứng trong package scripts: `deploy:status`, `deploy:observe`, `deploy:verify`, `deploy:resume`, `deploy:rollback`, `deploy:reactivate`. `npm start`/`npm run dev` thuộc trình chạy mã nguồn cũ, không phải đường khởi động bản triển khai cố định này.

Nếu phát sinh lỗi chức năng mới lặp lại, HTTP 5xx tăng, dịch vụ không sẵn sàng hoặc hàng đợi không thoát tồn, quay lui giao diện rồi đối chiếu nguồn lỗi. Quay lui giao diện không tự sửa hạ tầng hỏng hoặc xử lý thay các tác vụ đã nhận; không xóa hàng đợi, ledger hay volume để làm mất dấu lỗi.

Bàn giao gồm cấu hình đang chạy, cấu hình quay lui, bản chụp bằng chứng từng bước, công thức vận hành và checksum/tham chiếu các archive image. Cấu hình đã resolve chứa mật khẩu chỉ lưu trong `.local`, không đưa lên Git hoặc chia sẻ công khai. Archive ứng dụng và archive web đã có từ các bước trước; checkpoint dữ liệu vẫn ở cùng máy, chưa có bản sao ngoài máy.

Để hoàn tất nhóm chức năng AI còn chờ, cần khóa Anthropic hợp lệ và kiểm tra model/Worker trên hàng đợi thử trước khi lập bản cấu hình mới để mở cờ. Việc thêm khóa vào `.env` không tự thay đổi container đang chạy.
