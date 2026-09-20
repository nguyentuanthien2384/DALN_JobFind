# Tìm ứng viên và lọc CV

Trong khu nhà tuyển dụng, mở **Quản lý ứng viên → Tìm kiếm ứng viên** (`/admin/list-candiate/`). Áp dụng cho chủ công ty và nhân viên tuyển dụng thuộc công ty đã được duyệt; quản trị viên vẫn có quyền tra cứu.

## Cách sử dụng

1. Chọn một tin của công ty trong **Bắt đầu từ tin tuyển dụng**, hoặc tự chọn bộ lọc. Ô chọn tin tìm theo tên; khi có nhiều tin, nhập tên để thu hẹp danh sách.
2. Nhập tên ứng viên hoặc kỹ năng trong **Từ khóa**. Có thể kết hợp ngành, địa điểm, kinh nghiệm và lương mong muốn. Các trường này lọc theo đúng mã danh mục được chọn.
3. Chọn kỹ năng từ gợi ý theo ngành, hoặc nhập tên rồi nhấn Enter. Hỗ trợ các tên có dấu như C++, C#, .NET. Chọn cách khớp: có ít nhất một, có tất cả, hoặc chỉ xếp hạng mà không loại hồ sơ thiếu kỹ năng.
4. Chọn điểm tối thiểu và sắp xếp theo mức phù hợp hoặc tên. Đổi bộ lọc sẽ về trang đầu; chuyển trang giữ toàn bộ điều kiện.
5. Mở **Vì sao có điểm này?** để xem tiêu chí khớp và kỹ năng chưa thấy khai báo. Chọn **Xem chi tiết ứng viên** để vào quy trình mở quyền xem CV hiện có.

## Điểm phù hợp và phạm vi dữ liệu

Điểm = số tiêu chí khớp / tổng số tiêu chí đã chọn × 100, làm tròn đến số nguyên. Mỗi tiêu chí danh mục và mỗi tên kỹ năng khác nhau tính một lần. Từ khóa không tham gia chấm điểm. Ví dụ: địa điểm Hà Nội và hai kỹ năng React/Node.js; hồ sơ Hà Nội có React được 2/3, tương đương 67%. Chưa chọn tiêu chí thì không hiển thị điểm.

Kỹ năng đối chiếu với thông tin ứng viên đã khai báo, không đọc nội dung tệp PDF trong lần tìm kiếm. Kỹ năng gợi ý từ tin được nhận diện theo tên trong danh mục; nhà tuyển dụng cần kiểm tra và chỉnh lại vì mô tả tin có thể chứa kỹ năng không bắt buộc. Mức kinh nghiệm và lương là danh mục chính xác, không suy luận khoảng số hoặc mức tối thiểu. Điểm hỗ trợ người tuyển dụng xem xét hồ sơ, không tự từ chối ứng viên.

Chỉ trả ứng viên có tài khoản CANDIDATE hoạt động, bật tìm việc, có tệp CV không rỗng. Kết quả chỉ chứa tên, ảnh, tiêu chí tìm việc và kỹ năng; không trả tệp CV, email, điện thoại, địa chỉ chi tiết, ngày sinh hay dữ liệu tài khoản. Lượt xem miễn phí/trả phí chỉ lấy cho công ty trong phiên đăng nhập, cả với nhân viên tuyển dụng. Quyền xem chi tiết và cơ chế trừ lượt nguyên tử hiện có không thay đổi.

## API và triển khai

- `GET /api/fillter-cv-by-selection`: giữ đường dẫn cũ. Tham số: `limit` (1–50), `offset`, `keyword` (tối đa 120 ký tự), `categoryJobCode`, `experienceJobCode`, `salaryCode`, `provinceCode`, `listSkills` (ID), `otherSkills` (tên), `skillMode` (`any`, `all`, `rank`), `minMatch` (0–100), `sort` (`match`, `name`). Tối đa 30 kỹ năng; mã hóa query bằng URLSearchParams. Thiếu/sai tham số trả HTTP 400.
- Response dùng `matchScore` (số hoặc null), `matchedSkills`, `missingSkills`, `matchedCriteria`, `criterionCount`, `skills`, `count` và `allowance`. Không còn dùng trường `file` để chứa phần trăm. Giao diện và API cần cập nhật cùng nhau.
- `GET /api/candidate-search-jobs`: `search`, `limit` (mặc định 20, tối đa 50), `offset`; chỉ lấy tin của công ty trong phiên đăng nhập. Tham số `companyId` do khách gửi không quyết định phạm vi truy cập.
- Cả hai API yêu cầu quyền `CANDIDATE_SEARCH` và xác thực hiện có. Gateway chuyển tiếp về backend hiện tại, không cần bật AI hay thay đổi schema.
- MySQL lọc, đếm và sắp xếp trước LIMIT/OFFSET, có ID phụ để ổn định thứ tự. EXISTS tránh nhân đôi kết quả khi liên kết kỹ năng trùng; kỹ năng hiển thị được tải gộp cho trang hiện tại. Không tải các BLOB CV để chấm điểm.
- Sau khi cập nhật, khởi động lại backend đang chạy và tải lại giao diện. Với môi trường dev quản lý qua script ở thư mục gốc, dùng `npm run dev:stop` rồi `npm start`, giữ các biến cổng tùy chỉnh nếu đã cấu hình.

## Kiểm chứng

- `npm --prefix backend test`: kiểm thử dịch vụ, controller, phân quyền và các chức năng hiện có.
- `npm --prefix frontend run test:unit`: kiểm thử giao diện, đổi/xóa bộ lọc, phân trang, phản hồi cũ, lỗi/thử lại và lấy tiêu chí từ tin.
- Chạy trong thư mục backend: `npm run test:candidate-search`. Tạo database MySQL riêng có tên ngẫu nhiên, kiểm tra tính đúng của truy vấn rồi xóa database thử nghiệm trong finally; không sửa dữ liệu ứng dụng. Tài khoản DB cần quyền CREATE DATABASE.
- Chạy trong thư mục backend: `npm run test:candidate-search:browser`. Dùng trình duyệt với giao diện thực và dữ liệu giả lập để kiểm tra thao tác desktop/mobile; ảnh lưu ở `.local/candidate-search-browser/`.
- `npm --prefix frontend run build`: xác nhận bản dựng sản xuất.
