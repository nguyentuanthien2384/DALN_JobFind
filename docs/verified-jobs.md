# Tin tuyển dụng có nguồn đối chiếu

Danh mục gồm **31 thông báo tuyển dụng** (30 tin đang hiển thị, 1 tin nguồn đã gỡ), phủ
**34 tỉnh/thành phố** tại ngày kiểm tra **30/09/2026**, lưu tại `frontend/src/data/verifiedJobs.json`.
Mỗi tin có doanh nghiệp, nơi làm việc được nguồn nêu rõ, liên kết bài gốc, ngày kiểm tra,
hạn nộp, logo/ảnh lấy từ trang nguồn và phần trích ngắn nội dung tin gốc.
Không suy rộng thông báo “toàn quốc” thành 34 tỉnh.
Tin tuyển nhiều địa phương dùng một bản ghi với `provinceCodes[]` và chỉ được đếm một lần.

Các trang tuyển dụng chính thức và trung tâm dịch vụ việc làm là nguồn đối chiếu;
doanh nghiệp trong danh mục không vì vậy trở thành tài khoản nhà tuyển dụng của Job Finder.
Danh mục không tạo tài khoản, công ty, bài đăng nội bộ hoặc hồ sơ ứng tuyển trong cơ sở dữ liệu.

## Cách hiển thị

- `/job` tìm và phân trang chung tin tổng hợp với bài đăng hiện có, ở cả chế độ tìm kiếm core và legacy.
- Thẻ tin có logo doanh nghiệp lấy từ trang nguồn (hoặc chữ viết tắt khi nguồn không có logo),
  nhãn “Tin từ nguồn bên ngoài”, tỉnh/thành, lương, hình thức, số lượng, ngày kiểm tra và hạn nộp.
- `/external-job/:id` hiển thị ảnh bìa và logo từ trang nguồn, các mục nội dung với đúng tiêu đề
  của tin gốc (mô tả, yêu cầu, quyền lợi…), thông tin nguồn công bố và nút mở tin gốc.
  Mỗi mục hiển thị tối đa 8 ý; mục dài có liên kết “Xem đầy đủ mục này tại tin gốc”.
- Không dùng ngày nhập/ngày kiểm tra làm ngày đăng. Không có thông tin lương/hạn nộp thì ghi “Nguồn chưa công bố”.
- Các giá trị lọc chưa có căn cứ được để `null`; không tự gán “Thỏa thuận”, kinh nghiệm hoặc loại hợp đồng.
- Tên tỉnh cũ ở nguồn được giữ trong địa điểm chi tiết và ánh xạ sang 34 tỉnh/thành hiện tại khi lọc.
- Hạn nộp tính hết ngày theo giờ Việt Nam. Tin quá hạn bị loại khỏi tìm kiếm; liên kết chi tiết cũ vẫn xem được nhưng nút ứng tuyển bị khóa.
- Tin có `sourceStatus` là `removed` (trang gốc trả 404/410) hoặc `closed` (hạn nộp nguồn đã qua khi kiểm tra)
  bị loại khỏi tìm kiếm. Trang chi tiết của tin `removed` không còn liên kết tới trang gốc.
- Các bản lưu tìm kiếm được phân biệt theo phiên bản danh mục và ngày hiện tại.
- Công cụ AI hỗ trợ hồ sơ tiếp tục chỉ chọn bài nội bộ, vì các thao tác đó cần mã công việc trong cơ sở dữ liệu.

## Nội dung lấy từ nguồn

`npm run jobs:sync` mở từng trang gốc và cập nhật: tiêu đề, hạn nộp, lương, số lượng, hình thức,
một số dữ kiện có nhãn (ngành nghề, kinh nghiệm, bằng cấp…), phần giới thiệu doanh nghiệp và các mục nội dung.
Quy tắc trích cho từng trang nằm ở `scripts/external-jobs/sites.mjs`; phần xử lý văn bản chung ở
`scripts/external-jobs/extract.mjs`.

- Chỉ trích phần ngắn: tối đa 5 mục, 8 ý mỗi mục, 320 ký tự mỗi ý. Toàn văn vẫn ở trang gốc.
- Không đăng lại thông tin liên hệ: bỏ các mục liên hệ/cách ứng tuyển và mọi dòng có số điện thoại,
  e-mail, đường link, “hotline”, “zalo”. Ứng viên nộp hồ sơ tại trang gốc.
