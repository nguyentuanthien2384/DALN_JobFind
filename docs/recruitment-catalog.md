# Danh mục tuyển dụng và tỉnh/thành phố

Danh mục chung tại `microservices/shared/recruitmentCatalog.cjs` gồm 12 cấp bậc tuyển dụng và 34 tỉnh/thành phố. Mã tỉnh dạng tên được giữ để tương thích hệ thống hiện tại; mã hành chính chính thức được lưu riêng trong `administrativeCode`.

- Thực tập sinh; Mới tốt nghiệp / Fresher; Nhân viên; Chuyên viên; Chuyên viên cao cấp.
- Trưởng nhóm; Giám sát; Phó phòng; Trưởng phòng; Phó giám đốc; Giám đốc; Giám đốc điều hành.

Cấp bậc áp dụng chung giữa các ngành; tên vị trí cụ thể (ví dụ Lập trình viên Java, Kế toán tổng hợp) nhập ở Tên bài đăng. Form tạo mới mặc định Nhân viên. Form sửa giữ mã đang lưu, kể cả mã cũ hoặc rỗng.

## Nguồn địa phương

Danh sách 34 đơn vị cấp tỉnh có hiệu lực từ 01/07/2025, theo [Quyết định 19/2025/QĐ-TTg trên Báo Chính phủ](https://baochinhphu.vn/bang-danh-muc-va-ma-so-cua-34-tinh-thanh-moi-3321-don-vi-hanh-chinh-cap-xa-moi-102250704153652947.htm). Ánh xạ địa phương trước/sau sáp nhập theo [Nghị quyết sắp xếp đơn vị hành chính cấp tỉnh](https://xaydungchinhsach.chinhphu.vn/quoc-hoi-thong-qua-nghi-quyet-sap-xep-don-vi-hanh-chinh-cap-tinh-119250612101356465.htm).

## Cập nhật cơ sở dữ liệu đã có

Từ thư mục gốc:

```sh
npm run catalog:migrate
npm run dev:stop
# Đợi dev:status báo stopped trước khi áp dụng.
npm run catalog:migrate -- --apply
npm start
```

Lệnh đầu chỉ xem trước. Lệnh áp dụng tự lưu snapshot MySQL và `catalog-before.json` ở `.local/backups/recruitment-catalog-*`, sau đó cập nhật trong một giao dịch:

- Thêm cấp bậc/tỉnh mới; giữ ba mã cấp bậc cũ và cấp bậc tự thêm.
- Chuyển tỉnh cũ sang `PROVINCE_LEGACY` để bảo toàn khóa tham chiếu nhưng không còn hiện trong lựa chọn tỉnh mới.
- Đối chiếu `detailposts.addressCode` và `usersettings.addressCode` sang tỉnh hiện hành.
- Ghi sự kiện `job.updated` vào outbox để chỉ mục tìm kiếm nhận dữ liệu mới; không sửa nội dung, trạng thái, số lượt đăng hoặc CV.

Lệnh có thể chạy lại: dữ liệu đã đúng không bị ghi lại hoặc phát sự kiện trùng. Nếu mã tỉnh không xác định hoặc trùng với một loại danh mục khác, lệnh dừng để đối chiếu. Không hoàn tác tỉnh sáp nhập bằng ánh xạ ngược nhiều-một; dùng `catalog-before.json` để tra cứu từng bản ghi hoặc khôi phục snapshot vào cơ sở dữ liệu riêng khi cần.

Danh mục khởi tạo bằng seeder và bản SQL cũng có đầy đủ lựa chọn. Sau khi nhập dữ liệu lịch sử, chạy lệnh cập nhật để chuẩn hóa địa phương của các tin cũ. Bộ lọc tìm việc/CV vẫn nhận tên tỉnh cũ và mới; Search chuẩn hóa kết quả và gộp thống kê. Hồ sơ Mongo trả tên tỉnh hiện hành và chuẩn hóa lúc lưu tùy chọn; địa chỉ tự nhập trong CV không bị sửa.

## Kiểm tra

```sh
npm run test:runtime
```

Kiểm thử MySQL thực tế dùng database tạm riêng, kiểm tra xem trước, yêu cầu sao lưu, rollback, outbox, chạy lại và toàn bộ seeder. Bật `TEST_CATALOG_MYSQL=1` rồi chạy `node --test scripts/recruitment-catalog.test.mjs`; chỉ database tạm do test tạo mới được xóa khi kết thúc.
