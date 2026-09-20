# Điều hướng và nội dung việc làm tiếng Việt

Trang `/job` lưu tối đa 20 trạng thái theo từng mục lịch sử trình duyệt, gồm bộ lọc, từ khóa, trang kết quả và vị trí cuộn. Khi quay lại, kết quả được dựng ngay trước khi khôi phục vị trí cuộn. Trạng thái tìm kiếm được tách theo phiên đăng nhập; dữ liệu quá 5 phút được làm mới mà vẫn giữ danh sách trong lúc chờ. Truy cập `/job` bằng một liên kết mới bắt đầu lượt tìm kiếm mới.

Thời gian tương đối và các nhãn việc làm dùng chung `frontend/src/util/jobLocale.js`. Các danh sách tại trang chủ, tìm việc, công ty và việc làm đã lưu đều dùng định dạng tiếng Việt.

## Cập nhật nội dung có sẵn

Chạy từ thư mục gốc:

```powershell
node backend/scripts/localize-job-descriptions.cjs
node backend/scripts/localize-job-descriptions.cjs --apply
```

Lệnh đầu chỉ liệt kê thay đổi. Lệnh `--apply` sao lưu bản ghi gốc vào `.local/backups/job-vietnamese-*.json`, cập nhật đồng thời HTML và Markdown, rồi ghi sự kiện `job.updated` trong cùng giao dịch để đồng bộ tìm kiếm. Không đổi mức lương, hạn nộp, số lượng tuyển hoặc trạng thái duyệt. Chạy lại không tạo thay đổi hay sự kiện trùng.

Ba nhóm mô tả dài được dịch trong `backend/scripts/data/job-description-translations.json`, chỉ áp dụng khi mã băm nội dung gốc khớp. Các cụm thuật ngữ đã rà soát và tiêu đề được chuẩn hóa trong `localize-job-content.cjs`; tên công nghệ và đường dẫn được giữ nguyên. Bộ dữ liệu mẫu cũng sử dụng cùng hàm chuẩn hóa. Đây là bước sửa dữ liệu hiện có, không phải dịch tự động tin đăng mới.

## Kiểm tra hồi quy

```powershell
npm --prefix backend test -- --runTestsByPath tests/scripts/jobLocalization.test.cjs
node backend/scripts/test-job-navigation-browser.cjs
npm --prefix frontend run test:unit -- --runTestsByPath src/container/JobPage/JobPage.test.js src/util/jobLocale.test.js src/util/fetch.test.js
npm --prefix frontend run build
```

Kiểm tra trình duyệt cần ứng dụng đang chạy tại `http://localhost:3001` (có thể đổi bằng `JOB_TEST_WEB_URL`). Kiểm tra trang 3, bộ lọc kèm từ khóa, Back/Forward, giữ vị trí qua từng khung hình khi phản hồi bộ lọc bị làm chậm, và mô tả tiếng Việt trên cả màn hình máy tính lẫn điện thoại. Ảnh kiểm tra nằm trong `.local/job-navigation/`.
