# Tin tuyển dụng có nguồn đối chiếu

Danh mục gồm **30 thông báo tuyển dụng**, phủ **34 tỉnh/thành phố** tại ngày kiểm tra
**29/09/2026**, lưu tại `frontend/src/data/verifiedJobs.json`.
Mỗi tin có doanh nghiệp, nơi làm việc được nguồn nêu rõ, liên kết bài gốc, ngày kiểm tra,
hạn nộp và bản tóm tắt tự biên soạn. Không suy rộng thông báo “toàn quốc” thành 34 tỉnh.
Tin tuyển nhiều địa phương dùng một bản ghi với `provinceCodes[]` và chỉ được đếm một lần.

Các trang tuyển dụng chính thức và trung tâm dịch vụ việc làm là nguồn đối chiếu;
doanh nghiệp trong danh mục không vì vậy trở thành tài khoản nhà tuyển dụng của Job Finder.
Danh mục không tạo tài khoản, công ty, bài đăng nội bộ hoặc hồ sơ ứng tuyển trong cơ sở dữ liệu.

## Cách hiển thị

- `/job` tìm và phân trang chung tin tổng hợp với bài đăng hiện có, ở cả chế độ tìm kiếm core và legacy.
- Thẻ tin có nhãn “Tin từ nguồn bên ngoài”, doanh nghiệp, tỉnh/thành, ngày kiểm tra và hạn nộp.
- `/external-job/:id` hiển thị bản tóm tắt, yêu cầu, địa điểm gốc và liên kết ứng tuyển tại nguồn.
- Không dùng ngày nhập/ngày kiểm tra làm ngày đăng. Không có thông tin lương/hạn nộp thì ghi “Nguồn chưa công bố”.
- Các giá trị lọc chưa có căn cứ được để `null`; không tự gán “Thỏa thuận”, kinh nghiệm hoặc loại hợp đồng.
- Tên tỉnh cũ ở nguồn được giữ trong địa điểm chi tiết và ánh xạ sang 34 tỉnh/thành hiện tại khi lọc.
- Hạn nộp tính hết ngày theo giờ Việt Nam. Tin quá hạn bị loại khỏi tìm kiếm; liên kết chi tiết cũ vẫn xem được nhưng nút ứng tuyển bị khóa.
- Các bản lưu tìm kiếm được phân biệt theo phiên bản danh mục và ngày hiện tại.
- Công cụ AI hỗ trợ hồ sơ tiếp tục chỉ chọn bài nội bộ, vì các thao tác đó cần mã công việc trong cơ sở dữ liệu.

## Kiểm tra và cập nhật

Chạy `npm run jobs:verify` để kiểm tra cấu trúc, trùng nguồn, danh mục tỉnh, hạn nộp và
số tỉnh còn có tin tại thời điểm chạy. Lệnh không tự truy cập nguồn, không gia hạn tin,
không thay đổi dữ liệu và không khẳng định doanh nghiệp vẫn nhận hồ sơ.

Khi cập nhật:

1. Mở bài tuyển dụng gốc và kiểm tra **nơi làm việc**, hạn nộp, trạng thái tuyển dụng.
2. Bổ sung hoặc sửa đúng một bản ghi cho mỗi thông báo nguồn; giữ `id` ổn định khi cập nhật.
3. Chỉ ghi những dữ kiện nguồn công bố; viết tóm tắt ngắn bằng lời riêng. Tránh sao chép toàn văn.
4. Cập nhật `checkedAt`, tăng `version`, ghi bằng chứng vào tài liệu nguồn kèm theo.
5. Chạy `npm run jobs:verify`, kiểm thử bộ lọc/phân trang và xem lại trang chi tiết.

Đây là danh mục biên tập tại thời điểm kiểm tra, **không phải nguồn đồng bộ tự động**.
Doanh nghiệp có thể đóng tuyển sớm. Người ứng tuyển cần xác nhận trên trang gốc.
Độ phủ tỉnh sẽ giảm khi tin hết hạn; cần thay bằng tin còn tuyển sau khi kiểm tra nguồn,
không kéo dài hạn cũ. Kiểm thử độ phủ dùng ngày kiểm tra của bộ dữ liệu, còn lệnh kiểm tra
ở trên báo độ phủ vào ngày thực tế.

## Xác minh thay đổi

Kiểm thử bao gồm độ phủ 34 tỉnh tại ngày kiểm tra, chuẩn hóa tên tỉnh cũ, tin đa địa điểm,
hạn nộp theo giờ Việt Nam, bộ lọc kết hợp, phân trang qua ranh giới tin tổng hợp/bài nội bộ,
xử lý lỗi tìm kiếm, liên kết nguồn an toàn và việc trang ngoài không chứa luồng gửi CV nội bộ.
