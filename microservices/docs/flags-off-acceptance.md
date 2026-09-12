# Nghiệm thu hệ thống thật khi cờ tắt — 12-09-2026

**Cập nhật tiếp theo:** đã hoàn thành [bật lần lượt tính năng và bàn giao](feature-rollout-handoff.md). Nội dung dưới đây là bằng chứng của giai đoạn cờ tắt, không phải trạng thái vận hành mới nhất.

**PASS. Runtime mới đang chạy tại http://localhost:3001 với toàn bộ tám cờ tính năng tắt.** Đây là trạng thái hiện tại theo yêu cầu mới, thay cho trạng thái bốn cờ bật ở biên bản kích hoạt trước. Chưa bật lại cờ sau nghiệm thu.

## Thay đổi thực tế

Phát hiện và sửa lỗi trang đăng nhập: cấu hình Nginx nhận `/login` là thư mục tài nguyên `public/login`, rồi chuyển hướng sang cổng nội bộ 8080. Đã đổi quy tắc phục vụ trang để chỉ lấy file có thật; đường dẫn ứng dụng còn lại trả về giao diện React. `/login`, `/login/`, các đường dẫn sâu và ảnh trong thư mục login đều qua trên bản sao web trước khi cập nhật hệ thống thật.

Image web mới: `sha256:008c67873b55a81194d3a2ce9ffa0add0dd52a9b75fe89cdfe84d7fc0facfe2e`. Mã ứng dụng giữ commit `bc9cb1c4e070dac884782706284f07d72dcf0892`; bản vá chỉ sửa cấu hình phục vụ web. Backend, microservices và hạ tầng giữ image đã nghiệm thu. Bộ cài đã niêm phong trước vẫn nguyên checksum; bản vá có thư mục và archive riêng.

## Đăng nhập và phân quyền

- Đăng nhập bằng mật khẩu thật qua trình duyệt với tài khoản ứng viên tạm do ca kiểm thử tạo; phiên được lưu và trang lịch sử cũ mở được khi cờ tiến trình tắt. Không đặt lại mật khẩu người dùng đang có.
- Sai mật khẩu và tài khoản khóa không nhận token. Token đã cấp mất quyền ngay khi tài khoản tạm bị khóa; mở khóa khôi phục quyền tương ứng.
- Token hết hạn, chữ ký sai, giả header người dùng hoặc mang claim ADMIN trái với vai trò trong database đều bị từ chối.
- Ứng viên không đọc được khu vực công ty hoặc báo cáo quản trị. Tài khoản quản trị hiện có đọc được báo cáo tổng hợp.
- Kiểm tra riêng 38 tài khoản đang hoạt động đối chiếu vai trò hiện tại, phạm vi công ty, CV thuộc ứng viên và từ chối đọc chéo đã qua. Phần này dùng token kiểm thử ngắn hạn; không tuyên bố đã nhập mật khẩu của cả 38 tài khoản.

## Dữ liệu cũ và đồng bộ

Đối chiếu trước/sau bằng checksum hàng dữ liệu xác nhận 31 bảng MySQL với 465 hàng giữ nguyên. Sáu hồ sơ PostgreSQL, 11 sự kiện tiến trình, 6 ghi chú và các bảng còn lại giữ nguyên. MongoDB giữ 1.142 audit, 1 tag và 9 profile; sáu CV đã nộp vẫn nguyên nội dung.

Đã đưa một sự kiện kiểm thử có mã riêng vào outbox MySQL, dùng mã hồ sơ đã đồng bộ, rồi để relay thật chuyển qua RabbitMQ đến consumer thật. Gửi lại cùng sự kiện lần thứ hai cho kết quả một audit duy nhất, không nhân đôi hồ sơ và không ghi đè trạng thái, ghi chú hoặc dữ liệu PostgreSQL. Payload kiểm thử không chứa CV hoặc thông tin liên hệ thật; `posterId=null` nên nhánh gửi thông báo không được thực hiện. Đây là kiểm tra gửi lại sự kiện của hồ sơ đã có, không phải một lần nộp CV mới.

Đã chạy đối chiếu hồ sơ lịch sử hai lần: không nhập thêm bản trùng. Sau khi dọn chính xác tài khoản, profile tạm, outbox và audit của ca kiểm thử, checksum toàn bộ dữ liệu được kiểm tra khớp với trước ca chạy. Các số tự tăng có thể tiến lên do tạo/xóa fixture hoặc xử lý trùng; không đặt lùi bộ đếm hay tái sử dụng ID.

Kiểm tra cuối: tám dịch vụ HTTP sẵn sàng; 12 hàng đợi có 0 thông điệp chờ và 0 thông điệp chưa xác nhận, 5 consumer hoạt động. Volume, hostname và ID hạ tầng giữ nguyên. Không có lượt gửi thông báo mới. Worker AI và email ngoài hệ thống vẫn tắt.

## Bằng chứng và vận hành

Ca nghiệm thu đạt: `flags-off-f348e1cb-199a-4169-8e43-09e120b9acec` trong `.local/deployments/activation-2026-09-12T00-57-33-951Z/`. `report.json`, hai file fingerprint và `owned-fixture.json` lưu kết quả, không chứa mật khẩu hay token. Các lần thử trước được giữ với trạng thái thất bại để ghi nhận lỗi trang login và những điều chỉnh của bộ kiểm thử; dữ liệu tạm đã được dọn.

Bản vá ở `flags-off-web-20f1fa75-8b33-4ff4-bd3d-954fd790b12a/`, gồm cấu hình, Dockerfile, image archive và biên bản. Lệnh vận hành hiện tại đã nhận diện bản vá để việc quay lui tiếp tục dùng trang đăng nhập đã sửa và không ghi đè bộ cài cũ.

```powershell
node scripts/manage-activation.mjs status
node scripts/activation-health.mjs
node scripts/activate-local.mjs verify
```

Chạy lại nghiệm thu chuyên biệt bằng `node scripts/accept-flags-off.mjs` hoặc `npm run deploy:accept-flags-off`. Lệnh yêu cầu tám cờ tắt, tạo tài khoản/sự kiện tạm, rồi dọn theo ID riêng và so checksum. Không chạy chồng các ca nghiệm thu hoặc đồng thời với thao tác nghiệp vụ, vì thay đổi hợp lệ phát sinh trong lúc so checksum cũng khiến kiểm tra bảo toàn báo thất bại.

Bước này chưa nghiệm thu nộp CV mới trên hệ thống thật, gửi email hoặc AI trả phí. Các chức năng ấy cần ca thử riêng và cấu hình tương ứng trước khi mở cờ. Bản sao lưu hiện tại vẫn ở cùng máy; không phải bản sao ngoài máy.