- Không sửa `provinceCodes`, `sourceLocation`, mã bộ lọc và `postedAt`; các trường này vẫn biên tập tay.
- Ngoại lệ theo từng tin nằm trong `JOB_OVERRIDES` (ví dụ Agribank giữ tiêu đề chi nhánh Sơn La và
  bỏ con số 744 chỉ tiêu của toàn hệ thống).
- Trang trả 404/410 được đánh dấu `removed`; lỗi mạng hoặc 5xx giữ nguyên bản ghi và báo trong kết quả.
- Nếu danh mục sau khi cập nhật không qua `validateVerifiedJobs`, script không ghi gì.

Tùy chọn: `--dry-run` (chỉ báo cáo), `--only=<id,...>`, `--save-html=<thư mục>` (lưu trang đã tải để rà),
`--cache=<thư mục>` (đọc lại trang đã lưu, không gọi mạng), `--download-images` (tải ảnh còn thiếu).

## Hình ảnh

Logo, ảnh bìa và ảnh đính kèm tin là bản sao ảnh do chính trang nguồn công bố, lưu trong
`frontend/public/external-jobs/` (`logos/`, `covers/`, `jobs/`). Đường dẫn gốc của từng ảnh ghi trong
`scripts/external-jobs/sites.mjs`. Ảnh đã được thu nhỏ trước khi lưu (logo ≤ 600 px, ảnh bìa ≤ 1600 px);
ảnh tải mới bằng `--download-images` là bản gốc nên cần xem lại dung lượng.

- Không dùng ảnh quảng bá một chương trình khác với tin (ví dụ banner SGEN của Sun Group) làm ảnh bìa.
- Logo nền trắng chữ trắng (Agribank) được đặt trên màu thương hiệu qua `logoBackground`.
- Tin do trung tâm dịch vụ việc làm đăng (Hà Tĩnh, Cần Thơ) không dùng logo trung tâm làm logo doanh nghiệp;
  thẻ tin hiển thị chữ viết tắt tên doanh nghiệp.
- Frontend chỉ nhận ảnh có đường dẫn bắt đầu bằng `/external-jobs/`; ảnh lỗi được ẩn, logo lỗi chuyển sang chữ viết tắt.

## Kiểm tra và cập nhật

Chạy `npm run jobs:verify` để kiểm tra cấu trúc, trùng nguồn, danh mục tỉnh, hạn nộp, trạng thái,
các mục nội dung, ảnh tồn tại và số tỉnh còn có tin tại thời điểm chạy. Lệnh không tự truy cập nguồn.

Khi cập nhật:

1. Chạy `npm run jobs:sync -- --dry-run --save-html=.local/external-jobs` và đọc báo cáo, nhất là dòng đổi hạn nộp,
   tin bị gỡ hoặc trang không nhận diện được.
2. Với tin mới: mở bài gốc, kiểm tra **nơi làm việc** trên trang chi tiết, thêm bản ghi với `id` là
   `external-` + 12 ký tự đầu SHA-256 của `sourceUrl`, gán mã lọc có căn cứ, rồi chạy lại đồng bộ.
3. Với trang nguồn mới: thêm quy tắc trong `sites.mjs` và ảnh vào `frontend/public/external-jobs/`.
4. Chạy `npm run jobs:sync`, `npm run jobs:verify`, kiểm thử bộ lọc/phân trang và xem lại trang chi tiết.
5. Ghi bằng chứng mới vào `docs/verified-jobs-sources.md`.

Doanh nghiệp có thể đóng tuyển sớm. Người ứng tuyển cần xác nhận trên trang gốc.
Độ phủ tỉnh sẽ giảm khi tin hết hạn; cần thay bằng tin còn tuyển sau khi kiểm tra nguồn,
không kéo dài hạn cũ. Kiểm thử độ phủ dùng ngày kiểm tra của bộ dữ liệu, còn lệnh kiểm tra
ở trên báo độ phủ vào ngày thực tế.

## Xác minh thay đổi

Kiểm thử bao gồm độ phủ 34 tỉnh tại ngày kiểm tra, chuẩn hóa tên tỉnh cũ, tin đa địa điểm,
hạn nộp theo giờ Việt Nam, bộ lọc kết hợp, phân trang qua ranh giới tin tổng hợp/bài nội bộ,
xử lý lỗi tìm kiếm, liên kết nguồn an toàn, việc trang ngoài không chứa luồng gửi CV nội bộ,
tách mục/lọc thông tin liên hệ khi trích nguồn, ảnh chỉ lấy từ thư mục cục bộ và tin bị gỡ không hiện khi tìm kiếm.
